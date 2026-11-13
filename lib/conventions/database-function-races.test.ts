import { describe, expect, test } from 'bun:test';
import {
  committedMigrations,
  type DatabaseFunction,
  latestDatabaseFunctions,
  type Migration,
} from './database-functions';

// Tier 2 for "the function locks the rows, repeats the state checks"
// (docs/technical/code-quality.md, "Write related rows"). A database function
// that decides on a row it did not lock decides on a state that a concurrent
// call may change before the write commits. Each rule reads the latest
// committed definition of every function in public and app_private:
//
// 1. A function that bumps a row's version (`update … set version = … + 1`)
//    locks that table before it (`for update` or `for no key update` in an
//    earlier statement), or filters the update on the expected version. It
//    names what its caller saw or a retry key: a parameter `p_expected_…`,
//    `p_…version…`, `p_…revision…`, `p_operation_id` or `p_…attempt_key`, or
//    versions inside a JSON parameter (`->>'version'`). A trigger acts on the
//    row its statement changed and needs no key.
// 2. A clock event (`insert into public.time_entries`) is written with the
//    person's clock locked as a clock transition locks it: their
//    `employee_records` row, for update, in an earlier statement.
// 3. A job's project copied into another row (`select … project_id … into …
//    from public.jobs`) is read with a lock a project move waits for (`for
//    share` or stronger), so the copy cannot miss the move.
//
// A semantic race (a reviewed value overwritten, a preview booked against a
// changed article) stays a review point.

/** Reviewed version bumps, keyed `function::table`, with the reason the rule does not fit. Shrink only. */
const VERSION_BUMP_EXEMPTIONS: Readonly<Record<string, string>> = {
  'public.decide_time_account_adjustment::time_accounts':
    'a relative balance change (`current_balance_minutes + minutes`) that decides nothing on the account; the update’s own row lock orders it after any writer that holds the account',
  'public.create_time_account_policy_version::time_account_policies':
    'the only writer of time_account_policies; every call serializes on the organization’s time_policy advisory lock before it reads, and p_operation_id answers a retry',
  'app_private.sync_legacy_job_planning_occurrence::planning_occurrences':
    'a trigger that mirrors the job row its statement changed onto the projected occurrence; it reads no occurrence first, and the cancel’s own `status <> cancelled` filter is rechecked under the update’s row lock',
};

const KEY_PARAMETER =
  /^p_(?:expected_[a-z_0-9]+|[a-z_0-9]*(?:version|revision)[a-z_0-9]*|operation_id|[a-z_0-9]*attempt_key)$/;
const JSON_VERSION = /->>\s*'(?:expected_?)?version'/;
// A row lock and its optional `of` list; a lock without one holds every table the statement reads.
const ROW_LOCK = /\bfor\s+(?:no\s+key\s+)?update\b(?:\s+of\s+([a-z_0-9]+(?:\s*,\s*[a-z_0-9]+)*))?/;
const SHARE_OR_STRONGER =
  /\bfor\s+(?:share|no\s+key\s+update|update)\b(?:\s+of\s+([a-z_0-9]+(?:\s*,\s*[a-z_0-9]+)*))?/;
const NOT_AN_ALIAS =
  /^(?:where|join|inner|left|right|cross|on|using|for|order|group|limit|set|returning|natural)$/;
const UPDATE =
  /\bupdate\s+(?:only\s+)?(?:public\.)?([a-z_][a-z_0-9]*)(?:\s+(?:as\s+)?(?!set\b)[a-z_][a-z_0-9]*)?\s+set\b/g;
const VERSION_BUMP = /\b(?:[a-z_]+_)?(?:version|revision)\s*=\s*[^,;]*?\+\s*1\b/;
const EXPECTED_VERSION_FILTER = /\bwhere\b[^;]*\b(?:[a-z_]+_)?(?:version|revision)\s*=\s*p_[a-z_0-9]+/;

/** Whether the statement locks rows of `public.<table>` with the given clause. */
function locksTable(statement: string, table: string, clause: RegExp = ROW_LOCK): boolean {
  const lock = clause.exec(statement);
  const reads = [
    ...statement.matchAll(
      new RegExp(String.raw`\bpublic\.${table}\b(?:\s+(?:as\s+)?([a-z_][a-z_0-9]*))?`, 'g'),
    ),
  ];
  if (!lock || reads.length === 0) return false;
  const targets = lock[1]?.split(',').map((name) => name.trim());
  if (!targets) return true;
  const names = reads.map((read) => (read[1] && !NOT_AN_ALIAS.test(read[1]) ? read[1] : table));
  return names.some((name) => targets.includes(name));
}

/** Whether an earlier statement of the body locks rows of `public.<table>`. */
function lockedBefore(body: string, index: number, table: string): boolean {
  return body
    .slice(0, index)
    .split(';')
    .some((statement) => locksTable(statement, table));
}

function statementAt(body: string, index: number): string {
  const end = body.indexOf(';', index);
  return body.slice(index, end < 0 ? undefined : end);
}

/** `function::table` for every version bump without a lock or without a key. */
function unguardedVersionBumps(functions: readonly DatabaseFunction[]): Map<string, string> {
  const problems = new Map<string, string>();
  for (const fn of functions) {
    const keyed =
      fn.isTrigger || fn.parameters.some((name) => KEY_PARAMETER.test(name)) || JSON_VERSION.test(fn.body);
    for (const match of fn.body.matchAll(UPDATE)) {
      const table = match[1] ?? '';
      const statement = statementAt(fn.body, match.index);
      const assignments = statement.split(/\bwhere\b/)[0] ?? '';
      if (!VERSION_BUMP.test(assignments)) continue;
      const locked = EXPECTED_VERSION_FILTER.test(statement) || lockedBefore(fn.body, match.index, table);
      if (locked && keyed) continue;
      const missing = [
        locked ? null : `locks no ${table} row first`,
        keyed ? null : 'takes no expected version or retry key',
      ];
      problems.set(`${fn.name}::${table}`, `${fn.file}: ${missing.filter(Boolean).join(' and ')}`);
    }
  }
  return problems;
}

/** Clock events written without the person's employee record locked first. */
function unlockedClockEvents(functions: readonly DatabaseFunction[]): string[] {
  return functions.flatMap((fn) =>
    [...fn.body.matchAll(/\binsert\s+into\s+public\.time_entries\b/g)]
      .filter((match) => !lockedBefore(fn.body, match.index, 'employee_records'))
      .map(() => `${fn.file}: ${fn.name} writes a clock event without locking the employee record`),
  );
}

/** A job's project read into a variable without a lock that a project move waits for. */
function unlockedJobProjectCopies(functions: readonly DatabaseFunction[]): string[] {
  const copy = /\bselect\b[^;]*\bproject_id\b[^;]*\binto\b[^;]*\bfrom\s+public\.jobs\b[^;]*/g;
  return functions.flatMap((fn) =>
    [...fn.body.matchAll(copy)]
      .filter((match) => !locksTable(match[0], 'jobs', SHARE_OR_STRONGER))
      .map(() => `${fn.file}: ${fn.name} copies a job's project without locking the job`),
  );
}

const planted = (sql: string): DatabaseFunction[] => latestDatabaseFunctions([{ file: 'planted.sql', sql }]);
const committed = latestDatabaseFunctions(committedMigrations());

describe('database functions lock what they decide on', () => {
  test('a version bump locks its row and names the expected version or a retry key', () => {
    const problems = unguardedVersionBumps(committed);
    const unexplained = [...problems].filter(([key]) => !(key in VERSION_BUMP_EXEMPTIONS));
    expect(
      unexplained.map(([key, problem]) => `${key}: ${problem}`),
      'Read the row `for update` before the bump and take p_expected_version or a retry key (docs/technical/code-quality.md, "Write related rows")',
    ).toEqual([]);
    const stale = Object.keys(VERSION_BUMP_EXEMPTIONS).filter((key) => !problems.has(key));
    expect(stale, 'An exemption the rule no longer needs: delete it').toEqual([]);
  });

  test('a clock event is written with the employee record locked', () => {
    expect(unlockedClockEvents(committed)).toEqual([]);
  });

  test("a job's project is copied with the job locked", () => {
    expect(unlockedJobProjectCopies(committed)).toEqual([]);
  });
});

// Each probe against the flagged code of a review finding and its landed fix.
describe('the probes catch the flagged code', () => {
  const withoutPlanLock = (migrations: readonly Migration[]): Migration[] =>
    migrations.filter((migration) => !migration.file.includes('_lock_the_onboarding_plan_while_'));

  test('an onboarding plan bumped without its lock fails, and the plan lock passes', () => {
    const before = unguardedVersionBumps(latestDatabaseFunctions(withoutPlanLock(committedMigrations())));
    expect(before.get('public.acknowledge_personnel_item_review_base::personnel_onboarding_plans')).toContain(
      'locks no personnel_onboarding_plans row first',
    );
    expect(
      unguardedVersionBumps(committed).has(
        'public.acknowledge_personnel_item_review_base::personnel_onboarding_plans',
      ),
    ).toBe(false);
  });

  test('a bump without a key fails; a trigger, an expected-version filter and JSON versions pass', () => {
    const sql = [
      'create function public.unkeyed(p_id uuid) returns void language plpgsql as $$ begin',
      '  perform 1 from public.plans where id = p_id for update;',
      '  update public.plans set version = version + 1 where id = p_id; end $$;',
      'create function public.unlocked(p_id uuid, p_expected_version bigint) returns void language plpgsql as $$ begin',
      '  update public.plans plan set version = plan.version + 1 where plan.id = p_id; end $$;',
      'create function public.compared(p_id uuid, p_expected_version bigint) returns void language plpgsql as $$ begin',
      '  update public.plans set version = version + 1 where id = p_id and version = p_expected_version; end $$;',
      'create function app_private.bump() returns trigger language plpgsql as $$ begin',
      '  perform 1 from public.plans where id = new.plan_id for update;',
      '  update public.plans set version = version + 1 where id = new.plan_id; return new; end $$;',
      'create function public.batch(p_items jsonb) returns void language plpgsql as $$ begin',
      "  perform 1 from public.plans where id = (p_items->>'id')::uuid and version = (p_items->>'version')::int for update;",
      "  update public.plans set version = version + 1 where id = (p_items->>'id')::uuid; end $$;",
      'create function public.other_locked(p_id uuid, p_expected_version bigint) returns void language plpgsql as $$ begin',
      '  perform 1 from public.plans plan join public.requirements r on r.plan_id = plan.id where plan.id = p_id for update of r;',
      '  update public.plans set version = version + 1 where id = p_id; end $$;',
      'create function public.alias_locked(p_id uuid, p_expected_version bigint) returns void language plpgsql as $$ begin',
      '  perform 1 from public.plans plan join public.requirements r on r.plan_id = plan.id where plan.id = p_id for update of plan;',
      '  update public.plans set version = version + 1 where id = p_id; end $$;',
    ].join('\n');
    expect([...unguardedVersionBumps(planted(sql)).keys()]).toEqual([
      'public.unkeyed::plans',
      'public.unlocked::plans',
      'public.other_locked::plans',
    ]);
  });

  test('finding 142: a break end written without the clock lock fails, and the lock passes', () => {
    const flagged = [
      'create function public.update_time_tracking_settings(p_organization_id uuid, p_break_ends jsonb)',
      'returns void language plpgsql as $$ begin',
      '  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status, job_id)',
      "  select (break_end ->> 'user_id')::uuid, p_organization_id, 'break_end', now(), false, 'approved',",
      "    (break_end ->> 'job_id')::uuid",
      '  from jsonb_array_elements(p_break_ends) break_end;',
      'end $$;',
    ];
    const lock = [
      '  perform 1 from public.employee_records employee',
      '  where employee.organization_id = p_organization_id',
      "    and employee.user_id in (select (break_end ->> 'user_id')::uuid from jsonb_array_elements(p_break_ends) break_end)",
      '  order by employee.id',
      '  for update;',
    ];
    expect(unlockedClockEvents(planted(flagged.join('\n')))).toHaveLength(1);
    expect(
      unlockedClockEvents(planted([...flagged.slice(0, 2), ...lock, ...flagged.slice(2)].join('\n'))),
    ).toEqual([]);
  });

  test("finding 182: a job's project copied without a lock fails, and `for share` passes", () => {
    const sql = (lock: string): string =>
      [
        'create function public.plan_job_material(p_organization_id uuid, p_job_id uuid)',
        'returns uuid language plpgsql as $$ declare v_project_id uuid; begin',
        '  select job.project_id into v_project_id from public.jobs job',
        `  where job.id = p_job_id and job.organization_id = p_organization_id${lock};`,
        '  insert into public.job_material_lines (job_id, project_id) values (p_job_id, v_project_id);',
        '  return null; end $$;',
      ].join('\n');
    expect(unlockedJobProjectCopies(planted(sql('')))).toHaveLength(1);
    expect(unlockedJobProjectCopies(planted(sql('\n    for key share')))).toHaveLength(1);
    expect(unlockedJobProjectCopies(planted(sql('\n    for share')))).toEqual([]);
  });
});

describe('latest definitions', () => {
  test('a later create replaces, a rename moves, a drop removes, quoted text defines nothing', () => {
    const functions = planted(
      [
        `create policy "the job's team" on public.jobs for select using (true); -- it's a comment`,
        'create function public.f(p_a uuid) returns void language sql as $$ select 1 $$;',
        'create or replace function public.f(p_a uuid) returns void language sql as $body$ select 2 $body$;',
        'create function public.g(p_a uuid, p_b timestamptz default now()) returns void language sql as $$ select 3 $$;',
        'alter function public.g(uuid, timestamp with time zone) rename to g_base;',
        'alter function public.g_base(uuid, timestamptz) set schema app_private;',
        'create function "public"."h"(integer) returns trigger language plpgsql as $$ begin return new; end $$;',
        'drop function if exists public.h(int);',
        "comment on function public.f(uuid) is 'Not a statement: drop function public.f(uuid);';",
      ].join('\n'),
    );
    expect(functions.map(({ signature, body, isTrigger }) => [signature, body.trim(), isTrigger])).toEqual([
      ['public.f(uuid)', 'select 2', false],
      ['app_private.g_base(uuid, timestamp with time zone)', 'select 3', false],
    ]);
  });
});

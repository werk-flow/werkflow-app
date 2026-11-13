import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot } from '../conventions/product-sources';

// Tier 2 for the expand-only rule of the migration rule
// (docs/technical/environments.md#the-migration-rule). A top-level statement
// that the previous release's code may not survive carries a marker in the
// comment lines directly above it: a drop, a truncate, a delete, a dropped
// column or constraint, a rename, a column type change, a new NOT NULL column
// without a default, a new NOT NULL, CHECK, UNIQUE or foreign-key rule on an
// existing table, a changed or revoked access rule. Statements inside a
// function body are the function's logic, not migration steps, and are not
// checked. A changed return shape of a function that existing code calls is
// not visible to this probe and stays a review point.
//
// Applied migrations are immutable, so committed files cannot gain a marker.
// The rule applies to every migration whose version is greater than
// MARKER_REQUIRED_AFTER, the last migration committed before the rule landed;
// from RELEASE_MARKER_AFTER on, the marker names the release whose code no
// longer needs what the statement removes: `-- @destructive: after release
// <production commit>: <reason>`. Never raise these constants: a new file is
// always checked.
const MARKER_REQUIRED_AFTER = '20261006100100';
const RELEASE_MARKER_AFTER = '20261022110000';

const DESTRUCTIVE_STATEMENTS: readonly RegExp[] = [
  /^drop\s/,
  /^truncate\b/,
  /^delete\s+from\b/,
  /^alter\s+(table|publication)\b.*\bdrop\s+(column|constraint|table)\b/,
  /^alter\s+(table|view|materialized\s+view|function|procedure|type|sequence|index|schema)\b.*\srename\b/,
  /\balter\s+column\s+\S+\s+(set\s+data\s+)?type\b/,
];

/** What older code may not survive, checked from RELEASE_MARKER_AFTER on. A revoke on a function is a new function's default-grant revoke. */
const COMPATIBILITY_STATEMENTS: readonly RegExp[] = [
  /^alter\s+type\b.*\brename\s+value\b/,
  /^alter\s+policy\b/,
];
/** A revoke of table access; on a table the migration creates, it is the new table's default-grant revoke. */
const TABLE_REVOKE = /^revoke\b(?!.*\bon\s+(?:all\s+)?functions?\b).*?\bon\s+(?:table\s+)?([\w."]+)/;

/** Statements that tighten a table the migration did not create, so older code's writes may fail. */
const TIGHTENING_STATEMENTS: readonly RegExp[] = [
  /^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w."]+)\b.*\badd\s+(?:constraint\s+\S+\s+)?(?:check|unique|foreign\s+key|primary\s+key|exclude)\b/,
  /^create\s+unique\s+index\b.*?\bon\s+(?:only\s+)?([\w."]+)/,
  /^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w."]+)\b.*\balter\s+column\s+\S+\s+set\s+not\s+null\b/,
  /^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w."]+)\b.*\b(?:enable|force)\s+row\s+level\s+security\b/,
];
const ALTERED_TABLE = /^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w."]+)/;
/** The comma-separated actions of an ALTER TABLE, split only outside parentheses: `numeric(10,2)` stays whole. */
function topLevelActions(text: string): string[] {
  const actions: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      actions.push(current.trim());
      current = '';
    } else current += char;
  }
  return [...actions, current.trim()];
}
const ADDED_COLUMN = /(?:^|\s)add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(.+)$/;
/** Only a plain CREATE TABLE proves the table is new: IF NOT EXISTS may meet an existing one. */
const CREATED_TABLE = /^create\s+table\s+(?!if\s+not\s+exists\b)([\w."]+)/;

const MARKER = /--\s*@destructive:\s*(\S.{9,})$/m;
const RELEASE_MARKER = /--\s*@destructive:\s*after release [0-9a-f]{7,40}:\s*(\S.{9,})$/m;

const tableName = (name: string): string => name.replaceAll('"', '').replace(/^public\./, '');

type Statement = { line: number; text: string; leadingComments: string };

function endOfQuoted(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "'" && sql[index + 1] === "'") index += 2;
    else if (sql[index] === "'") return index + 1;
    else index += 1;
  }
  return sql.length;
}

/** Top-level statements with their start line and the comments directly above them. */
function topLevelStatements(sql: string): Statement[] {
  const statements: Statement[] = [];
  let text = '';
  let leadingComments = '';
  let line = 1;
  let startLine = 1;
  let index = 0;
  const skip = (end: number, replacement: string): void => {
    line += (sql.slice(index, end).match(/\n/g) ?? []).length;
    text += replacement;
    index = end;
  };
  while (index < sql.length) {
    const char = sql[index];
    if (char === '-' && sql[index + 1] === '-') {
      const newline = sql.indexOf('\n', index);
      const end = newline < 0 ? sql.length : newline;
      if (!text.trim()) leadingComments += `${sql.slice(index, end)}\n`;
      index = end;
      continue;
    }
    if (char === '/' && sql[index + 1] === '*') {
      const close = sql.indexOf('*/', index + 2);
      skip(close < 0 ? sql.length : close + 2, ' ');
      continue;
    }
    // A dollar-quote tag is empty or an identifier: a letter or underscore, then letters, digits or underscores.
    const dollarTag = char === '$' ? /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index)) : null;
    if (dollarTag) {
      const close = sql.indexOf(dollarTag[0], index + dollarTag[0].length);
      skip(close < 0 ? sql.length : close + dollarTag[0].length, ' $body$ ');
      continue;
    }
    if (char === "'") {
      skip(endOfQuoted(sql, index), " 'text' ");
      continue;
    }
    if (char === ';') {
      if (text.trim()) {
        statements.push({
          line: startLine,
          text: text.trim().replace(/\s+/g, ' ').toLowerCase(),
          leadingComments,
        });
      }
      text = '';
      leadingComments = '';
      index += 1;
      continue;
    }
    if (!text.trim() && /\S/.test(char ?? '')) startLine = line;
    if (char === '\n') line += 1;
    text += char;
    index += 1;
  }
  return statements;
}

/** The tables a plain CREATE TABLE of these statements creates. */
function createdTables(statements: readonly Statement[]): Set<string> {
  return new Set(
    statements.flatMap((statement) => {
      const name = CREATED_TABLE.exec(statement.text)?.[1];
      return name ? [tableName(name)] : [];
    }),
  );
}

/** `line: statement` for every statement the previous release may not survive that lacks its marker. */
function unmarkedDestructiveStatements(sql: string, releaseRule = false): string[] {
  const marker = releaseRule ? RELEASE_MARKER : MARKER;
  const statements = topLevelStatements(sql);
  const created = createdTables(statements);
  const onExistingTable = (pattern: RegExp, text: string): boolean => {
    const name = pattern.exec(text)?.[1];
    return name !== undefined && !created.has(tableName(name));
  };
  // A new NOT NULL column without a default, in either order of its clauses, on a table that existed.
  const addsRequiredColumn = (text: string): boolean =>
    onExistingTable(ALTERED_TABLE, text) &&
    topLevelActions(text).some((action) => {
      const column = ADDED_COLUMN.exec(action)?.[1];
      return (
        column !== undefined &&
        !/^(?:constraint|check|unique|primary|foreign|exclude)\b/.test(column) &&
        /\bnot\s+null\b/.test(column) &&
        !/\b(?:default|generated)\b/.test(column)
      );
    });
  return statements
    .filter(
      (statement) =>
        DESTRUCTIVE_STATEMENTS.some((pattern) => pattern.test(statement.text)) ||
        (releaseRule &&
          (COMPATIBILITY_STATEMENTS.some((pattern) => pattern.test(statement.text)) ||
            onExistingTable(TABLE_REVOKE, statement.text) ||
            TIGHTENING_STATEMENTS.some((pattern) => onExistingTable(pattern, statement.text)) ||
            addsRequiredColumn(statement.text))),
    )
    .filter((statement) => !marker.test(statement.leadingComments))
    .map((statement) => `${statement.line}: ${statement.text.slice(0, 100)}`);
}

const ADDED_CHECK = /^add\s+(?:constraint\s+\S+\s+)?check\b/;

/** `line: statement` for every CHECK added to an existing table without NOT VALID. */
function validatedChecksOnExistingTables(sql: string): string[] {
  const statements = topLevelStatements(sql);
  const created = createdTables(statements);
  return statements
    .filter((statement) => {
      const altered = ALTERED_TABLE.exec(statement.text);
      return (
        altered?.[1] !== undefined &&
        !created.has(tableName(altered[1])) &&
        topLevelActions(statement.text.slice(altered[0].length)).some(
          (action) =>
            (ADDED_CHECK.test(action) && !/\bnot\s+valid$/.test(action)) ||
            // A column's own CHECK cannot be NOT VALID: add it as a separate constraint.
            (/^add\s/.test(action) && !ADDED_CHECK.test(action) && /\bcheck\s*\(/.test(action)),
        )
      );
    })
    .map((statement) => `${statement.line}: ${statement.text.slice(0, 100)}`);
}

describe('destructive migration statements', () => {
  test('every destructive statement in a new migration carries a reasoned @destructive marker', () => {
    const directory = join(repositoryRoot, 'supabase/migrations');
    const offenders = readdirSync(directory)
      .filter((file) => file.endsWith('.sql') && file.slice(0, 14) > MARKER_REQUIRED_AFTER)
      .flatMap((file) =>
        unmarkedDestructiveStatements(
          readFileSync(join(directory, file), 'utf8'),
          file.slice(0, 14) > RELEASE_MARKER_AFTER,
        ).map((statement) => `supabase/migrations/${file}:${statement}`),
      );
    expect(
      offenders,
      'Expand only: add the replacement first and contract in a later release, then mark the statement `-- @destructive: after release <production commit>: <why that build no longer needs it>` (migration rule)',
    ).toEqual([]);
  });

  test('the probe flags unmarked top-level statements and ignores marked ones and function bodies', () => {
    const planted = [
      'drop function public.old_helper(uuid);',
      '-- @destructive: replaced by new_helper, which the deployed build already calls',
      'drop function public.older_helper(uuid);',
      '-- @destructive: too short',
      'alter table public.jobs drop column legacy_note;',
      'alter table public.jobs alter column legacy_note drop not null;',
      'create function public.f() returns void language sql as $$ delete from public.jobs; drop table x; $$;',
      'create function public.g() returns void language plpgsql as $fn1$ begin drop table y; end $fn1$;',
      "comment on table public.jobs is 'drop table jobs; delete from jobs';",
      'delete from public.jobs where false;',
      'alter table public.jobs rename column title to name;',
      'alter table public.jobs alter column title type varchar(80);',
    ].join('\n');
    expect(unmarkedDestructiveStatements(planted)).toEqual([
      '1: drop function public.old_helper(uuid)',
      '5: alter table public.jobs drop column legacy_note',
      '10: delete from public.jobs where false',
      '11: alter table public.jobs rename column title to name',
      '12: alter table public.jobs alter column title type varchar(80)',
    ]);
  });

  test('the probe flags what older code may not survive, except on a table the migration creates', () => {
    const planted = [
      'create table public.fresh (id uuid primary key, name text);',
      "alter table public.fresh add constraint fresh_name_check check (name <> '');",
      'create unique index fresh_name_key on public.fresh (name);',
      "alter table public.jobs add constraint jobs_title_check check (title <> '');",
      'create unique index jobs_title_key on public.jobs (title);',
      'alter table public.jobs add column priority_rank integer not null;',
      'alter table public.jobs add column ranked boolean not null default false;',
      'alter table public.jobs alter column title set not null;',
      "alter type public.job_status rename value 'parked' to 'geparkt';",
      'revoke select on public.jobs from authenticated;',
      'alter policy jobs_read on public.jobs using (false);',
      'alter table public.fresh add column note text not null;',
      'revoke all on function public.fresh_helper(uuid) from public, anon;',
      'alter table public.jobs add column rank integer default 0 not null;',
      'alter table public.fresh alter column name set not null;',
      'alter table public.fresh enable row level security;',
      'alter table public.jobs enable row level security;',
      'create table if not exists public.jobs (id uuid primary key);',
      'create unique index jobs_id_key on public.jobs (id);',
      'alter table public.jobs add column amount numeric(10,2) not null;',
      'alter table public.jobs add column note text, add column total numeric(10,2) not null default 0;',
      'revoke all on table public.fresh from public, anon, authenticated, service_role;',
      'revoke all on table public.jobs from anon;',
    ].join('\n');
    expect(unmarkedDestructiveStatements(planted, true)).toEqual([
      "4: alter table public.jobs add constraint jobs_title_check check (title <> 'text' )",
      '5: create unique index jobs_title_key on public.jobs (title)',
      '6: alter table public.jobs add column priority_rank integer not null',
      '8: alter table public.jobs alter column title set not null',
      "9: alter type public.job_status rename value 'text' to 'text'",
      '10: revoke select on public.jobs from authenticated',
      '11: alter policy jobs_read on public.jobs using (false)',
      '17: alter table public.jobs enable row level security',
      '19: create unique index jobs_id_key on public.jobs (id)',
      '20: alter table public.jobs add column amount numeric(10,2) not null',
      '23: revoke all on table public.jobs from anon',
    ]);
  });

  test('from the release marker rule on, a marker names the release whose code no longer needs the object', () => {
    const named = [
      '-- @destructive: after release 52803322: production no longer calls the old helper',
      'drop function public.old_helper(uuid);',
      '-- @destructive: the deployed build no longer calls it',
      'drop function public.older_helper(uuid);',
    ].join('\n');
    expect(unmarkedDestructiveStatements(named, true)).toEqual([
      '4: drop function public.older_helper(uuid)',
    ]);
  });
});

// Tier 2: a CHECK added to an existing table is added NOT VALID. A validated
// ADD CONSTRAINT scans every row under an ACCESS EXCLUSIVE lock, and a row that
// DEV or PROD holds but the local stack does not fails the push after the
// merge. NOT VALID checks every new write as before; a later VALIDATE
// CONSTRAINT checks the old rows without blocking writes. The rule applies to
// every migration after NOT_VALID_REQUIRED_AFTER, the newest on main when it
// landed. Never raise it.
const NOT_VALID_REQUIRED_AFTER = '20261201180000';

describe('checks on existing tables', () => {
  test('a new migration adds a CHECK to an existing table NOT VALID', () => {
    const directory = join(repositoryRoot, 'supabase/migrations');
    const offenders = readdirSync(directory)
      .filter((file) => file.endsWith('.sql') && file.slice(0, 14) > NOT_VALID_REQUIRED_AFTER)
      .flatMap((file) =>
        validatedChecksOnExistingTables(readFileSync(join(directory, file), 'utf8')).map(
          (statement) => `supabase/migrations/${file}:${statement}`,
        ),
      );
    expect(offenders, 'End each `add constraint … check (…)` on an existing table with `not valid`').toEqual(
      [],
    );
  });

  // The flagged statements of two review findings, and their landed fixes.
  test('the probe flags a validated CHECK on an existing table only', () => {
    const flagged = [
      'alter table public.job_material_lines',
      '  add constraint job_material_lines_source_complete',
      '    check ((source_kind is null) = (source_id is null)),',
      '  add constraint job_material_lines_source_kind_format',
      "    check (source_kind ~ '^[a-z][a-z0-9_]{0,62}$');",
      'alter table public.attention_events',
      '  add constraint attention_events_source_type_check check (',
      "    source_type = any (array['time_session_approval', 'client_request_callback_overdue'])",
      '  );',
      'create table public.fresh (id uuid primary key, name text);',
      "alter table public.fresh add constraint fresh_name_check check (name <> '');",
      "alter table public.jobs add column note text, add constraint jobs_note_check check (note <> '') not valid;",
      'alter table public.jobs add column quantity integer default -1 check (quantity > 0);',
    ].join('\n');
    expect(validatedChecksOnExistingTables(flagged)).toEqual([
      '1: alter table public.job_material_lines add constraint job_material_lines_source_complete check ((sour',
      '6: alter table public.attention_events add constraint attention_events_source_type_check check ( source',
      '13: alter table public.jobs add column quantity integer default -1 check (quantity > 0)',
    ]);
    const fixed = flagged
      .replace("{0,62}$');", () => "{0,62}$') not valid;")
      .replace('(source_id is null)),', '(source_id is null)) not valid,')
      .replace(
        "'client_request_callback_overdue'])\n  );",
        "'client_request_callback_overdue'])\n  ) not valid;",
      );
    expect(validatedChecksOnExistingTables(fixed)).toEqual([
      '13: alter table public.jobs add column quantity integer default -1 check (quantity > 0)',
    ]);
  });
});

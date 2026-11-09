// Rule test: an SQL test runs no DROP TRIGGER, and its policy DDL only inside a savepoint it rolls back to.
import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './product-sources';

// Tier 2 for SQL tests on the shared local stack. The
// stack's supautils hook (`supautils.drop_trigger_grants` and
// `supautils.policy_grants`) answers every DROP TRIGGER and every CREATE, ALTER
// or DROP POLICY run as `postgres` with an AccessExclusiveLock on each listed
// auth, storage and realtime table, held until the transaction ends. On
// 2026-11-09 event_ledger_boundaries.sql held AccessExclusiveLock on
// public.documents for its DROP TRIGGER, then waited for realtime.subscription
// while Realtime's subscription insert held realtime.subscription and waited for
// public.documents: a deadlock against another worktree's live session.
// Disable a test trigger (`alter table ... disable trigger`) instead of dropping
// it. Run policy DDL between `savepoint <name>` and `rollback to savepoint
// <name>`, which ends the hook's locks within the probe.
const testsDirectory = resolve(repositoryRoot, 'supabase/tests');

const EVENT =
  /\b(?:rollback\s+to\s+(?:savepoint\s+)?(\w+)|release\s+(?:savepoint\s+)?(\w+)|savepoint\s+(\w+)|(drop\s+trigger)|((?:create|alter|drop)\s+policy))\b/gi;

type Savepoint = { readonly name: string; readonly id: number };

/** Each statement the hook turns into stack-wide locks, outside the allowed form. */
function stackLockStatements(source: string): string[] {
  const code = source.replace(/--[^\n]*/g, '');
  // Savepoint instances, innermost last. A repeated name opens a new instance,
  // and a rollback or release reaches only the newest one of that name.
  const open: Savepoint[] = [];
  const pending: { readonly statement: string; readonly within: ReadonlySet<number> }[] = [];
  const findings: string[] = [];
  for (const match of code.matchAll(EVENT)) {
    const [, rolledBack, released, opened, dropTrigger, policy] = match;
    const line = code.slice(0, match.index).split('\n').length;
    if (opened) open.push({ name: opened.toLowerCase(), id: match.index });
    if (dropTrigger) findings.push(`line ${line}: DROP TRIGGER`);
    if (policy) {
      pending.push({
        statement: `line ${line}: ${policy.toUpperCase()}`,
        within: new Set(open.map(({ id }) => id)),
      });
    }
    const name = (rolledBack ?? released)?.toLowerCase();
    const depth = open.findLastIndex((savepoint) => savepoint.name === name);
    const target = open[depth];
    if (target === undefined) continue;
    // A release merges the savepoint's locks into the enclosing scope; only a
    // rollback ends them.
    open.length = rolledBack ? depth + 1 : depth;
    if (!rolledBack) continue;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (pending[index]?.within.has(target.id)) pending.splice(index, 1);
    }
  }
  return [...findings, ...pending.map((entry) => `${entry.statement} (no rollback to savepoint)`)];
}

test('the scan names a dropped trigger and policy DDL outside a rolled-back savepoint', () => {
  expect(stackLockStatements('-- drop trigger x on t;\nalter table t disable trigger x;')).toEqual([]);
  expect(
    stackLockStatements(
      'savepoint probe;\ncreate table t (id int);\ncreate policy p on t using (true);\nrollback to savepoint probe;',
    ),
  ).toEqual([]);
  expect(stackLockStatements('drop trigger x on t;')).toEqual(['line 1: DROP TRIGGER']);
  expect(stackLockStatements('create policy p on t using (true);')).toEqual([
    'line 1: CREATE POLICY (no rollback to savepoint)',
  ]);
  expect(
    stackLockStatements('savepoint probe;\nalter policy p on t using (false);\nrelease savepoint probe;'),
  ).toEqual(['line 2: ALTER POLICY (no rollback to savepoint)']);
  expect(
    stackLockStatements(
      'savepoint p;\ncreate policy q on t using (true);\nsavepoint p;\nrollback to savepoint p;',
    ),
  ).toEqual(['line 2: CREATE POLICY (no rollback to savepoint)']);
  expect(
    stackLockStatements(
      'savepoint outer_probe;\nsavepoint p;\ncreate policy q on t using (true);\nrelease savepoint p;\nrollback to savepoint outer_probe;',
    ),
  ).toEqual([]);
  expect(
    stackLockStatements(
      'savepoint a;\nrollback to savepoint a;\ndrop policy p on t;\nsavepoint b;\nrollback to savepoint b;',
    ),
  ).toEqual(['line 3: DROP POLICY (no rollback to savepoint)']);
});

test('SQL tests take no stack-wide supautils lock that outlives a probe', () => {
  const findings = readdirSync(testsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .flatMap((name) =>
      stackLockStatements(readFileSync(resolve(testsDirectory, name), 'utf8')).map(
        (finding) => `supabase/tests/${name} ${finding}`,
      ),
    );
  expect(
    findings,
    'Disable a test trigger instead of dropping it; run policy DDL between savepoint <name> and rollback to savepoint <name>.',
  ).toEqual([]);
});

// Rule test: the shared local stack is main at some commit. The sync applies only what main has and
// the stack lacks, refuses a stack that holds anything main lacks, and the ledger trigger admits no
// writer but the sync.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sqlShape } from './migration-drift';

import {
  GUARD_QUERY,
  GUARD_SQL,
  RESET_CONFIRMATION,
  RESET_WARNING,
  SYNC_OPTIONS,
  resetRefusal,
  syncDecision,
} from './stack-sync';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');
const none = { stackOnly: [], treeOnly: [], changed: [], unverified: [], unknownVersions: [] };

test('a stack that matches main is current, and one that lacks merged migrations takes them', () => {
  expect(syncDecision(none)).toEqual({ kind: 'current' });
  expect(syncDecision({ ...none, treeOnly: ['merged_one', 'merged_two'] })).toEqual({
    kind: 'behind',
    pending: ['merged_one', 'merged_two'],
  });
});

test('a stack that holds anything main lacks is refused, pending migrations or not', () => {
  const branch = syncDecision({ ...none, stackOnly: ['a_branch_migration'], treeOnly: ['merged_one'] });
  expect(branch.kind).toBe('ahead');
  expect(branch.kind === 'ahead' && branch.lines.join('\n')).toContain('1 not on main: a_branch_migration');
  // A migration that changed in review after a branch applied it.
  const changed = syncDecision({ ...none, changed: ['reviewed_again'] });
  expect(changed.kind === 'ahead' && changed.lines.join('\n')).toContain(
    "1 applied with other statements than main's: reviewed_again",
  );
  expect(changed.kind === 'ahead' && changed.lines.join('\n')).toContain('Reset the shared stack');
  // A row `supabase migration repair` wrote: nothing proves which SQL the stack ran.
  const repaired = syncDecision({ ...none, unverified: ['repaired'] });
  expect(repaired.kind === 'ahead' && repaired.lines.join('\n')).toContain(
    '1 recorded without their statements, so unproven: repaired',
  );
  // main's migration applied before the merge under another version: same SQL, but the CLI
  // refuses main's next migration while the ledger holds a version with no file.
  const renumbered = syncDecision({ ...none, unknownVersions: ['20261107150000'] });
  expect(renumbered.kind === 'ahead' && renumbered.lines.join('\n')).toContain(
    '1 recorded under versions main has no file for',
  );
});

// A stack that answered but whose ledger could not be read never passes check:changed.
test('a ledger the sync cannot read is a finding, not a stack at main', () => {
  const unreadable = syncDecision(undefined);
  expect(unreadable.kind).toBe('unreadable');
  expect(unreadable.kind === 'unreadable' && unreadable.lines.join('\n')).toContain(
    'its migration ledger could not be read',
  );
});

test('the ledger trigger refuses every write but the sync session and names the sanctioned commands', () => {
  // Rows and a truncate, in one transaction, admitted only under the sync's session setting.
  expect(GUARD_SQL).toContain('before insert or update or delete on supabase_migrations.schema_migrations');
  expect(GUARD_SQL).toContain('before truncate on supabase_migrations.schema_migrations');
  expect(GUARD_SQL).toContain("current_setting('werkflow.stack_sync', true) = 'main'");
  expect(SYNC_OPTIONS).toBe('-c werkflow.stack_sync=main');
  expect(GUARD_SQL).toContain('bun run types:generate -- --local');
  expect(GUARD_SQL).toContain('bun run stack:sync');
  // The message sits inside a single-quoted SQL literal.
  expect(GUARD_SQL).toContain("main''s migrations");
  expect(GUARD_QUERY).toContain("'werkflow_main_only', 'werkflow_main_only_truncate'");
});

// supabase/tests/shared_stack_ledger_guard.sql proves the trigger in rolled-back SQL; it must
// prove this trigger, statement for statement.
test('the rolled-back SQL test installs exactly the trigger the sync installs', () => {
  const guard = GUARD_SQL.trim()
    .replace(/^begin;/, '')
    .replace(/commit;$/, '');
  expect(sqlShape(read('supabase/tests/shared_stack_ledger_guard.sql'))).toContain(sqlShape(guard));
});

test('a reset names what it destroys and whom it would hit', () => {
  expect(RESET_WARNING.join('\n')).toContain(`bun run stack:reset -- ${RESET_CONFIRMATION}`);
  expect(RESET_WARNING.join('\n')).toContain('retained test worlds');
  const refusal = resetRefusal([
    { operation: 'audit:lab', workspace: '/work/a', mode: 'exclusive', startedAt: '2026-11-12T08:00:00Z' },
  ]);
  expect(refusal.join('\n')).toContain('"audit:lab" (exclusive, /work/a, started 2026-11-12T08:00:00Z)');
});

// The stack follows main on every machine without a step of its own: the two commands every
// checkout runs call the sync, and neither waits for a run that holds the stack.
test('check:changed and the worktree setup run the sync without waiting', () => {
  expect(read('scripts/check-changed.ts')).toContain("'scripts/local-stack.ts', 'sync', '--no-wait'");
  expect(read('scripts/setup-worktree.ts')).toContain("'scripts/local-stack.ts', 'sync', '--no-wait'");
  const scripts = read('package.json');
  expect(scripts).toContain('"stack:sync": "bun scripts/local-stack.ts sync"');
  expect(scripts).toContain('"stack:reset": "bun scripts/local-stack.ts reset"');
});

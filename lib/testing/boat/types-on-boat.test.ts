// Rule test: `types:generate -- --local` reads the stack on this machine only when that stack has
// this tree's schema (CI, a Boat machine, or a shared stack whose ledger matches the tree), takes
// the file from Boat otherwise, and never falls back to the shared stack when Boat is unavailable.
import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { typesFromCi, typesHereReason, typesOnBoat, typesUnavailableNotice } from './types-on-boat';
import { gitEnvironment } from './verify-on-boat';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const noDrift = { stackOnly: [], treeOnly: [], changed: [] };

test("CI and a Boat machine read their own stack without asking the shared stack's ledger", () => {
  const readDrift = () => {
    throw new Error('read');
  };
  expect(typesHereReason({ CI: 'true' }, readDrift)).toBe('');
  expect(typesHereReason({ WERKFLOW_BOAT_MACHINE: '1' }, readDrift)).toBe('');
});

test("a workstation reads the shared stack only while its ledger matches the tree's migrations", () => {
  expect(typesHereReason({}, () => noDrift)).toContain("exactly this tree's migrations");
  // The branch's own migration, another branch's, a changed one, and a stack that cannot be read.
  expect(typesHereReason({}, () => ({ ...noDrift, treeOnly: ['add_a_table'] }))).toBeUndefined();
  expect(typesHereReason({}, () => ({ ...noDrift, stackOnly: ['other_branch'] }))).toBeUndefined();
  expect(typesHereReason({}, () => ({ ...noDrift, changed: ['reviewed_again'] }))).toBeUndefined();
  expect(typesHereReason({}, () => undefined)).toBeUndefined();
});

test('without a usable key the types come back as Boat unavailable, never from the shared stack', async () => {
  const absent = await typesOnBoat('/nowhere', () => ({ kind: 'absent' }));
  expect('unavailable' in absent && absent.unavailable).toContain('no Boat key');
  expect(await typesOnBoat('/nowhere', () => ({ kind: 'unusable', reason: 'it expired.' }))).toEqual({
    unavailable: 'it expired.',
  });
});

test('CI answers only for a pushed commit: changed migrations or types refuse before any request', () => {
  const repository = mkdtempSync(join(tmpdir(), 'types-from-ci-'));
  try {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repository, env: gitEnvironment(), stdio: 'ignore' });
    git('init', '-q');
    mkdirSync(join(repository, 'supabase/migrations'), { recursive: true });
    writeFileSync(join(repository, 'supabase/migrations/20260101000000_first.sql'), 'select 1;\n');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'first');
    writeFileSync(join(repository, 'supabase/migrations/20260102000000_second.sql'), 'select 2;\n');
    const answer = typesFromCi(repository);
    expect('unavailable' in answer && answer.unavailable).toContain('commit and push the migration first');
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test('the notice says nothing was written and names the way through CI', () => {
  const notice = typesUnavailableNotice('this workstation has no Boat key.', 'CI has no run for abc.');
  expect(notice).toContain('BOAT IS UNAVAILABLE: this workstation has no Boat key.');
  expect(notice.join('\n')).toContain("holds main's migrations, never a\nbranch's");
  expect(notice).toContain('CI: CI has no run for abc.');
});

// The three places that name the file's way home agree: the machine's script, the module and CI.
test('the machine and CI leave the generated file where the workstation reads it', () => {
  const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');
  const remote = read('scripts/boat/remote-verify.sh');
  expect(remote).toContain('bun run types:generate -- --local && mkdir -p .agent-logs/types/generated');
  expect(remote).toContain('cp lib/supabase/database.types.ts .agent-logs/types/generated/');
  const ci = read('.github/workflows/ci.yml');
  expect(ci).toContain('WERKFLOW_TYPES_ARTIFACT: ${{ runner.temp }}/database-types/database.types.ts');
  expect(ci).toContain('name: database-types');
});

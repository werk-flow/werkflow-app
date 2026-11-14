import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type OpenMigration, migrationOrderProblems } from './migration-order';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: root, stdio: 'ignore' },
  );
}

function addMigration(root: string, name: string, sql: string, commit: boolean): void {
  writeFileSync(join(root, 'supabase/migrations', name), sql);
  if (!commit) return;
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '--no-verify', '-m', name);
}

/**
 * A feature branch cut from main before main merged two newer migrations: one on jobs, one that
 * replaces the function close_period.
 */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-migration-order-'));
  directories.push(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
  addMigration(root, '20261020100000_first.sql', 'create table jobs (id int);\n', true);
  git(root, 'branch', 'feature');
  addMigration(root, '20261025100000_job_note.sql', 'alter table jobs add column note text;\n', true);
  addMigration(
    root,
    '20261026100000_close_period.sql',
    'create or replace function close_period() returns void language sql as $$ select 1 $$;\n',
    true,
  );
  git(root, 'checkout', '--quiet', 'feature');
  return root;
}

const problems = (root: string, openPullRequests: readonly OpenMigration[] | null = []): string[] =>
  migrationOrderProblems({ repositoryRoot: root, mainRef: 'main', openPullRequests });

test('a migration older than main newest that changes other objects passes without a rename', () => {
  const root = repository();
  addMigration(root, '20261022120000_add_visits.sql', 'create table visits (id int);\n', true);
  expect(problems(root)).toEqual([]);
});

test('a migration older than a main migration that changes the same object fails, names both, and the rename clears the newest conflict', () => {
  const root = repository();
  addMigration(root, '20261022120000_job_due.sql', 'alter table public.jobs add column due date;\n', false);
  expect(problems(root)).toEqual([
    'supabase/migrations/20261022120000_job_due.sql changes what a migration with a higher version on main also changes: 20261025100000_job_note.sql (public.jobs). DEV and PROD applied that one first and a fresh database applies it after, so their schemas could differ. Rename it to supabase/migrations/20261025100001_job_due.sql (docs/technical/environments.md, "The migration rule").',
  ]);
});

test('an opaque statement conflicts with every newer main migration', () => {
  const root = repository();
  addMigration(root, '20261025120000_backfill.sql', 'do $$ begin perform 1; end $$;\n', false);
  expect(problems(root)).toEqual([
    expect.stringContaining(
      '20261026100000_close_period.sql (a statement it cannot read ("do $$ begin perform 1; end $$")). DEV and PROD',
    ),
  ]);
  expect(problems(root)[0]).toContain('Rename it to supabase/migrations/20261026100001_backfill.sql');
});

test('a version main already holds fails, and the rename skips every taken version', () => {
  const root = repository();
  addMigration(root, '20261025100000_same_version.sql', 'create table visits (id int);\n', false);
  expect(problems(root, [{ pullRequest: 7, name: '20261025100001_other.sql' }])).toEqual([
    'supabase/migrations/20261025100000_same_version.sql has the version of 20261025100000_job_note.sql on main; the ledger keeps one row per version. Rename it to supabase/migrations/20261025100002_same_version.sql (docs/technical/environments.md, "The migration rule").',
  ]);
});

test('a version another open pull request holds fails; the same file in an open pull request is this one', () => {
  const root = repository();
  addMigration(root, '20261027100000_visits.sql', 'create table visits (id int);\n', true);
  expect(
    problems(root, [
      { pullRequest: 12, name: '20261027100000_visits.sql' },
      { pullRequest: 13, name: '20261027100000_offers.sql' },
    ]),
  ).toEqual([expect.stringContaining('has the version of 20261027100000_offers.sql in #13;')]);
  expect(problems(root, [{ pullRequest: 12, name: '20261027100000_visits.sql' }])).toEqual([]);
  // GitHub unreadable: main's own history still decides.
  expect(problems(root, null)).toEqual([]);
});

test('a branch migration that main already holds, as after a squash merge, passes', () => {
  const root = repository();
  addMigration(root, '20261022120000_merged.sql', 'alter table jobs add column due date;\n', true);
  git(root, 'checkout', '--quiet', 'main');
  addMigration(root, '20261022120000_merged.sql', 'alter table jobs add column due date;\n', true);
  addMigration(root, '20261028100000_later.sql', 'alter table jobs add column later int;\n', true);
  git(root, 'checkout', '--quiet', 'feature');
  expect(problems(root)).toEqual([]);
});

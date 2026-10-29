import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrationOrderProblems } from './migration-order';

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

function addMigration(root: string, name: string, commit: boolean): void {
  writeFileSync(join(root, 'supabase/migrations', name), 'select 1;\n');
  if (!commit) return;
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '--no-verify', '-m', name);
}

/** A feature branch cut from main before main merged its newest migration, 20261025100000_second.sql. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-migration-order-'));
  directories.push(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
  addMigration(root, '20261020100000_first.sql', true);
  git(root, 'branch', 'feature');
  addMigration(root, '20261025100000_second.sql', true);
  git(root, 'checkout', '--quiet', 'feature');
  return root;
}

const problems = (root: string, now: string): string[] =>
  migrationOrderProblems({ repositoryRoot: root, mainRef: 'main', now: new Date(now) });

test('a committed migration older than main newest fails and names a current version to rename it to', () => {
  const root = repository();
  addMigration(root, '20261022120000_stale_change.sql', true);
  expect(problems(root, '2026-10-29T12:00:00.000Z')).toEqual([
    'supabase/migrations/20261022120000_stale_change.sql sorts at or before 20261025100000_second.sql, the newest migration on main, so supabase db push would refuse it after the merge. Rename it to supabase/migrations/20261029120000_stale_change.sql (docs/technical/environments.md, "The migration rule").',
  ]);
});

test('an uncommitted migration with the version of main newest fails, and the rename sorts after it', () => {
  const root = repository();
  addMigration(root, '20261025100000_same_version.sql', false);
  expect(problems(root, '2026-10-24T08:00:00.000Z')).toEqual([
    expect.stringContaining('Rename it to supabase/migrations/20261025100001_same_version.sql'),
  ]);
});

test('a migration newer than main newest passes', () => {
  const root = repository();
  addMigration(root, '20261026100000_newer.sql', false);
  expect(problems(root, '2026-10-29T12:00:00.000Z')).toEqual([]);
});

test('a branch migration that main already holds, as after a squash merge, passes', () => {
  const root = repository();
  addMigration(root, '20261022120000_merged.sql', true);
  git(root, 'checkout', '--quiet', 'main');
  addMigration(root, '20261022120000_merged.sql', true);
  addMigration(root, '20261026100000_later.sql', true);
  git(root, 'checkout', '--quiet', 'feature');
  expect(problems(root, '2026-10-29T12:00:00.000Z')).toEqual([]);
});

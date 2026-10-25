import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStackLockHolders, stackLockConflicts, stackLockDirectory, withStackLock } from './stack-lock';

const holder = (token: string, mode: 'shared' | 'exclusive', startedAt: string) => ({
  token,
  processId: process.pid,
  mode,
  operation: token,
  workspace: '/work',
  startedAt,
});

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function repository(): string {
  const directory = mkdtempSync(join(tmpdir(), 'werkflow-stack-lock-'));
  directories.push(directory);
  execFileSync('git', ['init', '--quiet'], { cwd: directory });
  return directory;
}

test('shared holders run together; an exclusive holder waits for all of them and for earlier exclusive ones', () => {
  const sharedA = holder('a', 'shared', '2026-10-25T10:00:00.000Z');
  const exclusiveB = holder('b', 'exclusive', '2026-10-25T10:01:00.000Z');
  const exclusiveC = holder('c', 'exclusive', '2026-10-25T10:02:00.000Z');
  const sharedD = holder('d', 'shared', '2026-10-25T10:03:00.000Z');
  expect(stackLockConflicts(sharedD, [sharedA])).toEqual([]);
  expect(stackLockConflicts(sharedD, [sharedA, exclusiveC]).map((h) => h.token)).toEqual(['c']);
  expect(stackLockConflicts(exclusiveB, [sharedA, exclusiveB, exclusiveC]).map((h) => h.token)).toEqual([
    'a',
  ]);
  expect(stackLockConflicts(exclusiveC, [exclusiveB, exclusiveC]).map((h) => h.token)).toEqual(['b']);
});

test('the holders of every worktree live in the shared git directory, and a dead holder is removed', () => {
  const root = repository();
  const directory = stackLockDirectory(root);
  expect(directory).toBe(join(root, '.git', 'werkflow-local-stack'));
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'exclusive-gone.json'),
    JSON.stringify({ ...holder('gone', 'exclusive', '2026-10-25T10:00:00.000Z'), processId: 2 ** 22 + 1 }),
  );
  expect(readStackLockHolders(directory)).toEqual([]);
  expect(readdirSync(directory)).toEqual([]);
});

test('a hold is visible while its operation runs, passes to its children and is released afterwards', async () => {
  const root = repository();
  const directory = stackLockDirectory(root);
  const seen = await withStackLock(
    { mode: 'exclusive', operation: 'outer', repositoryRoot: root },
    async (holdEnvironment) => {
      const holders = readStackLockHolders(directory).map((entry) => `${entry.mode}:${entry.operation}`);
      const child = execFileSync(
        process.execPath,
        [
          '-e',
          `const { withStackLock } = await import(${JSON.stringify(join(import.meta.dir, 'stack-lock.ts'))});
           await withStackLock({ mode: 'shared', operation: 'inner', repositoryRoot: ${JSON.stringify(root)} }, async () => console.log('inner ran'));`,
        ],
        { env: { ...process.env, ...holdEnvironment }, encoding: 'utf8' },
      );
      return [...holders, child.trim(), ...readStackLockHolders(directory).map((entry) => entry.operation)];
    },
  );
  expect(seen).toEqual(['exclusive:outer', 'inner ran', 'outer']);
  expect(readStackLockHolders(directory)).toEqual([]);
});

test('a shared holder waits behind a live exclusive holder until it leaves', async () => {
  const root = repository();
  const directory = stackLockDirectory(root);
  mkdirSync(directory, { recursive: true });
  const blocker = join(directory, 'exclusive-other.json');
  writeFileSync(blocker, JSON.stringify(holder('other', 'exclusive', '2026-10-25T10:00:00.000Z')));
  let entered = false;
  const pending = withStackLock({ mode: 'shared', operation: 'waiting', repositoryRoot: root }, async () => {
    entered = true;
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  expect(entered).toBe(false);
  rmSync(blocker);
  await pending;
  expect(entered).toBe(true);
});

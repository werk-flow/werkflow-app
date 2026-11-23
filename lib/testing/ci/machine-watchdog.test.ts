// The window's watchdog (scripts/ci/machine-watchdog.ts): it reaches the slot with run-commit's own
// environment, only the runner's verified-teardown record spares its stop, and it asks the process
// group itself whether any member is left.
import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runCommitSignal,
  spawnTracked,
  watch,
  watchdogEnvironment,
  withSentinels,
} from '../../../scripts/ci/machine-watchdog';

test("S27: the watchdog gets the slot's environment, WSL's interop included, and no credential", () => {
  expect(
    watchdogEnvironment({
      NODE_ENV: 'production',
      PATH: '/usr/bin',
      HOME: '/home/agent',
      WSL_INTEROP: '/run/WSL/1_interop',
      WSL_DISTRO_NAME: 'agents',
      GH_TOKEN: 'ghp_secret',
      WSLENV: 'GH_TOKEN/u',
    }),
  ).toEqual({
    NODE_ENV: 'production',
    WSLENV: '',
    PATH: '/usr/bin',
    HOME: '/home/agent',
    WSL_INTEROP: '/run/WSL/1_interop',
    WSL_DISTRO_NAME: 'agents',
  });
});

test("S4: only the runner's verified-teardown record spares the watchdog's stop; an exit of run-commit does not", async () => {
  const run = async (tornDown: boolean) => {
    let now = 0;
    let stopped = false;
    const outcome = await watch({
      at: 90_000,
      now: () => now,
      wait: async (ms) => void (now += ms),
      tornDown: () => tornDown,
      stop: async () => void (stopped = true),
    });
    return { outcome, stopped };
  };
  expect(await run(false)).toEqual({ outcome: 'stopped', stopped: true });
  expect(await run(true)).toEqual({ outcome: 'torn down', stopped: false });
});

test('S5: the process group answers for itself after its leader died, and a group another command leads is never signalled', () => {
  const sent: [number, string | 0][] = [];
  const kill = (pid: number, name: 'SIGTERM' | 'SIGKILL' | 0) => void sent.push([pid, name]);
  // The leader is gone, a member lives on: the group is still alive and still ours.
  expect(runCommitSignal(4_242, () => '', kill)(-4_242, 0)).toBe(true);
  expect(runCommitSignal(4_242, () => 'bun /trusted/scripts/ci/run-commit.ts', kill)(-4_242, 'SIGTERM')).toBe(
    true,
  );
  // A reused id: another command leads a group of that number.
  expect(runCommitSignal(4_242, () => 'vim notes.md', kill)(-4_242, 'SIGKILL')).toBe(false);
  expect(sent).toEqual([
    [-4_242, 0],
    [-4_242, 'SIGTERM'],
  ]);
});

test('CR 4004: a group the kernel refuses to signal (EPERM) still counts as alive; only ESRCH means gone', () => {
  const refused = (code: string) => () => {
    throw Object.assign(new Error('refused'), { code });
  };
  expect(runCommitSignal(4_242, () => '', refused('EPERM'))(-4_242, 0)).toBe(true);
  expect(runCommitSignal(4_242, () => '', refused('ESRCH'))(-4_242, 0)).toBe(false);
});

test('CR 987: the probe writes its sentinels as new files and removes exactly those, also when a write fails', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sentinels-'));
  const existing = join(folder, 'existing');
  writeFileSync(existing, 'owner data\n');
  const first = join(folder, 'first');
  // The second path exists already: it is never overwritten, and the first is removed again.
  await expect(withSentinels([first, existing], 'token', async () => 'probed')).rejects.toThrow();
  expect(existsSync(first)).toBe(false);
  expect(readFileSync(existing, 'utf8')).toBe('owner data\n');
  expect(await withSentinels([first], 'token', async (paths) => readFileSync(paths[0] ?? '', 'utf8'))).toBe(
    'token\n',
  );
  expect(existsSync(first)).toBe(false);
});

test('CR 997: a child that fails to start is handled, never an unhandled error that ends the runner', async () => {
  const failed = await new Promise<Error>((done) => {
    spawnTracked(() => spawn('/nonexistent/werkflow-ci-child', [], { stdio: 'ignore' }), done);
  });
  expect(failed.message).toContain('ENOENT');
});

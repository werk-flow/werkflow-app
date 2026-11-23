// The window's watchdog (scripts/ci/machine-watchdog.ts): it reaches the slot with run-commit's own
// environment, only the runner's verified-teardown record spares its stop, and it asks the process
// group itself whether any member is left.
import { expect, test } from 'bun:test';
import { runCommitSignal, watch, watchdogEnvironment } from '../../../scripts/ci/machine-watchdog';

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

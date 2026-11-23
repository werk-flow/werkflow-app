#!/usr/bin/env bun
// The window's watchdog of one run on the owner's machines (lib/testing/ci/machine-runner.ts): the
// machine runner starts it beside each run, as a process of its own that outlives a hung or dead
// runner and asks GitHub nothing. At the run's stop-by instant, before the window turns off, it ends
// the run's process group, empties the slot's daemon of every container and volume
// (container-executor.ts, clearSlot), and records what it found in the run's folder. Only the
// runner's record of a verified teardown (teardown.json) ends it earlier. It reaches the slot with
// the same environment as run-commit (`watchdogEnvironment`); the runner checks that with `--probe`
// before it admits any work.
// Usage: bun scripts/ci/machine-watchdog.ts --at <epoch ms> --group <process group> --run-dir <dir>
//        --slot <slot configuration as JSON>
//        bun scripts/ci/machine-watchdog.ts --probe --slot <slot configuration as JSON>
import { type ChildProcess, spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { slotConfigSchema } from '../../lib/testing/ci/container-slot';
import { KILL_AFTER_MS } from '../../lib/testing/ci/machine-runner';
import { clearSlot, slotEnvironment, slotShell } from './container-executor';

/** The runner's record that it stopped the run and showed the slot empty: only it spares the watchdog's stop. */
export const TEARDOWN_RECORD = 'teardown.json';

/** The watchdog's environment: run-commit's own for the slot, WSL's interop included. */
export const watchdogEnvironment = (environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  NODE_ENV: environment.NODE_ENV,
  ...slotEnvironment(environment),
});

/** The command that leads process `pid`, or '' when no process has that id. */
const leaderOf = (pid: number): string => {
  const answer = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  return answer.status === 0 ? answer.stdout.trim() : '';
};

/**
 * Signals process group `group` (`pid` is its negative id), and with signal 0 asks whether any
 * member is left: the group itself answers, also after its leader died. A group led by another
 * command than run-commit is a reused id and is never signalled.
 */
export function runCommitSignal(
  group: number,
  leader: (pid: number) => string = leaderOf,
  kill: (pid: number, name: 'SIGTERM' | 'SIGKILL' | 0) => void = (pid, name) => void process.kill(pid, name),
): (pid: number, name: 'SIGTERM' | 'SIGKILL' | 0) => boolean {
  return (pid, name) => {
    const command = leader(group);
    if (command !== '' && !command.includes('scripts/ci/run-commit.ts')) return false;
    try {
      kill(pid, name);
      return true;
    } catch (error) {
      // Only ESRCH says the group is gone; any other refusal (EPERM) leaves it there.
      return name === 0 && !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
    }
  };
}

/**
 * Writes each sentinel as a new file of its own (never over an existing one), runs `act`, and
 * removes exactly the files it created, also when a write or `act` fails.
 */
export async function withSentinels<Result>(
  paths: readonly string[],
  token: string,
  act: (paths: readonly string[]) => Promise<Result>,
): Promise<Result> {
  const created: string[] = [];
  try {
    for (const path of paths) {
      writeFileSync(path, `${token}\n`, { mode: 0o600, flag: 'wx' });
      created.push(path);
    }
    return await act(created);
  } finally {
    for (const path of created) rmSync(path, { force: true });
  }
}

/**
 * Spawns a child the runner depends on and handles its failure to start: an unhandled `error`
 * event would end the runner. `failed` decides what the failure means for the run.
 */
export function spawnTracked(start: () => ChildProcess, failed: (error: Error) => void): ChildProcess {
  const child = start();
  child.once('error', failed);
  return child;
}

/**
 * Waits for the stop-by instant, then stops the run, unless the runner recorded a verified
 * teardown first. An exit of run-commit alone spares nothing: its stack may still run.
 */
export async function watch(input: {
  at: number;
  now(): number;
  wait(ms: number): Promise<void>;
  tornDown(): boolean;
  stop(): Promise<void>;
}): Promise<'torn down' | 'stopped'> {
  while (input.now() < input.at) {
    if (input.tornDown()) return 'torn down';
    await input.wait(Math.min(30_000, input.at - input.now()));
  }
  if (input.tornDown()) return 'torn down';
  await input.stop();
  return 'stopped';
}

/**
 * Ends a run's process group by the id the runner recorded, never by a name or pattern: SIGTERM, up
 * to KILL_AFTER_MS for it to end, then SIGKILL. True once the group is gone.
 */
export async function endProcessGroup(
  group: number,
  signal: (pid: number, name: 'SIGTERM' | 'SIGKILL' | 0) => boolean,
  wait: (ms: number) => Promise<void>,
): Promise<boolean> {
  if (!signal(-group, 0)) return true;
  signal(-group, 'SIGTERM');
  for (let waited = 0; waited < KILL_AFTER_MS; waited += 2_000) {
    await wait(2_000);
    if (!signal(-group, 0)) return true;
  }
  signal(-group, 'SIGKILL');
  for (let waited = 0; waited < 10_000; waited += 1_000) {
    await wait(1_000);
    if (!signal(-group, 0)) return true;
  }
  return false;
}

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      at: { type: 'string' },
      group: { type: 'string' },
      'run-dir': { type: 'string' },
      slot: { type: 'string' },
      probe: { type: 'boolean', default: false },
    },
  });
  if (!values.slot) throw new Error('machine-watchdog.ts needs --slot <json>.');
  const slot = slotConfigSchema.parse(JSON.parse(values.slot));
  // The runner's start check: the watchdog's own environment reaches the slot.
  if (values.probe) process.exit((await slotShell(slot)(['true'], { timeoutMs: 60_000 })).code === 0 ? 0 : 1);
  const at = Number(values.at);
  const group = Number(values.group);
  const runDir = values['run-dir'];
  if (!Number.isSafeInteger(at) || !Number.isSafeInteger(group) || !runDir)
    throw new Error('Usage: machine-watchdog.ts --at <ms> --group <pgid> --run-dir <dir> --slot <json>');
  await watch({
    at,
    now: () => Date.now(),
    wait,
    tornDown: () => existsSync(join(runDir, TEARDOWN_RECORD)),
    stop: async () => {
      const gone = await endProcessGroup(group, runCommitSignal(group), wait);
      const left = await clearSlot(slotShell(slot), slot);
      writeFileSync(
        join(runDir, 'watchdog.json'),
        `${JSON.stringify({ stoppedAt: new Date().toISOString(), groupGone: gone, slot: left ?? 'clean' })}\n`,
      );
    },
  });
}

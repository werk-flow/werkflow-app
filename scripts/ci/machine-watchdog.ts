#!/usr/bin/env bun
// The window's watchdog of one run on the owner's machines (lib/testing/ci/machine-runner.ts): the
// machine runner starts it beside each run, as a process of its own that outlives a hung or dead
// runner and asks GitHub nothing. At the run's stop-by instant, before the window turns off, it ends
// the run's process group (only while its leader still runs run-commit), empties the slot's daemon
// of every container and volume (container-executor.ts, clearSlot), and records what it found in
// the run's folder. A run that ended before then (its exit.json) ends the watchdog.
// Usage: bun scripts/ci/machine-watchdog.ts --at <epoch ms> --group <process group> --run-dir <dir>
//        --slot <slot configuration as JSON>
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { slotConfigSchema } from '../../lib/testing/ci/container-slot';
import { KILL_AFTER_MS } from '../../lib/testing/ci/machine-runner';
import { clearSlot, slotShell } from './container-executor';

/** Signals process group `pid` (negative) only while its leader still runs run-commit: a reused id is never hit. */
export function runCommitSignal(group: number): (pid: number, name: 'SIGTERM' | 'SIGKILL' | 0) => boolean {
  return (pid, name) => {
    const leader = spawnSync('ps', ['-o', 'command=', '-p', String(group)], { encoding: 'utf8' });
    if (leader.status !== 0 || !leader.stdout.includes('scripts/ci/run-commit.ts')) return false;
    try {
      process.kill(pid, name);
      return true;
    } catch {
      return false;
    }
  };
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
    },
  });
  const at = Number(values.at);
  const group = Number(values.group);
  const runDir = values['run-dir'];
  if (!Number.isSafeInteger(at) || !Number.isSafeInteger(group) || !runDir || !values.slot)
    throw new Error('Usage: machine-watchdog.ts --at <ms> --group <pgid> --run-dir <dir> --slot <json>');
  const slot = slotConfigSchema.parse(JSON.parse(values.slot));
  while (Date.now() < at) {
    if (existsSync(join(runDir, 'exit.json'))) process.exit(0);
    await wait(Math.min(30_000, at - Date.now()));
  }
  if (existsSync(join(runDir, 'exit.json'))) process.exit(0);
  const gone = await endProcessGroup(group, runCommitSignal(group), wait);
  const left = await clearSlot(slotShell(slot), slot, true);
  writeFileSync(
    join(runDir, 'watchdog.json'),
    `${JSON.stringify({ stoppedAt: new Date().toISOString(), groupGone: gone, slot: left ?? 'clean' })}\n`,
  );
}

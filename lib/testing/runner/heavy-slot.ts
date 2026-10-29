import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// One shared machine runs many worktrees' agents at once. `check:changed`,
// `test:verify` and the local test server each run their own tsc, Next build or
// browser, and six at once exhausted memory (2026-10-29: load 82 on 14 cores).
// Each takes one of HEAVY_SLOTS machine-wide slots first and waits for a free
// one. A slot is a kernel `flock` on a file, held by the `flock` process that
// runs the command, so a killed command frees its slot by itself.

const HEAVY_SLOTS = 3;

/** The process environment, or a test's stand-in. */
type Environment = Readonly<Record<string, string | undefined>>;
/** The variable a command started in a slot inherits, so a nested heavy command reuses its parent's slot. */
export const HEAVY_SLOT_VARIABLE = 'WERKFLOW_HEAVY_SLOT';
/** flock's exit code when the slot is taken; no heavy command exits with it. */
export const SLOT_TAKEN = 197;
const WAIT_MILLISECONDS = 5_000;

type HeavySlotSkip = 'ci' | 'nested' | 'no-flock' | undefined;

/** Why this process runs without taking a slot, or undefined when it takes one. */
export function heavySlotSkip(
  environment: Environment,
  hasFlock: () => boolean = () => spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0,
): HeavySlotSkip {
  if (environment.CI === 'true') return 'ci';
  if (environment[HEAVY_SLOT_VARIABLE]) return 'nested';
  return hasFlock() ? undefined : 'no-flock';
}

function heavySlotDirectory(environment: Environment): string {
  return environment.WERKFLOW_HEAVY_SLOT_DIR ?? join(homedir(), '.cache', 'werkflow-heavy');
}

export const slotPath = (directory: string, slot: number): string => join(directory, `slot-${slot}`);

/** Runs `command` while holding `slot`; resolves with the command's exit code, or SLOT_TAKEN when the slot is held. */
export function runInSlot(
  directory: string,
  slot: number,
  command: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  mkdirSync(directory, { recursive: true });
  const child = spawn(
    'flock',
    ['--nonblock', '--conflict-exit-code', String(SLOT_TAKEN), slotPath(directory, slot), ...command],
    { stdio: 'inherit', env: { ...environment, [HEAVY_SLOT_VARIABLE]: String(slot) } },
  );
  const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
  const onInterrupt = forward('SIGINT');
  const onTerminate = forward('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  return new Promise((resolveExit, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      resolveExit(code ?? (signal === 'SIGINT' ? 130 : 143));
    });
  });
}

/**
 * Reruns this script inside a free heavy slot and exits with its code, waiting
 * while every slot is taken. Returns at once, running in this process, in CI,
 * inside a slot already, or without `flock` (macOS), where it warns.
 */
export async function enterHeavySlot(label: string): Promise<void> {
  const skip = heavySlotSkip(process.env);
  if (skip === 'no-flock')
    console.warn(`[heavy-slot] flock is missing, so ${label} runs without the machine-wide limit.`);
  if (skip) return;
  const directory = heavySlotDirectory(process.env);
  const command = [process.execPath, ...process.argv.slice(1)];
  let announced = false;
  for (;;) {
    for (let slot = 0; slot < HEAVY_SLOTS; slot += 1) {
      const code = await runInSlot(directory, slot, command, process.env);
      if (code !== SLOT_TAKEN) process.exit(code);
    }
    if (!announced) {
      announced = true;
      console.info(
        `[heavy-slot] ${label} waits: all ${HEAVY_SLOTS} heavy slots of this machine are busy (${directory}).`,
      );
    }
    await new Promise((resume) => setTimeout(resume, WAIT_MILLISECONDS + Math.random() * 2_000));
  }
}

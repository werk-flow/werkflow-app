import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { errorCode } from './error-code';

// One shared machine runs many worktrees' agents at once. `check:changed`,
// `test:verify` and the local test server's build each run their own tsc,
// Next build or browsers, and six at once exhausted memory (2026-10-29: load
// 82 on 14 cores). Each takes one of HEAVY_SLOTS machine-wide slots first and
// waits for a free one. A slot is a kernel `flock` on a file, held by a small
// holder process that watches its owner: the slot frees on release, and within
// a second of the owner's exit, also when it is killed. The owner keeps its own
// signal handling and exit code.

const HEAVY_SLOTS = 3;
/** Set in a slot's owner, so a heavy command it starts reuses that slot. */
export const HEAVY_SLOT_VARIABLE = 'WERKFLOW_HEAVY_SLOT';
/** flock's exit code when the slot is taken. */
const SLOT_TAKEN = 197;
const WAIT_MILLISECONDS = 5_000;

/** The process environment, or a test's stand-in. */
type Environment = Readonly<Record<string, string | undefined>>;
type HeavySlotSkip = 'ci' | 'nested' | 'no-flock' | undefined;
export type HeavySlot = {
  readonly slot: number;
  release(): void;
  /** Settles once the slot is free again. */
  readonly released: Promise<void>;
};

export const hasFlock = (): boolean => spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0;

/** Why this process runs without taking a slot, or undefined when it takes one. */
export function heavySlotSkip(
  environment: Environment,
  flockAvailable: () => boolean = hasFlock,
): HeavySlotSkip {
  if (environment.CI === 'true') return 'ci';
  if (environment[HEAVY_SLOT_VARIABLE]) return 'nested';
  return flockAvailable() ? undefined : 'no-flock';
}

/**
 * Takes `slot` for the process `owner` unless another process holds it.
 * Resolves with the held slot, or null when it is taken.
 */
export function tryHeavySlot(directory: string, slot: number, owner: number): Promise<HeavySlot | null> {
  mkdirSync(directory, { recursive: true });
  const holder = spawn(
    'flock',
    [
      '--nonblock',
      '--conflict-exit-code',
      String(SLOT_TAKEN),
      join(directory, `slot-${slot}`),
      'sh',
      '-c',
      'echo held; while kill -0 "$1" 2>/dev/null; do sleep 1; done',
      'heavy-slot',
      String(owner),
    ],
    // Its own process group: flock's shell inherits the lock, so a release ends the whole group.
    { stdio: ['ignore', 'pipe', 'inherit'], detached: true },
  );
  const exited = new Promise<number | null>((resolveExit) => holder.once('exit', resolveExit));
  return new Promise((resolveSlot, reject) => {
    holder.once('error', reject);
    void exited.then((code) => {
      if (code === SLOT_TAKEN) resolveSlot(null);
      else reject(new Error(`flock on heavy slot ${slot} exited ${code} before it held the slot.`));
    });
    holder.stdout.once('data', () => {
      // The holder outlives no owner and keeps no owner alive.
      holder.stdout.destroy();
      holder.unref();
      const release = (): void => {
        if (holder.pid === undefined) return;
        try {
          process.kill(-holder.pid, 'SIGTERM');
        } catch (error) {
          // ESRCH: the holder already ended with its owner.
          if (errorCode(error) !== 'ESRCH') throw error;
        }
      };
      resolveSlot({ slot, release, released: exited.then(() => undefined) });
    });
  });
}

/**
 * Waits for a free heavy slot and holds it for this process, or returns null
 * at once in CI, inside a slot already, or without `flock` (macOS), where it
 * warns.
 */
export async function acquireHeavySlot(label: string): Promise<HeavySlot | null> {
  const skip = heavySlotSkip(process.env);
  if (skip === 'no-flock')
    console.warn(`[heavy-slot] flock is missing, so ${label} runs without the machine-wide limit.`);
  if (skip) return null;
  const directory = process.env.WERKFLOW_HEAVY_SLOT_DIR ?? join(homedir(), '.cache', 'werkflow-heavy');
  let announced = false;
  for (;;) {
    for (let slot = 0; slot < HEAVY_SLOTS; slot += 1) {
      const held = await tryHeavySlot(directory, slot, process.pid);
      if (held) {
        process.env[HEAVY_SLOT_VARIABLE] = String(slot);
        if (announced) console.info(`[heavy-slot] ${label} took heavy slot ${slot}.`);
        return {
          ...held,
          release: () => {
            delete process.env[HEAVY_SLOT_VARIABLE];
            held.release();
          },
        };
      }
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

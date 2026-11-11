import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { runSessionCommand, withTestSession } from '../local-stack/test-session';
import { errorCode } from './error-code';
import {
  admission,
  heavySlotDirectory,
  processTable,
  readMachineRoom,
  runningHeavyCommands,
  START_COST,
  type Admission,
  type RoomReading,
} from './machine-room';

// One shared machine runs many worktrees' agents at once. `check:changed`,
// `test:verify` and the local test server's build each run their own tsc,
// Next build or browsers, and six at once exhausted memory (2026-10-29: load
// 82 on 14 cores). Each takes one of the machine's heavy slots first and
// waits for a free one. A slot is a kernel `flock` on a file, held by a small
// holder process that watches its owner: the slot frees on release, and within
// a second of the owner's exit, also when it is killed. The owner keeps its own
// signal handling and exit code.
//
// A free slot is not enough to start. The count below comes from total memory
// and never sees what the agents hold: on 2026-11-11 it allowed two heavy
// commands beside 18 agent processes. So each start also asks the machine's
// measured room (machine-room.ts), and the count is only the upper limit.

const GIB = 1024 ** 3;
// Measured on the 16 GB PC (werk-flow/werkflow-planning#294): the machine's own
// load, the shared stack (1.3 to 2.1 GiB), the agent CLIs and the system, keeps
// about 6 GiB, and a heavy command peaks at START_COST.heavy. Three slots there
// filled swap and stalled the machine for 40 min.
const MACHINE_LOAD_BYTES = 6 * GIB;

/** The most heavy slots a machine's memory holds: two on the 16 GB PC, at least one. */
export function heavySlotCount(totalMemoryBytes: number): number {
  return Math.max(1, Math.floor((totalMemoryBytes - MACHINE_LOAD_BYTES) / START_COST.heavy));
}

/**
 * The slots a heavy command may try now, with the reason to print.
 * - A machine without the load watch offers every slot: the count is its only limit.
 * - A blocked machine, or one without room for a further command, offers none.
 * - The only heavy command without measured room may take slot 0 alone. Two
 *   commands that start together then cannot both pass as "the only one".
 */
export function offeredHeavySlots(
  reading: RoomReading,
  heavy: readonly number[],
  count: number,
): Admission & { readonly slots: readonly number[] } {
  const verdict = admission('heavy', reading, heavy);
  const every = Array.from({ length: count }, (_, slot) => slot);
  if (!verdict.admitted) return { ...verdict, slots: [] };
  return { ...verdict, slots: verdict.unwatched || verdict.measured ? every : [0] };
}

/** Set in a slot's owner, so a heavy command it starts reuses that slot. */
export const HEAVY_SLOT_VARIABLE = 'WERKFLOW_HEAVY_SLOT';
/** flock's exit code when the slot is taken. */
const SLOT_TAKEN = 197;
const WAIT_MILLISECONDS = 5_000;

/** The process environment, or a test's stand-in. */
type Environment = Readonly<Record<string, string | undefined>>;
type HeavySlotSkip = 'ci' | 'nested' | 'no-flock' | undefined;
const FLOCK_MISSING =
  'Refused: flock is missing, so nothing would limit the heavy commands on this machine. Install it (macOS: `brew install flock`; Linux: the util-linux package) and run the command again.';
export type HeavySlot = HeldLock & { readonly slot: number };

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

/** A kernel lock held for a process: `released` settles once it is free again. */
export type HeldLock = { release(): void; readonly released: Promise<void> };

/**
 * Takes the kernel lock on `file` for the process `owner` unless another
 * process holds it. Resolves with the held lock, or null when it is taken.
 * The lock frees on release and within a second of the owner's exit, also when
 * the owner is killed, so no holder is ever stale.
 */
export function tryFlock(file: string, owner: number): Promise<HeldLock | null> {
  mkdirSync(dirname(file), { recursive: true });
  const holder = spawn(
    'flock',
    [
      '--nonblock',
      '--conflict-exit-code',
      String(SLOT_TAKEN),
      file,
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
  return new Promise((resolveLock, reject) => {
    holder.once('error', reject);
    void exited.then((code) => {
      if (code === SLOT_TAKEN) resolveLock(null);
      else reject(new Error(`flock on ${file} exited ${code} before it held the lock.`));
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
      resolveLock({ release, released: exited.then(() => undefined) });
    });
  });
}

/**
 * Takes `slot` for the process `owner` unless another process holds it.
 * Resolves with the held slot, or null when it is taken. While it is held, the
 * slot file names the owner's pid, so the room counts what its process tree
 * has not used yet (runningHeavyCommands).
 */
export async function tryHeavySlot(
  directory: string,
  slot: number,
  owner: number,
): Promise<HeavySlot | null> {
  const slotFile = join(directory, `slot-${slot}`);
  const held = await tryFlock(slotFile, owner);
  if (!held) return null;
  writeFileSync(slotFile, `${owner}\n`);
  return {
    slot,
    released: held.released,
    release: () => {
      // Cleared while the lock is still held, so the next holder's pid is never erased.
      writeFileSync(slotFile, '');
      held.release();
    },
  };
}

/**
 * Waits until the machine has room and a free heavy slot, and holds the slot
 * for this process. It returns null at once in CI and inside a slot already.
 * Without `flock` it throws: nothing would limit the command. An aborted
 * `signal` ends the wait with its reason.
 */
export async function acquireHeavySlot(label: string, signal?: AbortSignal): Promise<HeavySlot | null> {
  const skip = heavySlotSkip(process.env);
  if (skip === 'no-flock') throw new Error(FLOCK_MISSING);
  if (skip) return null;
  const directory = heavySlotDirectory(process.env);
  const count = heavySlotCount(totalmem());
  let announced = false;
  let warned = false;
  for (;;) {
    signal?.throwIfAborted();
    const reading = readMachineRoom();
    const heavy = 'room' in reading ? runningHeavyCommands(directory, processTable()) : [];
    const offer = offeredHeavySlots(reading, heavy, count);
    if (offer.unwatched && !warned) {
      warned = true;
      console.warn(
        `[heavy-slot] ${offer.reason} Until then ${label} is limited only by this machine's ${count} heavy slots.`,
      );
    }
    for (const slot of offer.slots) {
      const held = await tryHeavySlot(directory, slot, process.pid);
      if (held) {
        process.env[HEAVY_SLOT_VARIABLE] = String(slot);
        if (announced) console.info(`[heavy-slot] ${label} took heavy slot ${slot}.`);
        if (!offer.unwatched && !offer.measured) console.info(`[heavy-slot] ${label}: ${offer.reason}`);
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
      const why =
        offer.slots.length > 0
          ? `every heavy slot it may take is busy (${directory}). ${offer.reason}`
          : offer.reason;
      console.info(`[heavy-slot] ${label} waits: ${why}`);
    }
    // An abort during the attempts above ends the wait before it starts.
    signal?.throwIfAborted();
    await new Promise<void>((resume) => {
      const stop = (): void => {
        clearTimeout(timer);
        resume();
      };
      const timer = setTimeout(
        () => {
          signal?.removeEventListener('abort', stop);
          resume();
        },
        WAIT_MILLISECONDS + Math.random() * 2_000,
      );
      signal?.addEventListener('abort', stop, { once: true });
    });
  }
}

/**
 * Runs one command inside a heavy slot when `heavy` holds, and resolves with
 * its exit code. The command leads its own process group: Ctrl+C, a closed
 * terminal or SIGTERM stop its whole tree before the slot frees
 * (lib/testing/local-stack/test-session.ts). `scripts/heavy.ts` and
 * `scripts/lint.ts` use it.
 */
export function runInHeavySlot(command: readonly string[], heavy = true): Promise<number> {
  return withTestSession(async (signal) => {
    const slot = heavy ? await acquireHeavySlot(command.join(' ').slice(0, 80), signal) : null;
    try {
      return await runSessionCommand(command, { signal, stdio: 'inherit' });
    } finally {
      slot?.release();
    }
  });
}

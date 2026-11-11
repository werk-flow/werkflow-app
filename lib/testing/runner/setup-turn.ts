import { join } from 'node:path';
import { hasFlock, tryFlock, type HeldLock } from './heavy-slot';
import type { Admission } from './machine-room';

// A new worktree's setup (scripts/setup-worktree.ts) is the one start every
// thread makes, also a thread the owner starts in T3 Code, which no hook sees.
// So it waits here before its install: for the machine's one setup turn, and
// for the room a setup costs (machine-room.ts). A machine that takes no start
// keeps a new thread from adding to its overload, because every agent waits
// for `.t3/setup-done` before it runs anything.
//
// Only Node built-ins, here and in what this imports: the setup script runs
// before the install.

const POLL_MILLISECONDS = 30_000;
const REPEAT_MILLISECONDS = 5 * 60_000;

type SetupTurn = Pick<HeldLock, 'release'>;

/**
 * Takes the machine's one setup turn for the process `pid`, or resolves null
 * while another setup holds it. The turn is the kernel lock of the heavy slots
 * (heavy-slot.ts), which a killed setup frees by itself. A machine without
 * `flock` has no turns: every setup gets one.
 */
export function claimSetupTurn(
  directory: string,
  pid: number,
  flockAvailable: () => boolean = hasFlock,
): Promise<SetupTurn | null> {
  if (!flockAvailable()) return Promise.resolve({ release: () => undefined });
  return tryFlock(join(directory, 'setup-turn'), pid);
}

/**
 * Waits until this setup holds the machine's setup turn and the machine admits
 * a setup, and resolves with the verdict and the turn to release after the
 * install. While it waits it calls `announce` with the reason and the moment
 * the wait began: at once, again every five minutes, and when it gets the turn
 * and then waits for room. It calls it with undefined once the wait is over. It keeps the turn while it waits for room, so setups
 * install in the order they asked.
 */
export async function waitForSetupTurn(wait: {
  readonly claim: () => Promise<SetupTurn | null>;
  readonly admission: () => Admission;
  readonly announce: (waiting: { readonly reason: string; readonly since: number } | undefined) => void;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
}): Promise<{ readonly verdict: Admission; readonly turn: SetupTurn }> {
  const sleep = wait.sleep ?? ((milliseconds) => new Promise((resume) => setTimeout(resume, milliseconds)));
  const now = wait.now ?? Date.now;
  const since = now();
  let announcedAt: number | undefined;
  let announcedWithTurn = false;
  let turn: SetupTurn | null = null;
  for (;;) {
    turn ??= await wait.claim();
    const verdict = turn ? wait.admission() : undefined;
    if (turn && verdict?.admitted) {
      if (announcedAt !== undefined) wait.announce(undefined);
      return { verdict, turn };
    }
    const due = announcedAt === undefined || now() - announcedAt >= REPEAT_MILLISECONDS;
    if (due || announcedWithTurn !== (turn !== null)) {
      announcedAt = now();
      announcedWithTurn = turn !== null;
      wait.announce({
        since,
        reason:
          verdict?.reason ??
          "Another worktree's setup has this machine's one setup turn. This one installs after it.",
      });
    }
    await sleep(POLL_MILLISECONDS);
  }
}

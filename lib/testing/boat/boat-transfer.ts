import { BoatError } from './boat-api';

// A file moving to or from a Boat machine. Each attempt is a fresh request with its own deadline,
// so a dropped or stalled connection costs a retry, not the run: the machine is still alive and
// still holds the file. Only the user's interruption and a refusal a retry cannot change end it early.

export type TransferPolicy = {
  /** The wait before each retry: a transfer makes one attempt more than it has waits. */
  waits: readonly number[];
  /** How long one attempt may take before it is abandoned. */
  attemptMs: number;
};

export type TransferContext = {
  /** The user's interruption: it ends the transfer at once, never with a retry. */
  signal: AbortSignal;
  log: (line: string) => void;
  /** The wait between attempts; a test's stand-in returns at once. */
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

/** Waits `milliseconds`, or rejects as soon as `signal` aborts. */
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((done, fail) => {
    const stop = () => {
      clearTimeout(timer);
      fail(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      done();
    }, milliseconds);
    signal.addEventListener('abort', stop, { once: true });
  });
}

/** Boat refused the key, the request or the path: a fresh request gets the same answer. */
function permanent(error: unknown): boolean {
  return (
    error instanceof BoatError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

/** A failure in a few words: a network error by its code, everything else by its message. */
function briefly(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `attempt` until it succeeds, waiting `policy.waits` between attempts, and throws the last
 * failure once they are spent. Each attempt gets a signal that aborts at its deadline or on the
 * user's interruption, and must start a fresh request from it.
 */
export async function transfer<T>(
  what: string,
  policy: TransferPolicy,
  context: TransferContext,
  attempt: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const wait = context.wait ?? pause;
  for (let index = 0; ; index++) {
    context.signal.throwIfAborted();
    const deadline = AbortSignal.timeout(policy.attemptMs);
    try {
      return await attempt(AbortSignal.any([context.signal, deadline]));
    } catch (error) {
      if (context.signal.aborted) throw error;
      const stalled = `${what} took longer than ${policy.attemptMs / 1000} s`;
      const failure = deadline.aborted ? new Error(`${stalled}.`) : error;
      const next = policy.waits[index];
      if (next === undefined || permanent(failure)) throw failure;
      const why = deadline.aborted ? stalled : `${what} failed (${briefly(failure)})`;
      context.log(`${why}; attempt ${index + 2} of ${policy.waits.length + 1} in ${next / 1000} s.`);
      await wait(next, context.signal);
    }
  }
}

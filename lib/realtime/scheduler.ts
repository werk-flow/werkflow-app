/**
 * Trailing scheduler with a bounded maximum deferral. Each
 * call restarts the trailing delay so a burst lands as one run, but the run
 * can be deferred by at most `maxWaitMs` from the first call of the burst. A
 * sustained event stream therefore produces a read at least every
 * `maxWaitMs` instead of waiting for the stream to pause.
 */
export type TrailingScheduler = {
  schedule: () => void;
  /** Drops the pending run. Returns true when a run was pending. */
  cancel: () => boolean;
  pending: () => boolean;
};

/** A caller's own timers come as a pair, so a handle only ever reaches the clear that belongs to it. */
type SchedulerTimers =
  | { setTimer: (callback: () => void, delayMs: number) => unknown; clearTimer: (handle: unknown) => void }
  | { setTimer?: never; clearTimer?: never };

type SchedulerTiming = { delayMs: number; maxWaitMs: number; run: () => void; now?: () => number };

export function createTrailingScheduler(input: SchedulerTiming & SchedulerTimers): TrailingScheduler {
  if (input.maxWaitMs < input.delayMs) {
    throw new Error('A maximum wait cannot be shorter than the trailing delay.');
  }
  if (input.setTimer) return scheduleWith(input, input.setTimer, input.clearTimer);
  return scheduleWith(
    input,
    (callback, delayMs) => setTimeout(callback, delayMs),
    (handle) => clearTimeout(handle),
  );
}

function scheduleWith<Handle>(
  input: SchedulerTiming,
  setTimer: (callback: () => void, delayMs: number) => Handle,
  clearTimer: (handle: Handle) => void,
): TrailingScheduler {
  const now = input.now ?? (() => Date.now());
  let handle: Handle | null = null;
  let burstStartedAt: number | null = null;

  const fire = (): void => {
    handle = null;
    burstStartedAt = null;
    input.run();
  };

  return {
    schedule: () => {
      const current = now();
      if (burstStartedAt === null) burstStartedAt = current;
      if (handle !== null) clearTimer(handle);
      const remaining = burstStartedAt + input.maxWaitMs - current;
      handle = setTimer(fire, Math.max(0, Math.min(input.delayMs, remaining)));
    },
    cancel: () => {
      const wasPending = handle !== null;
      if (handle !== null) clearTimer(handle);
      handle = null;
      burstStartedAt = null;
      return wasPending;
    },
    pending: () => handle !== null,
  };
}

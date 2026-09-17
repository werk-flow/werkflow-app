export type RequestPriority = 'foreground' | 'background';

type WaitingRequest = {
  priority: RequestPriority;
  start: () => void;
};
type ScheduleRequest = <Result>(priority: RequestPriority, signal: AbortSignal, operation: () => Promise<Result>) => Promise<Result>;

/** Bound one server process's backend pressure while reserving room for user work. */
export function createRequestScheduler(maximum = 8, maximumBackground = 4): ScheduleRequest {
  if (!Number.isInteger(maximum) || maximum < 1 || !Number.isInteger(maximumBackground)
    || maximumBackground < 1 || maximumBackground > maximum) throw new Error('Invalid request concurrency limits');
  const waiting: WaitingRequest[] = [];
  let active = 0;
  let activeBackground = 0;
  let foregroundStarts = 0;

  function dispatch(): void {
    while (active < maximum) {
      let index = waiting.findIndex((request) => request.priority === 'foreground');
      const backgroundIndex = activeBackground < maximumBackground
        ? waiting.findIndex((request) => request.priority === 'background') : -1;
      // At most one full foreground burst before a waiting background read.
      if (backgroundIndex >= 0 && (index < 0 || foregroundStarts >= maximum)) index = backgroundIndex;
      if (index < 0) return;
      const [next] = waiting.splice(index, 1);
      if (!next) return;
      foregroundStarts = next.priority === 'foreground' ? Math.min(maximum, foregroundStarts + 1) : 0;
      next.start();
    }
  }

  return async function schedule<Result>(priority: RequestPriority, signal: AbortSignal, operation: () => Promise<Result>): Promise<Result> {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const pending: WaitingRequest = {
        priority,
        start: () => {
          signal.removeEventListener('abort', cancel);
          active++;
          if (priority === 'background') activeBackground++;
          resolve();
        },
      };
      function cancel(): void {
        const index = waiting.indexOf(pending);
        if (index < 0) return;
        waiting.splice(index, 1);
        reject(signal.reason);
        dispatch();
      }
      waiting.push(pending);
      signal.addEventListener('abort', cancel, { once: true });
      dispatch();
    });
    // Resume in the original caller's async context, not the request which
    // released the permit. Next.js and permission memoization depend on it.
    try {
      signal.throwIfAborted();
      return await operation();
    } finally {
      active--;
      if (priority === 'background') activeBackground--;
      dispatch();
    }
  };
}

export type ChangeSettlement = 'changed' | 'timed-out' | 'cancelled';

/**
 * Owns pending readers so timeout and unmount cannot masquerade as new data.
 * `mark()` names the changes seen so far; a wait given that mark settles at
 * once when a change already landed after it. A save that runs several
 * revalidating Server Actions marks before the first, because the render of
 * an earlier action can land before the wait starts.
 */
export function createChangeSettlement(): {
  wait: (timeoutMs: number, since?: number) => Promise<ChangeSettlement>;
  changed: () => void;
  cancel: () => void;
  mark: () => number;
} {
  const pending = new Set<(outcome: ChangeSettlement) => void>();
  let changes = 0;
  function finish(outcome: ChangeSettlement): void {
    for (const settle of pending) settle(outcome);
  }
  return {
    wait: (timeoutMs, since) => {
      if (since !== undefined && changes > since) return Promise.resolve('changed');
      return new Promise((resolve) => {
        const settle = (outcome: ChangeSettlement): void => {
          clearTimeout(timer);
          pending.delete(settle);
          resolve(outcome);
        };
        const timer = setTimeout(() => settle('timed-out'), timeoutMs);
        pending.add(settle);
      });
    },
    changed: () => {
      changes += 1;
      finish('changed');
    },
    cancel: () => finish('cancelled'),
    mark: () => changes,
  };
}

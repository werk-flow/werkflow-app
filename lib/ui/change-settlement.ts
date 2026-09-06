export type ChangeSettlement = 'changed' | 'timed-out' | 'cancelled';

/** Owns pending readers so timeout and unmount cannot masquerade as new data. */
export function createChangeSettlement(): {
  wait: (timeoutMs: number) => Promise<ChangeSettlement>;
  changed: () => void;
  cancel: () => void;
} {
  const pending = new Set<(outcome: ChangeSettlement) => void>();
  function finish(outcome: ChangeSettlement): void {
    for (const settle of pending) settle(outcome);
  }
  return {
    wait: (timeoutMs) => new Promise((resolve) => {
      const settle = (outcome: ChangeSettlement): void => {
        clearTimeout(timer);
        pending.delete(settle);
        resolve(outcome);
      };
      const timer = setTimeout(() => settle('timed-out'), timeoutMs);
      pending.add(settle);
    }),
    changed: () => finish('changed'),
    cancel: () => finish('cancelled'),
  };
}

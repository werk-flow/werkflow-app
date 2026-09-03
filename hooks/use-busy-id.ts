'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Row-scoped pending state for lists with one action per row: the spinner
 * appears on the row that was clicked and the other rows stay enabled for
 * reading. Generalizes the `busyId` / `try` / `finally` triplet that a dozen
 * sections hand-wrote. Concurrent ids are tracked, so two quick clicks on
 * different rows both show their own spinner.
 */
export function useBusyIds<Id extends string = string>(): {
  busyIds: ReadonlySet<Id>;
  isBusy: (id: Id) => boolean;
  anyBusy: boolean;
  run: <Result>(id: Id, task: () => Promise<Result>) => Promise<Result>;
} {
  const [busyIds, setBusyIds] = useState<ReadonlySet<Id>>(() => new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async <Result,>(id: Id, task: () => Promise<Result>) => {
    setBusyIds((current) => new Set(current).add(id));
    try {
      return await task();
    } finally {
      if (mountedRef.current) {
        setBusyIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    }
  }, []);

  const isBusy = useCallback((id: Id) => busyIds.has(id), [busyIds]);

  return { busyIds, isBusy, anyBusy: busyIds.size > 0, run };
}

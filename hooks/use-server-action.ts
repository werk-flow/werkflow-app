'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared pending gate for a surface with several server-action flows: `run`
 * executes any async task and `isPending` is true while at least one runs.
 * Tasks are deliberately NOT mutually exclusive — independent flows (a
 * detail fetch while another action settles) must all run, exactly like the
 * separate `useTransition`s this replaces; double-submit protection comes
 * from the buttons the flag disables.
 */
export function usePendingTask(): {
  run: (task: () => Promise<void>) => Promise<void>;
  isPending: boolean;
} {
  const { run, isPending } = useServerAction(
    async (task: () => Promise<void>) => task()
  );
  return { run, isPending };
}

/**
 * Pending-state helper for server actions (client freshness contract rule 6).
 * `isPending` binds to the awaited server call and nothing else — never to a
 * router transition: a router-entangled `useTransition` kept controls
 * disabled after unrelated Realtime refreshes (the P1-16 MetadataSection
 * defect). ESLint bans async `startTransition` callbacks in product code so
 * this is the one submit path.
 *
 * Concurrent calls all run and each settles independently (`isPending` while
 * any is in flight): programmatic invocations — an effect-driven fetch, a
 * queued follow-up — must never be silently dropped. Double-submit
 * protection is the disabled state the flag drives, matching the
 * `useTransition` semantics this replaces. Errors propagate to the caller
 * after the pending count settles.
 */
export type ServerActionPhase = 'idle' | 'pending' | 'settling';

/**
 * `settle` (optional) names the read that makes the surface authoritative
 * again after the action resolves: a `useLiveView` refresh, or a promise that
 * resolves when refreshed server props arrive. `run` still returns as soon
 * as the action does, so a dialog closes immediately; `isSettling` stays true
 * until the settle read finishes, and the landing surface shows that window
 * with an inline indicator instead of a skeleton (feedback canon, 2026-09-03).
 * A settle failure never rejects `run`; the live view owns that error.
 */
export function useServerAction<Args extends readonly unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
  options: { settle?: (result: Result) => Promise<unknown> } = {}
): {
  run: (...args: Args) => Promise<Result>;
  isPending: boolean;
  isSettling: boolean;
  phase: ServerActionPhase;
} {
  const [pendingCount, setPendingCount] = useState(0);
  const [settlingCount, setSettlingCount] = useState(0);
  const mountedRef = useRef(true);
  const actionRef = useRef(action);
  const settleRef = useRef(options.settle);

  useEffect(() => {
    actionRef.current = action;
    settleRef.current = options.settle;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (...args: Args): Promise<Result> => {
    setPendingCount((count) => count + 1);
    let result: Result;
    try {
      result = await actionRef.current(...args);
    } finally {
      if (mountedRef.current) {
        setPendingCount((count) => count - 1);
      }
    }
    const settle = settleRef.current;
    if (settle && mountedRef.current) {
      setSettlingCount((count) => count + 1);
      void settle(result)
        .catch(() => undefined)
        .finally(() => {
          if (mountedRef.current) setSettlingCount((count) => count - 1);
        });
    }
    return result;
  }, []);

  const isPending = pendingCount > 0;
  const isSettling = settlingCount > 0;
  return {
    run,
    isPending,
    isSettling,
    phase: isPending ? 'pending' : isSettling ? 'settling' : 'idle',
  };
}

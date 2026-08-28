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
export function useServerAction<Args extends readonly unknown[], Result>(
  action: (...args: Args) => Promise<Result>
): {
  run: (...args: Args) => Promise<Result>;
  isPending: boolean;
} {
  const [pendingCount, setPendingCount] = useState(0);
  const mountedRef = useRef(true);
  const actionRef = useRef(action);

  useEffect(() => {
    actionRef.current = action;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (...args: Args): Promise<Result> => {
    setPendingCount((count) => count + 1);
    try {
      return await actionRef.current(...args);
    } finally {
      if (mountedRef.current) {
        setPendingCount((count) => count - 1);
      }
    }
  }, []);

  return { run, isPending: pendingCount > 0 };
}

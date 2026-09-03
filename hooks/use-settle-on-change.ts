'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * The settle read for a surface whose authority arrives as refreshed server
 * props (a `router.refresh()` landing) rather than a `useLiveView` read.
 * `waitForChange()` resolves the next time `value` changes identity, so a
 * dialog edit can keep the changed row marked as settling
 * (`useServerAction`'s `isSettling`, `useBusyIds`) until the authoritative
 * row is on screen. The timeout keeps a lost refresh from pinning the
 * indicator forever; the live-view family owns the error in that case.
 */
export function useSettleOnChange(value: unknown, timeoutMs = 15_000): () => Promise<void> {
  const resolversRef = useRef<Array<() => void>>([]);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const resolvers = resolversRef.current;
    resolversRef.current = [];
    for (const resolve of resolvers) resolve();
  }, [value]);

  useEffect(() => {
    const resolvers = resolversRef;
    return () => {
      for (const resolve of resolvers.current) resolve();
      resolvers.current = [];
    };
  }, []);

  return useCallback(
    () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          resolversRef.current = resolversRef.current.filter((entry) => entry !== settle);
          resolve();
        }, timeoutMs);
        const settle = () => {
          clearTimeout(timer);
          resolve();
        };
        resolversRef.current.push(settle);
      }),
    [timeoutMs]
  );
}

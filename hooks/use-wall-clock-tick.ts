'use client';

import { useEffect, useState } from 'react';

/**
 * The one wall-clock render tick: elapsed counters, countdowns and the
 * calendar's now line re-render every `periodMs` while `enabled`. It reads
 * the clock only, never the server (live data comes from useLiveView).
 */
function useTickEffect(
  setNow: (now: number) => void,
  periodMs: number,
  enabled: boolean,
  immediate: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    if (immediate) tick();
    // eslint-disable-next-line no-restricted-syntax -- the one wall-clock render tick, no data polling
    const interval = window.setInterval(tick, periodMs);
    return () => window.clearInterval(interval);
  }, [enabled, immediate, periodMs, setNow]);
}

/** Date.now() at mount, then refreshed every `periodMs` while `enabled`. For client-only state. */
export function useWallClockTick(periodMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useTickEffect(setNow, periodMs, enabled, false);
  return now;
}

/**
 * null on the server and in the hydrating render, so both render the same
 * text; then Date.now() right after mount and every `periodMs` while
 * `enabled`. For values rendered on the server too.
 */
export function useMountedWallClockTick(periodMs: number, enabled = true): number | null {
  const [now, setNow] = useState<number | null>(null);
  useTickEffect(setNow, periodMs, enabled, true);
  return now;
}

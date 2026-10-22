'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { delayToNextTickBoundary } from '@/lib/date-time/tick-boundary';

/**
 * The one interval of product code (`realtime/no-interval`): calls `onTick`
 * on every whole multiple of `periodMs` of the wall clock (a minute tick when
 * the minute changes) and returns the stop function. It reads the clock only,
 * never the server; live data comes from useLiveView.
 */
export function startWallClockInterval(onTick: () => void, periodMs: number): () => void {
  let interval: number | null = null;
  const alignment = window.setTimeout(
    () => {
      interval = window.setInterval(onTick, periodMs);
      onTick();
    },
    delayToNextTickBoundary(Date.now(), periodMs),
  );
  return () => {
    window.clearTimeout(alignment);
    if (interval !== null) window.clearInterval(interval);
  };
}

// The stored instant while it is younger than one period, else the clock: a
// tick that starts again after a pause shows the current time at once, and a
// fresh seed costs no second render.
function currentInstant(stored: number | null, periodMs: number): number {
  const now = Date.now();
  return stored !== null && now - stored < periodMs ? stored : now;
}

/**
 * The one wall-clock render tick: elapsed counters, countdowns and the
 * calendar's now line re-render every `periodMs` while `enabled`, and, with
 * an `until` instant, stop after the first tick that reaches it.
 */
function useTickEffect(
  setNow: (update: (stored: number | null) => number) => void,
  periodMs: number,
  enabled: boolean,
  until: number | null,
): void {
  useEffect(() => {
    if (!enabled) return;
    const started = Date.now();
    // Past `until` no tick follows, so the value must be the present instant, never a fresh-but-earlier seed.
    if (until !== null && started >= until) {
      setNow(() => started);
      return;
    }
    setNow((stored) => currentInstant(stored, periodMs));
    const stop = startWallClockInterval(() => {
      const now = Date.now();
      setNow(() => now);
      if (until !== null && now >= until) stop();
    }, periodMs);
    return stop;
  }, [enabled, periodMs, setNow, until]);
}

/**
 * Date.now() from the first render, then refreshed every `periodMs` while
 * `enabled` and until the `until` instant (epoch milliseconds) has passed.
 * For client-only state.
 */
export function useWallClockTick(periodMs: number, enabled = true, until: number | null = null): number {
  const [now, setNow] = useState(() => Date.now());
  useTickEffect(setNow, periodMs, enabled, until);
  return now;
}

const subscribeToNothing = () => () => {};
const notHydrating = () => false;
const hydrating = () => true;

/**
 * For values rendered on the server too. null on the server and in the
 * hydrating render, so both render the same text, and the current instant
 * right after hydration. A component that mounts on the client without
 * hydration (a client navigation, a dialog) reads the clock in its first
 * render. Refreshed every `periodMs` while `enabled`.
 */
export function useMountedWallClockTick(periodMs: number, enabled = true): number | null {
  const isHydrating = useSyncExternalStore(subscribeToNothing, notHydrating, hydrating);
  const [now, setNow] = useState<number | null>(() => (isHydrating ? null : Date.now()));
  useTickEffect(setNow, periodMs, enabled, null);
  return now;
}

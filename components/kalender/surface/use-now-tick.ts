'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/** A fixed instant for fixtures; null is the wall clock. */
export const CalendarClockContext = createContext<number | null>(null);

/** The instant the views judge "now" by: the fixture's fixed clock or the wall clock. */
export function useClock(): () => number {
  const fixed = useContext(CalendarClockContext);
  return useCallback(() => fixed ?? Date.now(), [fixed]);
}

/** A wall-clock tick once a minute for the now indicator, open blocks and the started-occurrence lock. */
export function useNowTick(enabled = true): number {
  const fixed = useContext(CalendarClockContext);
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (!enabled || fixed !== null) return;
    // eslint-disable-next-line no-restricted-syntax -- wall-clock render tick, no data polling
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [enabled, fixed]);
  return fixed ?? now;
}

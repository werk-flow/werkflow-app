'use client';

import { createContext, useCallback, useContext } from 'react';
import { useWallClockTick } from '@/hooks/use-wall-clock-tick';

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
  const now = useWallClockTick(60_000, enabled && fixed === null);
  return fixed ?? now;
}

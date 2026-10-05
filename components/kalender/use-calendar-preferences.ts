'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarPreferences } from '@/lib/calendar/preferences';
import { saveCalendarPreferences } from '@/lib/calendar/preferences-actions';

const PREFERENCE_SAVE_DELAY_MS = 600;

/**
 * The caller's calendar preferences: local state first; every change saves at
 * once except the search text, which saves after the burst. Unmount flushes
 * a pending save.
 */
export function useCalendarPreferences(
  organizationId: string,
  initialPreferences: CalendarPreferences,
): {
  preferences: CalendarPreferences;
  updatePreferences: (update: Partial<CalendarPreferences>) => void;
} {
  const [preferences, setPreferences] = useState<CalendarPreferences>(initialPreferences);
  const preferencesRef = useRef(initialPreferences);
  const saveTimerRef = useRef<number | null>(null);
  const pendingPreferencesRef = useRef<CalendarPreferences | null>(null);
  const flushPreferences = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const pending = pendingPreferencesRef.current;
    pendingPreferencesRef.current = null;
    // eslint-disable-next-line no-restricted-syntax -- a failed save costs nothing but the persistence; the view keeps the value
    if (pending) void saveCalendarPreferences(organizationId, pending).catch(() => undefined);
  }, [organizationId]);
  const updatePreferences = useCallback(
    (update: Partial<CalendarPreferences>) => {
      const next = { ...preferencesRef.current, ...update };
      preferencesRef.current = next;
      setPreferences(next);
      pendingPreferencesRef.current = next;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      // A click on a toggle, a filter or the horizon saves at once; the search text is the one burst.
      if (Object.keys(update).every((key) => key === 'search')) {
        saveTimerRef.current = window.setTimeout(flushPreferences, PREFERENCE_SAVE_DELAY_MS);
        return;
      }
      flushPreferences();
    },
    [flushPreferences],
  );
  useEffect(() => flushPreferences, [flushPreferences]);
  return { preferences, updatePreferences };
}

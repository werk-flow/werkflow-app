'use client';

import { useEffect } from 'react';

import { clearTodayOnDevice } from '@/lib/field-sync/device/today-wipe';

/**
 * Wipes the today snapshot once more on the page a person lands on after a session ends (decision
 * record 0010, the 2026-11-11 amendment). Every sign-out lands on an `(auth)` page after its
 * session ended, so a day another tab saved while that session still answered is gone, whatever
 * that tab does. The wipe's signal also makes open start pages drop their claims.
 */
export function TodayLandingWipe(): null {
  useEffect(() => {
    void clearTodayOnDevice();
  }, []);
  return null;
}

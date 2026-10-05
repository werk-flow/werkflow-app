'use client';

import { useState, useEffect } from 'react';
import { getNonNegativeElapsedMs } from '@/lib/time-tracking/helpers';
import type { LiveClockState } from '@/lib/time-tracking/types';

function formatLiveTime(baseMinutes: number, statusStartedAt: string | null, isClockedIn: boolean): string {
  let totalMs = baseMinutes * 60 * 1000;

  if (isClockedIn && statusStartedAt) {
    totalMs += getNonNegativeElapsedMs(statusStartedAt);
  }

  const hours = Math.floor(totalMs / (1000 * 60 * 60));
  const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((totalMs % (1000 * 60)) / 1000);

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function calculateLiveTotalMinutes(
  baseMinutes: number,
  statusStartedAt: string | null,
  isClockedIn: boolean,
): number {
  let totalMinutes = baseMinutes;

  if (isClockedIn && statusStartedAt) {
    totalMinutes += getNonNegativeElapsedMs(statusStartedAt) / (1000 * 60);
  }

  return totalMinutes;
}

// Today's running clock: the formatted total and its minutes, refreshed
// every second while the dashboard is mounted.
export function useZeiterfassungLiveTime(effectiveState: LiveClockState): {
  liveTime: string;
  liveTotalMinutes: number;
} {
  const [liveTime, setLiveTime] = useState('00:00:00');
  const [liveTotalMinutes, setLiveTotalMinutes] = useState(0);

  useEffect(() => {
    const updateLiveValues = () => {
      setLiveTime(
        formatLiveTime(
          effectiveState.todayMinutes,
          effectiveState.statusStartedAt,
          effectiveState.isClockedIn,
        ),
      );
      setLiveTotalMinutes(
        calculateLiveTotalMinutes(
          effectiveState.todayMinutes,
          effectiveState.statusStartedAt,
          effectiveState.isClockedIn,
        ),
      );
    };

    updateLiveValues();

    // eslint-disable-next-line no-restricted-syntax -- wall-clock render tick, no data polling
    const interval = setInterval(updateLiveValues, 1000);
    return () => clearInterval(interval);
  }, [effectiveState.todayMinutes, effectiveState.statusStartedAt, effectiveState.isClockedIn]);

  return { liveTime, liveTotalMinutes };
}

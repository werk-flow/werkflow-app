'use client';

import { useMountedWallClockTick } from '@/hooks/use-wall-clock-tick';
import { getNonNegativeElapsedMs, liveMinutes } from '@/lib/time-tracking/helpers';
import type { LiveClockState } from '@/lib/time-tracking/types';

function formatLiveTime(baseMinutes: number, runningSince: string | null, nowMs: number): string {
  const totalMs = baseMinutes * 60 * 1000 + getNonNegativeElapsedMs(runningSince, nowMs);

  const hours = Math.floor(totalMs / (1000 * 60 * 60));
  const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((totalMs % (1000 * 60)) / 1000);

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Today's running clock: the formatted total and its minutes, refreshed
// every second while the dashboard is mounted. The server and the hydrating
// render show 00:00:00.
export function useZeiterfassungLiveTime(effectiveState: LiveClockState): {
  liveTime: string;
  liveTotalMinutes: number;
} {
  const nowMs = useMountedWallClockTick(1000);
  if (nowMs === null) return { liveTime: '00:00:00', liveTotalMinutes: 0 };

  const runningSince = effectiveState.isClockedIn ? effectiveState.statusStartedAt : null;
  return {
    liveTime: formatLiveTime(effectiveState.todayMinutes, runningSince, nowMs),
    liveTotalMinutes: liveMinutes(effectiveState.todayMinutes, runningSince, nowMs),
  };
}

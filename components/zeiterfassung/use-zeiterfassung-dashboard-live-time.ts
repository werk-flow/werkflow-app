'use client';

import { useMountedWallClockTick } from '@/hooks/use-wall-clock-tick';
import { getNonNegativeElapsedMs, liveMinutes, todayRunningSince } from '@/lib/time-tracking/helpers';
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

/** Shown for a running clock before the client knows the time. */
const RUNNING_CLOCK_PLACEHOLDER = '—';

/**
 * Today's running clock, refreshed every second: the formatted total, its
 * minutes, and the instant they were computed for (null before the client
 * knows the time). A client mount reads the clock in its first render. The
 * server and the hydrating render cannot know the client's time: they show
 * the recorded minutes, which are exact while nothing runs, and a placeholder
 * instead of a running clock, never a false zero.
 */
export function useZeiterfassungLiveTime(effectiveState: LiveClockState): {
  liveTime: string;
  liveTotalMinutes: number;
  nowMs: number | null;
} {
  const nowMs = useMountedWallClockTick(1000);
  const runningSince = effectiveState.isClockedIn ? effectiveState.statusStartedAt : null;
  if (nowMs === null) {
    return {
      liveTime:
        runningSince === null
          ? formatLiveTime(effectiveState.todayMinutes, null, 0)
          : RUNNING_CLOCK_PLACEHOLDER,
      liveTotalMinutes: effectiveState.todayMinutes,
      nowMs,
    };
  }
  // Today counts a running activity from midnight at the earliest.
  const todaySince = todayRunningSince(runningSince, nowMs);
  return {
    liveTime: formatLiveTime(effectiveState.todayMinutes, todaySince, nowMs),
    liveTotalMinutes: liveMinutes(effectiveState.todayMinutes, todaySince, nowMs),
    nowMs,
  };
}

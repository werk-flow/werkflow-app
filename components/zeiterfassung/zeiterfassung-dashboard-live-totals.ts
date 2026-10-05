import { getNonNegativeElapsedMs } from '@/lib/time-tracking/helpers';
import { computeBreakdownForSettings } from '@/lib/time-tracking/settings';
import type { ClockTimelineSegment, LiveClockState } from '@/lib/time-tracking/types';

export type ZeiterfassungLiveTotals = {
  breakdown: ReturnType<typeof computeBreakdownForSettings>;
  liveBreakMinutes: number;
  workPercentage: number | null;
  ringTimelineSegments: ClockTimelineSegment[] | undefined;
  liveTravelMinutes: number;
  liveStandbyMinutes: number;
  liveCalloutMinutes: number;
  liveInternalMinutes: number;
};

// Today's totals including the still-running activity. Reads the wall clock,
// so the dashboard calls it on every render of its one-second tick.
export function computeZeiterfassungLiveTotals(
  effectiveState: LiveClockState,
  liveTotalMinutes: number,
  todayTargetMinutes: number | undefined,
): ZeiterfassungLiveTotals {
  const liveTimelineSegments: ClockTimelineSegment[] = (() => {
    const segments = [...(effectiveState.timelineSegments ?? [])];
    if (!effectiveState.isClockedIn || !effectiveState.statusStartedAt) {
      return segments;
    }

    const liveMinutes = getNonNegativeElapsedMs(effectiveState.statusStartedAt) / (1000 * 60);
    if (liveMinutes <= 0) {
      return segments;
    }

    segments.push({
      type: effectiveState.status === 'on_break' ? 'break' : 'work',
      minutes: liveMinutes,
    });
    return segments;
  })();

  const trackedLiveBreakMinutes =
    effectiveState.breakMode === 'manual'
      ? effectiveState.breakMinutes +
        (effectiveState.status === 'on_break' && effectiveState.statusStartedAt
          ? getNonNegativeElapsedMs(effectiveState.statusStartedAt) / (1000 * 60)
          : 0)
      : effectiveState.breakMinutes;

  const breakdown = computeBreakdownForSettings(
    liveTotalMinutes,
    trackedLiveBreakMinutes,
    effectiveState,
    todayTargetMinutes,
  );
  const liveWorkMinutes = breakdown.workMinutes;
  const liveBreakMinutes = breakdown.breakMinutes;
  const workPercentage =
    todayTargetMinutes !== undefined && todayTargetMinutes > 0
      ? Math.min(Math.round((liveWorkMinutes / todayTargetMinutes) * 100), 100)
      : null;
  const ringTimelineSegments = effectiveState.breakMode === 'manual' ? liveTimelineSegments : undefined;
  const currentActivityMinutes =
    effectiveState.isClockedIn && effectiveState.statusStartedAt
      ? getNonNegativeElapsedMs(effectiveState.statusStartedAt) / (1000 * 60)
      : 0;
  const liveTravelMinutes =
    effectiveState.travelMinutes +
    (effectiveState.currentActivity?.kind === 'travel' ? currentActivityMinutes : 0);
  const liveStandbyMinutes =
    effectiveState.standbyMinutes +
    (effectiveState.currentActivity?.kind === 'standby' ? currentActivityMinutes : 0);
  const liveCalloutMinutes =
    effectiveState.calloutMinutes +
    (effectiveState.currentActivity?.kind === 'callout' ? currentActivityMinutes : 0);
  const liveInternalMinutes =
    effectiveState.internalMinutes +
    (effectiveState.currentActivity?.kind === 'internal_activity' ? currentActivityMinutes : 0);

  return {
    breakdown,
    liveBreakMinutes,
    workPercentage,
    ringTimelineSegments,
    liveTravelMinutes,
    liveStandbyMinutes,
    liveCalloutMinutes,
    liveInternalMinutes,
  };
}

import { liveMinutes } from '@/lib/time-tracking/helpers';
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

// Today's totals including the still-running activity at `nowMs`, the
// dashboard's one-second tick. Before the client knows the time (null) the
// totals hold the recorded minutes only, like the clock itself.
export function computeZeiterfassungLiveTotals(
  effectiveState: LiveClockState,
  liveTotalMinutes: number,
  todayTargetMinutes: number | undefined,
  nowMs: number | null,
): ZeiterfassungLiveTotals {
  const runningSince = nowMs !== null && effectiveState.isClockedIn ? effectiveState.statusStartedAt : null;
  // The minutes of the still-running activity; 0 when nothing runs.
  const currentActivityMinutes = liveMinutes(0, runningSince, nowMs ?? 0);

  const liveTimelineSegments: ClockTimelineSegment[] = (() => {
    const segments = [...(effectiveState.timelineSegments ?? [])];
    if (currentActivityMinutes <= 0) {
      return segments;
    }

    segments.push({
      type: effectiveState.status === 'on_break' ? 'break' : 'work',
      minutes: currentActivityMinutes,
    });
    return segments;
  })();

  const trackedLiveBreakMinutes =
    effectiveState.breakMode === 'manual'
      ? liveMinutes(
          effectiveState.breakMinutes,
          effectiveState.status === 'on_break' ? runningSince : null,
          nowMs ?? 0,
        )
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

'use client';

import { useMemo } from 'react';

import { useMemberStatus } from '@/hooks/use-member-status';
import { useWallClockTick } from '@/hooks/use-wall-clock-tick';
import { useWeeklyTimeData } from '@/hooks/use-weekly-time-data';
import type { BreakPolicy } from '@/lib/time-tracking/settings';
import { getTargetSourceHint, type DailyTarget } from '@/lib/personnel/targets';
import type { WeeklyTimeDataPoint, WeeklyTimeLabel } from '@/lib/time-tracking/types';
import { memberLiveDay } from '@/lib/time-tracking/member-day';

/** The member's week as the server read it, with the resolved daily targets. */
export type MemberInitialWeek = {
  weekData: WeeklyTimeDataPoint[];
  todayIndex: number;
  weekLabel: WeeklyTimeLabel;
  weekTargets: DailyTarget[];
};

/** Worked minutes as a share of the target, capped at 100; 0 without a target. */
function progressPercent(workMinutes: number, targetMinutes: number): number {
  return targetMinutes > 0 ? Math.min(100, Math.round((workMinutes / targetMinutes) * 100)) : 0;
}

/** The server's week as the week view's initial data; none when its read failed. */
function initialWeekOptions(initialWeek: MemberInitialWeek | null) {
  if (!initialWeek) return {};
  return {
    initialWeekData: initialWeek.weekData,
    initialTodayIndex: initialWeek.todayIndex,
    initialWeekLabel: initialWeek.weekLabel,
    initialWeekTargets: initialWeek.weekTargets,
  };
}

type MitarbeiterDetailLiveTimeInput = {
  organizationId: string;
  userId: string;
  breakPolicy: BreakPolicy;
  /** Null when the server read failed: the week then loads on mount. */
  initialWeek: MemberInitialWeek | null;
};

export type MitarbeiterDetailLiveTime = ReturnType<typeof useMitarbeiterDetailLiveTime>;

/** One member's live clock status, week data and today's progress. */
export function useMitarbeiterDetailLiveTime({
  organizationId,
  userId,
  breakPolicy,
  initialWeek,
}: MitarbeiterDetailLiveTimeInput) {
  const memberIds = useMemo(() => [userId], [userId]);

  const {
    statusMap,
    isStale: statusStale,
    error: statusError,
    refetch: refetchStatus,
  } = useMemberStatus({
    organizationId,
    memberIds,
    breakPolicy,
  });
  const status = statusMap[userId];

  const {
    weekData,
    weekTargets,
    targetsStale,
    todayIndex,
    weekLabel,
    isLoading: weekLoading,
    isStale: weekStale,
    error: weekError,
    refetch: refetchWeek,
  } = useWeeklyTimeData({
    organizationId,
    userId,
    breakPolicy,
    ...initialWeekOptions(initialWeek),
  });

  // This member's resolved target for today (P1-04). Until it is known the
  // card shows the worked minutes only, never a progress against 8h.
  const todayTarget: DailyTarget | undefined = weekTargets?.[todayIndex];
  const todayTargetMinutes = todayTarget?.targetMinutes ?? 0;
  const todayTargetHint = todayTarget ? getTargetSourceHint(todayTarget) : null;

  // Today's minutes with the running ones, from the first render that knows
  // the status, refreshed every minute. The status is a client read, so the
  // server and the hydrating render have none and show no clock-dependent value.
  const nowMs = useWallClockTick(60_000);
  const { presenceMinutes: liveTotalMinutes, breakdown: memberBreakdown } = memberLiveDay(
    status,
    todayTarget?.targetMinutes,
    nowMs,
  );
  const dailyPercentage = progressPercent(memberBreakdown.workMinutes, todayTargetMinutes);

  return {
    status,
    statusError,
    statusStale,
    refetchStatus,
    weekData,
    weekLoading,
    weekStale,
    weekError,
    refetchWeek,
    weekTargets,
    targetsStale,
    todayIndex,
    weekLabel,
    liveTotalMinutes,
    todayTarget,
    todayTargetMinutes,
    todayTargetHint,
    memberBreakdown,
    dailyPercentage,
  };
}

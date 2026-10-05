'use client';

import { useState, useEffect, useMemo } from 'react';

import { useMemberStatus, type MemberStatus } from '@/hooks/use-member-status';
import { useWeeklyTimeData } from '@/hooks/use-weekly-time-data';
import { getNonNegativeElapsedMs, WORK_GOAL_MINUTES } from '@/lib/time-tracking/helpers';
import { computeBreakdownForSettings, type OrgBreakMode } from '@/lib/time-tracking/settings';
import { getTargetSourceHint, type DailyTarget } from '@/lib/personnel/targets';

const DAILY_GOAL_MINUTES = WORK_GOAL_MINUTES;

function computeLiveBreakMinutesForMember(
  status: MemberStatus | undefined,
  liveTotalMinutes: number,
  defaultBreakMode: OrgBreakMode,
  defaultAutoBreakThresholdMinutes: number,
  defaultAutoBreakDurationMinutes: number,
  targetMinutes?: number,
) {
  const effectiveBreakMode = status?.breakMode ?? defaultBreakMode;
  const trackedLiveBreakMinutes =
    effectiveBreakMode === 'manual'
      ? (status?.breakMinutes ?? 0) +
        (status?.status === 'on_break' && status.statusStartedAt
          ? getNonNegativeElapsedMs(status.statusStartedAt) / 60000
          : 0)
      : (status?.breakMinutes ?? 0);

  return computeBreakdownForSettings(
    liveTotalMinutes,
    trackedLiveBreakMinutes,
    {
      breakMode: effectiveBreakMode,
      autoBreakThresholdMinutes: status?.autoBreakThresholdMinutes ?? defaultAutoBreakThresholdMinutes,
      autoBreakDurationMinutes: status?.autoBreakDurationMinutes ?? defaultAutoBreakDurationMinutes,
    },
    targetMinutes,
  );
}

type MitarbeiterDetailLiveTimeInput = {
  organizationId: string;
  userId: string;
  breakMode: OrgBreakMode;
  autoBreakThresholdMinutes: number;
  autoBreakDurationMinutes: number;
};

export type MitarbeiterDetailLiveTime = ReturnType<typeof useMitarbeiterDetailLiveTime>;

/** One member's live clock status, week data and today's progress. */
export function useMitarbeiterDetailLiveTime({
  organizationId,
  userId,
  breakMode,
  autoBreakThresholdMinutes,
  autoBreakDurationMinutes,
}: MitarbeiterDetailLiveTimeInput) {
  const memberIds = useMemo(() => [userId], [userId]);

  const {
    statusMap,
    error: statusError,
    refetch: refetchStatus,
  } = useMemberStatus({
    organizationId,
    memberIds,
    breakMode,
    autoBreakThresholdMinutes,
    autoBreakDurationMinutes,
  });
  const status = statusMap[userId];

  const { weekData, weekTargets, todayIndex, weekLabel } = useWeeklyTimeData({
    organizationId,
    userId,
    breakMode,
    autoBreakThresholdMinutes,
    autoBreakDurationMinutes,
  });

  const [liveTotalMinutes, setLiveTotalMinutes] = useState(0);
  useEffect(() => {
    const compute = () => {
      let base = status?.todayMinutes ?? 0;
      if (status?.isClockedIn && status.statusStartedAt) {
        base += getNonNegativeElapsedMs(status.statusStartedAt) / 60000;
      }
      setLiveTotalMinutes(base);
    };
    compute();
    // eslint-disable-next-line no-restricted-syntax -- wall-clock render tick, no data polling
    const interval = setInterval(compute, 60000);
    return () => clearInterval(interval);
  }, [status?.isClockedIn, status?.statusStartedAt, status?.todayMinutes]);

  // This member's resolved target for today (P1-04); the legacy 8h value only
  // appears as the visibly labeled `default` source.
  const todayTarget: DailyTarget | undefined = weekTargets?.[todayIndex];
  const todayTargetMinutes = todayTarget?.targetMinutes ?? DAILY_GOAL_MINUTES;
  const todayTargetHint = todayTarget ? getTargetSourceHint(todayTarget) : null;

  const memberBreakdown = computeLiveBreakMinutesForMember(
    status,
    liveTotalMinutes,
    breakMode,
    autoBreakThresholdMinutes,
    autoBreakDurationMinutes,
    todayTarget?.targetMinutes,
  );
  const dailyPercentage =
    todayTargetMinutes > 0
      ? Math.min(100, Math.round((memberBreakdown.workMinutes / todayTargetMinutes) * 100))
      : 0;

  return {
    status,
    statusError,
    refetchStatus,
    weekData,
    weekTargets,
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

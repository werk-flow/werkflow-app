'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import { getWeeklyTargets } from '@/lib/personnel/target-actions';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import type {
  WeeklyTimeDataPoint,
  WeeklyTimeLabel,
} from '@/lib/time-tracking/types';
import type { DailyTarget } from '@/lib/personnel/targets';
import {
  buildWeeklyTimeData,
  computeWeekLabel,
  getTodayIndex,
  getWeekBounds,
} from '@/lib/time-tracking/weekly';
import {
  normalizeTimeTrackingSettings,
  type OrgBreakMode,
} from '@/lib/time-tracking/settings';

export type DayData = WeeklyTimeDataPoint;

interface UseWeeklyTimeDataOptions {
  organizationId: string;
  userId: string;
  breakMode: OrgBreakMode;
  autoBreakThresholdMinutes: number;
  autoBreakDurationMinutes: number;
  enabled?: boolean;
  initialWeekData?: WeeklyTimeDataPoint[];
  initialTodayIndex?: number;
  initialWeekLabel?: WeeklyTimeLabel;
  initialWeekTargets?: DailyTarget[];
}

export function useWeeklyTimeData({
  organizationId,
  userId,
  breakMode,
  autoBreakThresholdMinutes,
  autoBreakDurationMinutes,
  enabled = true,
  initialWeekData,
  initialTodayIndex,
  initialWeekLabel,
  initialWeekTargets,
}: UseWeeklyTimeDataOptions) {
  const hasInitialData = !!initialWeekData;
  const [weekData, setWeekData] = useState<WeeklyTimeDataPoint[]>(
    initialWeekData ?? []
  );
  const [weekTargets, setWeekTargets] = useState<DailyTarget[] | undefined>(
    initialWeekTargets
  );
  const [isLoading, setIsLoading] = useState(!hasInitialData);
  const [error, setError] = useState<string | null>(null);
  const [todayIndex, setTodayIndex] = useState(
    initialTodayIndex ?? getTodayIndex()
  );
  const [weekLabel, setWeekLabel] = useState(
    initialWeekLabel ?? computeWeekLabel(getWeekBounds().monday)
  );
  const hasUsedInitialData = useRef(hasInitialData);

  const fetchWeekData = useCallback(async () => {
    if (!organizationId || !userId) {
      setIsLoading(false);
      return;
    }

    // Recompute week bounds fresh on every fetch so we never use stale dates
    const { monday, sunday } = getWeekBounds();
    setTodayIndex(getTodayIndex());
    setWeekLabel(computeWeekLabel(monday));

    try {
      const [result, targetsResult] = await Promise.all([
        getTimeEntries({
          organizationId,
          from: monday.toISOString(),
          to: sunday.toISOString(),
          userId,
        }),
        getWeeklyTargets({ userId }),
      ]);

      if (!result.success) {
        setError(result.error);
        return;
      }

      const nextTargets = targetsResult.success
        ? targetsResult.targets
        : undefined;
      setWeekTargets(nextTargets);
      setWeekData(
        buildWeeklyTimeData(
          result.entries || [],
          monday,
          normalizeTimeTrackingSettings({
            organizationId,
            breakMode,
            autoBreakThresholdMinutes,
            autoBreakDurationMinutes,
          }),
          nextTargets
        )
      );
      setError(null);
    } catch (err) {
      console.error('Error fetching weekly time data:', err);
      setError('Failed to fetch weekly data');
    } finally {
      setIsLoading(false);
    }
  }, [
    autoBreakDurationMinutes,
    autoBreakThresholdMinutes,
    breakMode,
    organizationId,
    userId,
  ]);

  useEffect(() => {
    if (hasUsedInitialData.current) {
      hasUsedInitialData.current = false;
      return;
    }

    if (enabled) {
      fetchWeekData();
    }
  }, [enabled, fetchWeekData]);

  useRealtimeEvent('time_entries', fetchWeekData);
  // Targets change with schedules, conditions, the holiday region, and
  // closure days — refresh the week when any of them move.
  useRealtimeEvent('work_schedules', fetchWeekData);
  useRealtimeEvent('employment_conditions', fetchWeekData);
  useRealtimeEvent('organization_closure_days', fetchWeekData);
  useRealtimeEvent('organization_settings', fetchWeekData);

  return {
    weekData,
    weekTargets,
    todayIndex,
    weekLabel,
    isLoading,
    error,
    refetch: fetchWeekData,
  };
}

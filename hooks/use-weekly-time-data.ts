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
  // Several Realtime events can trigger overlapping fetches; only the latest
  // request may commit state, or a slow older response would win.
  const fetchGenerationRef = useRef(0);
  // Last successfully resolved targets: a transiently failed refetch must not
  // silently degrade the surface back to the fixed eight-hour fallback.
  const lastKnownTargetsRef = useRef<DailyTarget[] | undefined>(initialWeekTargets);

  const fetchWeekData = useCallback(async () => {
    if (!organizationId || !userId) {
      setIsLoading(false);
      return;
    }

    const generation = ++fetchGenerationRef.current;

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

      if (generation !== fetchGenerationRef.current) {
        return;
      }

      if (!result.success) {
        setError(result.error);
        return;
      }

      const nextTargets = targetsResult.success
        ? targetsResult.targets
        : lastKnownTargetsRef.current;
      lastKnownTargetsRef.current = nextTargets;
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
      if (generation !== fetchGenerationRef.current) {
        return;
      }
      console.error('Error fetching weekly time data:', err);
      setError('Failed to fetch weekly data');
    } finally {
      if (generation === fetchGenerationRef.current) {
        setIsLoading(false);
      }
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

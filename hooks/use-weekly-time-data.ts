'use client';

import { useRef } from 'react';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import { getWeeklyTargets } from '@/lib/personnel/target-actions';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
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

type WeekSnapshot = {
  weekData: WeeklyTimeDataPoint[];
  weekTargets: DailyTarget[] | undefined;
  todayIndex: number;
  weekLabel: WeeklyTimeLabel;
};

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
  // Last successfully resolved targets: a transiently failed targets refetch
  // must not silently degrade the surface back to the fixed eight-hour
  // fallback while the entries fetch succeeded.
  const lastKnownTargetsRef = useRef<DailyTarget[] | undefined>(
    initialWeekTargets
  );

  const view = useLiveView<WeekSnapshot>({
    tables: [
      'time_entries',
      // Targets change with schedules, conditions, the holiday region, and
      // closure days — refresh the week when any of them move.
      'work_schedules',
      'employment_conditions',
      'organization_closure_days',
      'organization_settings',
    ],
    read: async (): Promise<LiveViewResult<WeekSnapshot>> => {
      // Recompute week bounds fresh on every read so we never use stale dates
      const { monday, sunday } = getWeekBounds();

      if (!organizationId || !userId) {
        return {
          ok: true,
          data: {
            weekData: [],
            weekTargets: lastKnownTargetsRef.current,
            todayIndex: getTodayIndex(),
            weekLabel: computeWeekLabel(monday),
          },
        };
      }

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
        return { ok: false, error: result.error };
      }

      const nextTargets = targetsResult.success
        ? targetsResult.targets
        : lastKnownTargetsRef.current;
      lastKnownTargetsRef.current = nextTargets;

      return {
        ok: true,
        data: {
          weekData: buildWeeklyTimeData(
            result.entries || [],
            monday,
            normalizeTimeTrackingSettings({
              organizationId,
              breakMode,
              autoBreakThresholdMinutes,
              autoBreakDurationMinutes,
            }),
            nextTargets
          ),
          weekTargets: nextTargets,
          todayIndex: getTodayIndex(),
          weekLabel: computeWeekLabel(monday),
        },
      };
    },
    initialData: initialWeekData
      ? {
          weekData: initialWeekData,
          weekTargets: initialWeekTargets,
          todayIndex: initialTodayIndex ?? getTodayIndex(),
          weekLabel: initialWeekLabel ?? computeWeekLabel(getWeekBounds().monday),
        }
      : undefined,
    enabled,
    resetKey: `${organizationId}:${userId}:${breakMode}:${autoBreakThresholdMinutes}:${autoBreakDurationMinutes}`,
  });

  return {
    weekData: view.data?.weekData ?? [],
    weekTargets: view.data?.weekTargets,
    todayIndex: view.data?.todayIndex ?? getTodayIndex(),
    weekLabel: view.data?.weekLabel ?? computeWeekLabel(getWeekBounds().monday),
    isLoading: view.isLoading,
    error: view.error,
    refetch: view.refresh,
  };
}

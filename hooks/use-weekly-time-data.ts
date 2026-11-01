'use client';

import { useRef } from 'react';
import { readInBackground } from '@/lib/data/background-read-client';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import type { WeeklyTimeDataPoint, WeeklyTimeLabel } from '@/lib/time-tracking/types';
import type { DailyTarget } from '@/lib/personnel/targets';
import {
  buildWeeklyTimeData,
  computeWeekLabel,
  getTodayIndex,
  getWeekBounds,
} from '@/lib/time-tracking/weekly';
import { normalizeTimeTrackingSettings, type OrgBreakMode } from '@/lib/time-tracking/settings';

export type DayData = WeeklyTimeDataPoint;

type WeekSnapshot = {
  weekData: WeeklyTimeDataPoint[];
  weekTargets: DailyTarget[] | undefined;
  /** The targets read failed: `weekTargets` are the last known, possibly outdated. */
  targetsStale: boolean;
  todayIndex: number;
  weekLabel: WeeklyTimeLabel;
};

/** The week as the surface shows it: the day data under its targets, today's index and the week's label. */
function weekSnapshotOf(
  weekData: WeeklyTimeDataPoint[],
  weekTargets: DailyTarget[] | undefined,
  monday: Date,
  targetsStale = false,
): WeekSnapshot {
  return {
    weekData,
    weekTargets,
    targetsStale,
    todayIndex: getTodayIndex(),
    weekLabel: computeWeekLabel(monday),
  };
}

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
  initialWeekTargets?: DailyTarget[] | undefined;
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
  const lastKnownTargetsRef = useRef<DailyTarget[] | undefined>(initialWeekTargets);

  const view = useLiveView<WeekSnapshot>({
    tables: [
      'time_entries',
      'time_sessions',
      'time_segments',
      // Targets change with schedules, conditions, the holiday region, and
      // closure days — refresh the week when any of them move.
      'work_schedules',
      'employment_conditions',
      'organization_closure_days',
      'organization_settings',
    ],
    read: async ({ signal }): Promise<LiveViewResult<WeekSnapshot>> => {
      // Recompute week bounds fresh on every read so we never use stale dates
      const { monday, sunday } = getWeekBounds();

      if (!organizationId || !userId) {
        return { ok: true, data: weekSnapshotOf([], lastKnownTargetsRef.current, monday) };
      }

      const [result, targetsResult] = await Promise.all([
        readInBackground(
          'time-entries',
          {
            organizationId,
            from: monday.toISOString(),
            to: sunday.toISOString(),
            userId,
          },
          signal,
        ),
        readInBackground('weekly-targets', { userId }, signal),
      ]);

      if (!result.success) {
        return { ok: false, error: result.error };
      }

      const nextTargets = targetsResult.success ? targetsResult.targets : lastKnownTargetsRef.current;
      lastKnownTargetsRef.current = nextTargets;

      const settings = normalizeTimeTrackingSettings({
        organizationId,
        breakMode,
        autoBreakThresholdMinutes,
        autoBreakDurationMinutes,
      });
      const weekData = buildWeeklyTimeData(result.entries || [], monday, settings, nextTargets);
      return { ok: true, data: weekSnapshotOf(weekData, nextTargets, monday, !targetsResult.success) };
    },
    initialData: initialWeekData
      ? {
          weekData: initialWeekData,
          weekTargets: initialWeekTargets,
          targetsStale: false,
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
    targetsStale: view.data?.targetsStale ?? false,
    todayIndex: view.data?.todayIndex ?? getTodayIndex(),
    weekLabel: view.data?.weekLabel ?? computeWeekLabel(getWeekBounds().monday),
    isLoading: view.isLoading,
    /** A refresh failed: the week is last-known. */
    isStale: view.isStale,
    error: view.error,
    refetch: view.refresh,
  };
}

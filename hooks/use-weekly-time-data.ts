'use client';

import { useCallback, useRef } from 'react';
import { readInBackground } from '@/lib/data/background-read-client';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import type { WeeklyTimeDataPoint, WeeklyTimeLabel } from '@/lib/time-tracking/types';
import { DAILY_TARGET_LIVE_TABLES, type DailyTarget } from '@/lib/personnel/targets';
import {
  buildWeeklyTimeData,
  computeWeekLabel,
  getTodayIndex,
  getWeekBounds,
  targetsOfWeek,
} from '@/lib/time-tracking/weekly';
import { breakPolicyKey, type BreakPolicy } from '@/lib/time-tracking/settings';
import { isCorrectionEventFor } from '@/lib/time-tracking/clock-state-events';

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
  /** The rule with its earlier versions: each day of the week keeps the version that applied to it. */
  breakPolicy: BreakPolicy;
  enabled?: boolean;
  initialWeekData?: WeeklyTimeDataPoint[];
  initialTodayIndex?: number;
  initialWeekLabel?: WeeklyTimeLabel;
  initialWeekTargets?: DailyTarget[] | undefined;
}

/**
 * The rule with its versions, read again when it is saved (join catch-up
 * included): a day after the page's render resolves against the version that
 * applied to it, and the week reads again with it.
 */
function useLiveBreakPolicy(organizationId: string, breakPolicy: BreakPolicy, enabled: boolean) {
  const view = useLiveView<BreakPolicy>({
    tables: ['organization_settings'],
    read: async ({ signal }): Promise<LiveViewResult<BreakPolicy>> => {
      const result = await readInBackground('break-policy', { organizationId }, signal);
      return result.success ? { ok: true, data: result.breakPolicy } : { ok: false, error: result.error };
    },
    initialData: breakPolicy,
    enabled: enabled && Boolean(organizationId),
    resetKey: `${organizationId}:${breakPolicyKey(breakPolicy)}`,
  });
  return { livePolicy: view.data ?? breakPolicy, policyStale: view.isStale, refreshPolicy: view.refresh };
}

export function useWeeklyTimeData({
  organizationId,
  userId,
  breakPolicy,
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

  const { livePolicy, policyStale, refreshPolicy } = useLiveBreakPolicy(organizationId, breakPolicy, enabled);

  const view = useLiveView<WeekSnapshot>({
    tables: [
      'time_entries',
      'time_sessions',
      'time_segments',
      // An approved correction changes its days: its approval updates the request.
      // The filter below reads only for the shown person's requests.
      'time_correction_requests',
      // Every source of a daily target, approved vacation and sickness and the
      // entry and exit dates included. A saved break rule also reads the week
      // again through the policy view.
      ...DAILY_TARGET_LIVE_TABLES,
    ],
    eventFilter: (event) => isCorrectionEventFor(event, userId ? [userId] : []),
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

      const nextTargets = targetsResult.success
        ? targetsResult.targets
        : targetsOfWeek(lastKnownTargetsRef.current, monday);
      lastKnownTargetsRef.current = nextTargets;

      const weekData = buildWeeklyTimeData(result.entries || [], monday, livePolicy, nextTargets);
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
    resetKey: `${organizationId}:${userId}:${breakPolicyKey(livePolicy)}`,
  });

  const { refresh: refreshWeek } = view;
  // A retry reads the rule too: a failed rule read leaves the week stale as well.
  const refetch = useCallback(async () => {
    await Promise.all([refreshWeek(), refreshPolicy()]);
  }, [refreshWeek, refreshPolicy]);

  return {
    weekData: view.data?.weekData ?? [],
    weekTargets: view.data?.weekTargets,
    // A failed week read refreshed no target either.
    targetsStale: (view.data?.targetsStale ?? false) || view.isStale,
    todayIndex: view.data?.todayIndex ?? getTodayIndex(),
    weekLabel: view.data?.weekLabel ?? computeWeekLabel(getWeekBounds().monday),
    isLoading: view.isLoading,
    /** A refresh failed: the week is last-known. */
    isStale: view.isStale || policyStale,
    error: view.error,
    refetch,
  };
}

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useLiveView } from '@/hooks/use-live-view';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type { CalendarFetchRange } from '@/lib/calendar/navigation';
import type { CalendarJob } from '@/lib/jobs/types';
import type { OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import {
  useCalendarRangeData,
  type CalendarDataset,
  type CalendarInitialData,
} from './use-calendar-range-data';
import { useParkedJobs, useParkingContexts } from './use-parking-data';

// Every view draws every dataset (absences, schedules and dispatch states
// reach the day view and the board as well as the month), and one GET pair
// carries them all, so one uncovered dataset gates every view alike.
const ALL_CALENDAR_DATASETS: readonly CalendarDataset[] = [
  'entries',
  'jobs',
  'vacation',
  'sickness',
  'holidays',
  'board',
];

/**
 * The scoped calendar's reads: the range owner for the window, the Parkplatz
 * jobs riding its planning invalidation, the Parkplatz contexts on their own
 * live view, and the refresh and operation entry points built on them. An
 * operation start obsoletes a running Parkplatz read before it takes the
 * range owner's mutation ownership.
 */
export function useCalendarData({
  organizationId,
  identityKey,
  needed,
  initialData,
  holidayCalendar,
  isAdminOrManager,
  isScopeActive,
  reportReadFailure,
}: {
  organizationId: string;
  identityKey: string;
  needed: CalendarFetchRange;
  initialData: CalendarInitialData | undefined;
  holidayCalendar: OrganizationHolidayCalendar | undefined;
  isAdminOrManager: boolean;
  isScopeActive: () => boolean;
  reportReadFailure: () => void;
}) {
  const calendarJobsRef = useRef<CalendarJob[]>([]);
  const {
    parkedJobs,
    parkedJobsUnconfirmed,
    updateParkedJobs,
    fetchParkedJobs,
    readPlanningExtras,
    parkedJobsRequestIdRef,
    parkedJobsLoadedRef,
  } = useParkedJobs({ isScopeActive, isAdminOrManager, reportReadFailure });

  const range = useCalendarRangeData({
    organizationId,
    identityKey,
    needed,
    requiredDatasets: ALL_CALENDAR_DATASETS,
    initial: initialData ? { ...initialData, holidays: holidayCalendar } : undefined,
    onReadFailed: reportReadFailure,
    readPlanningExtras,
  });
  const { jobs: calendarJobs, beginMutation, refreshAll } = range;
  useEffect(() => {
    calendarJobsRef.current = calendarJobs;
  }, [calendarJobs]);

  useEffect(() => {
    if (isAdminOrManager && !parkedJobsLoadedRef.current) void fetchParkedJobs();
  }, [isAdminOrManager, fetchParkedJobs, parkedJobsLoadedRef]);

  const { parkingContexts, parkingContextsRef, fetchParkingContexts } = useParkingContexts({
    isScopeActive,
    isAdminOrManager,
    reportReadFailure,
    organizationId,
  });

  useRealtimeRouterRefresh({ tables: ['organization_members', 'profiles', 'organization_settings'] });
  useLiveView<null>({
    tables: ['work_blockers'],
    read: async () => ((await fetchParkingContexts()) ? { ok: true, data: null } : { ok: false }),
    initialData: null,
    enabled: isAdminOrManager,
    eventFilter: (event) => {
      const kind = (event.new ?? event.old)?.kind;
      return kind == null || kind === 'parking';
    },
  });

  const handleManualRefresh = useCallback(async () => {
    await Promise.all([refreshAll(), fetchParkingContexts()]);
  }, [refreshAll, fetchParkingContexts]);
  const handleSilentRefresh = useCallback(() => {
    void refreshAll();
  }, [refreshAll]);
  const handleOperationStart = useCallback(() => {
    parkedJobsRequestIdRef.current += 1;
    return beginMutation();
  }, [beginMutation, parkedJobsRequestIdRef]);

  return {
    range,
    calendarJobsRef,
    parkedJobs,
    parkedJobsUnconfirmed,
    updateParkedJobs,
    fetchParkedJobs,
    parkingContexts,
    parkingContextsRef,
    fetchParkingContexts,
    handleManualRefresh,
    handleSilentRefresh,
    handleOperationStart,
  };
}

export type CalendarData = ReturnType<typeof useCalendarData>;

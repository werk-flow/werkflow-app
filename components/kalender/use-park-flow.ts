'use client';

import { useCallback, useRef, useState } from 'react';
import type { CalendarBoardRow } from '@/lib/calendar/board';
import { calendarRefusalMessage, formatRefusalDate } from '@/lib/calendar/messages';
import type { CalendarJob } from '@/lib/jobs/types';
import type { JobParkingContext } from '@/lib/parking/types';
import type { useBanner } from '@/components/ui/banner';
import type { CalendarMutations } from './mutations/use-calendar-mutations';

export type ParkFlow = ReturnType<CalendarMutations['beginPark']>;

/**
 * Parking from the calendar. Park: the card leaves the grid now; the context
 * dialog owns the write and settles the flow. Unpark: Undo of a park and the
 * schedule dialog of a parked job re-read the context first, because the
 * write needs its current version.
 */
export function useParkFlow({
  mutations,
  showBanner,
  parkingContextsRef,
  fetchParkingContexts,
  fetchParkedJobs,
}: {
  mutations: CalendarMutations;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  parkingContextsRef: React.RefObject<Map<string, JobParkingContext> | null>;
  fetchParkingContexts: () => Promise<boolean>;
  fetchParkedJobs: () => Promise<boolean>;
}) {
  const [parkingContextJob, setParkingContextJob] = useState<CalendarJob | null>(null);
  const [scheduleParkedJob, setScheduleParkedJob] = useState<CalendarJob | null>(null);

  const handleParkedContextMissing = useCallback(() => {
    showBanner({ variant: 'error', message: calendarRefusalMessage('parkplatz_changed') ?? '' });
    void fetchParkingContexts();
    void fetchParkedJobs();
  }, [fetchParkedJobs, fetchParkingContexts, showBanner]);

  const parkFlowRef = useRef<ParkFlow | null>(null);
  /** True while a park started by a drag or a card command waits for the context dialog. */
  const hasPendingPark = useCallback(() => parkFlowRef.current !== null, []);
  const handlePark = useCallback(
    (job: CalendarJob) => {
      const authoritativeJobId = job.jobId ?? (job.occurrenceId ? null : job.id);
      if (!authoritativeJobId) {
        showBanner({ variant: 'error', message: calendarRefusalMessage('internal_not_parkable') ?? '' });
        return;
      }
      parkFlowRef.current = mutations.beginPark(job);
      setParkingContextJob({
        ...job,
        id: authoritativeJobId,
        occurrenceId: undefined,
        jobId: authoritativeJobId,
      });
    },
    [mutations, showBanner],
  );

  const undoPark = useCallback(
    async (job: CalendarJob) => {
      const jobId = job.jobId ?? job.id;
      if (!job.plannedDate) return;
      await fetchParkingContexts();
      const context = parkingContextsRef.current?.get(jobId);
      if (!context) {
        handleParkedContextMissing();
        return;
      }
      await mutations.unparkJob({
        job: { ...job, id: jobId, jobId, occurrenceId: undefined, status: 'geparkt' },
        parkingContext: context,
        plannedDate: job.plannedDate,
        plannedTime: job.plannedTime ?? undefined,
        successMessage: 'Auftrag wurde wieder eingeplant.',
      });
    },
    [fetchParkingContexts, handleParkedContextMissing, mutations, parkingContextsRef],
  );

  const handleScheduleParked = useCallback(
    (job: CalendarJob, input: { date: string; time: string | undefined; row: CalendarBoardRow | null }) => {
      const context = parkingContextsRef.current?.get(job.jobId ?? job.id);
      setScheduleParkedJob(null);
      if (!context) {
        handleParkedContextMissing();
        return;
      }
      const targetName = input.row?.displayName ?? null;
      const dateLabel = formatRefusalDate(input.date);
      void mutations.unparkJob({
        job,
        parkingContext: context,
        plannedDate: input.date,
        plannedTime: input.time,
        assignToUserId: input.row?.userId ?? undefined,
        successMessage: targetName
          ? `Auftrag wurde bei ${targetName} am ${dateLabel} eingeplant.`
          : `Auftrag wurde am ${dateLabel} eingeplant.`,
        context: { ...(targetName ? { name: targetName } : {}), date: dateLabel },
      });
    },
    [handleParkedContextMissing, mutations, parkingContextsRef],
  );

  return {
    parkFlowRef,
    hasPendingPark,
    parkingContextJob,
    setParkingContextJob,
    scheduleParkedJob,
    setScheduleParkedJob,
    handleParkedContextMissing,
    handlePark,
    undoPark,
    handleScheduleParked,
  };
}

export type ParkFlowState = ReturnType<typeof useParkFlow>;

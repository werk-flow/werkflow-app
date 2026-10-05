'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readInBackground } from '@/lib/data/background-read-client';
import type { CalendarJob } from '@/lib/jobs/types';
import type { JobParkingContext } from '@/lib/parking/types';

type ParkingReadOptions = {
  isScopeActive: () => boolean;
  isAdminOrManager: boolean;
  reportReadFailure: () => void;
};

/**
 * Parked jobs are not range-scoped; they ride the planning invalidation set
 * through `readPlanningExtras` and keep their own generation guard. The
 * request id ref lets an operation start obsolete a running read.
 */
export function useParkedJobs({ isScopeActive, isAdminOrManager, reportReadFailure }: ParkingReadOptions) {
  const [parkedJobs, setParkedJobs] = useState<CalendarJob[]>([]);
  const parkedJobsRequestIdRef = useRef(0);
  const parkedJobsLoadedRef = useRef(false);
  const fetchParkedJobs = useCallback(async (): Promise<boolean> => {
    if (!isScopeActive() || !isAdminOrManager) return false;
    const requestId = ++parkedJobsRequestIdRef.current;
    const result = await readInBackground('parked-jobs', {});
    if (!isScopeActive() || parkedJobsRequestIdRef.current !== requestId) return false;
    if (!result.success) {
      reportReadFailure();
      return false;
    }
    setParkedJobs(result.jobs);
    parkedJobsLoadedRef.current = true;
    return true;
  }, [reportReadFailure, isAdminOrManager, isScopeActive]);
  const readPlanningExtras = useCallback(
    async () => (isAdminOrManager ? fetchParkedJobs() : true),
    [isAdminOrManager, fetchParkedJobs],
  );
  return {
    parkedJobs,
    setParkedJobs,
    fetchParkedJobs,
    readPlanningExtras,
    parkedJobsRequestIdRef,
    parkedJobsLoadedRef,
  };
}

/**
 * P1-12: Parkplatz context (reason/responsible/next review) for managers.
 * The state is null until the first successful load so the panel can
 * distinguish "still loading" from "loaded, no context recorded"; the ref
 * gives event handlers the map of the latest completed read.
 */
export function useParkingContexts({
  isScopeActive,
  isAdminOrManager,
  reportReadFailure,
  organizationId,
}: ParkingReadOptions & { organizationId: string }) {
  const [parkingContexts, setParkingContexts] = useState<Map<string, JobParkingContext> | null>(null);
  const parkingContextsRef = useRef<Map<string, JobParkingContext> | null>(null);
  const parkingContextsRequestIdRef = useRef(0);
  const fetchParkingContexts = useCallback(async (): Promise<boolean> => {
    const requestId = ++parkingContextsRequestIdRef.current;
    if (!isScopeActive() || !isAdminOrManager) return false;
    const result = await readInBackground('job-parking-contexts', {});
    if (!isScopeActive() || parkingContextsRequestIdRef.current !== requestId) return false;
    if (!result.success) {
      reportReadFailure();
      return false;
    }
    const next = new Map(result.contexts.map((context) => [context.jobId, context]));
    parkingContextsRef.current = next;
    setParkingContexts(next);
    return true;
  }, [isAdminOrManager, reportReadFailure, isScopeActive]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the read sets state only after its awaited response, never synchronously
    void fetchParkingContexts();
  }, [fetchParkingContexts, organizationId]);
  return { parkingContexts, parkingContextsRef, fetchParkingContexts };
}

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  clockIn as clockInAction,
  clockOut as clockOutAction,
  getCurrentClockState,
  getJobInfoById,
  switchJob as switchJobAction,
} from '@/lib/time-tracking/actions';
import type { ClockResult, LiveClockState } from '@/lib/time-tracking/types';
import { useOrganization } from '@/components/organization/organization-context';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';

type ClockStateContextValue = {
  state: LiveClockState | null;
  isLoading: boolean;
  isPending: boolean;
  statusError: string | null;
  refresh: () => Promise<void>;
  clockIn: (jobId: string | null) => Promise<ClockResult>;
  clockOut: () => Promise<ClockResult>;
  switchJob: (jobId: string | null) => Promise<ClockResult>;
};

const ClockStateContext = createContext<ClockStateContextValue | null>(null);

function finalizeTodayMinutes(
  state: LiveClockState | null,
  endTimestamp = new Date().toISOString()
): number {
  if (!state?.isClockedIn || !state.clockInTime) {
    return state?.todayMinutes ?? 0;
  }

  const startMs = new Date(state.clockInTime).getTime();
  const endMs = new Date(endTimestamp).getTime();
  const elapsedMinutes = Math.max(0, (endMs - startMs) / 60000);

  return state.todayMinutes + elapsedMinutes;
}

export function ClockStateProvider({
  children,
  initialState = null,
}: {
  children: ReactNode;
  initialState?: LiveClockState | null;
}) {
  const { activeOrgId } = useOrganization();
  const [state, setState] = useState<LiveClockState | null>(initialState);
  const [isLoading, setIsLoading] = useState(!initialState);
  const [isPending, setIsPending] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const mutationVersionRef = useRef(0);
  const skipNextRealtimeRef = useRef(false);

  const hydrateJobInfo = useCallback(async (jobId: string | null) => {
    if (!jobId) return;

    try {
      const result = await getJobInfoById(jobId);
      if (!result.success || !result.job) return;

      setState((prev) => {
        if (!prev || prev.activeJobId !== jobId) {
          return prev;
        }

        return {
          ...prev,
          activeJobInfo: result.job,
          fetchedAt: new Date().toISOString(),
        };
      });
    } catch {
      // Keep optimistic title if the background metadata refresh fails.
    }
  }, []);

  const refresh = useCallback(
    async (options?: { background?: boolean }) => {
      if (!activeOrgId) {
        setState(null);
        setStatusError(null);
        setIsLoading(false);
        return;
      }

      const requestId = ++requestIdRef.current;
      const requestVersion = mutationVersionRef.current;

      if (!options?.background) {
        setIsLoading(true);
      }

      try {
        const result = await getCurrentClockState(activeOrgId);
        if (requestId !== requestIdRef.current) return;
        if (requestVersion !== mutationVersionRef.current) return;

        if (result.success) {
          setState(result.state);
          setStatusError(null);
        } else {
          setStatusError(result.error);
        }
      } catch (error) {
        console.error('Error refreshing clock state:', error);
        if (requestId !== requestIdRef.current) return;
        if (requestVersion !== mutationVersionRef.current) return;
        setStatusError('fetch_failed');
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [activeOrgId]
  );

  useEffect(() => {
    if (initialState?.organizationId === activeOrgId) {
      setState(initialState);
      setStatusError(null);
      setIsLoading(false);
      return;
    }

    void refresh();
  }, [activeOrgId, initialState, refresh]);

  useRealtimeEvent('time_entries', () => {
    if (skipNextRealtimeRef.current) {
      skipNextRealtimeRef.current = false;
      return;
    }

    void refresh({ background: true });
  });

  useRealtimeEvent('jobs', () => {
    if (!state?.activeJobId) return;
    void hydrateJobInfo(state.activeJobId);
  });

  const clockIn = useCallback(
    async (jobId: string | null): Promise<ClockResult> => {
      if (!activeOrgId) {
        return { success: false, error: 'no_active_org' };
      }

      setIsPending(true);
      try {
        const result = await clockInAction(activeOrgId, jobId);
        if (!result.success) {
          setStatusError(result.error);
          return result;
        }

        mutationVersionRef.current += 1;
        skipNextRealtimeRef.current = true;
        setStatusError(null);
        setState((prev) => ({
          organizationId: activeOrgId,
          isClockedIn: true,
          clockInTime: result.entry.timestamp,
          todayMinutes: prev?.todayMinutes ?? 0,
          activeJobId: jobId,
          activeJobInfo: result.jobInfo ?? null,
          fetchedAt: new Date().toISOString(),
        }));

        if (jobId) {
          void hydrateJobInfo(jobId);
        }

        return result;
      } catch (error) {
        console.error('Error clocking in:', error);
        setStatusError('unexpected_error');
        return { success: false, error: 'unexpected_error' };
      } finally {
        setIsPending(false);
      }
    },
    [activeOrgId, hydrateJobInfo]
  );

  const clockOut = useCallback(async (): Promise<ClockResult> => {
    if (!activeOrgId) {
      return { success: false, error: 'no_active_org' };
    }

    setIsPending(true);
    try {
      const result = await clockOutAction(activeOrgId);
      if (!result.success) {
        setStatusError(result.error);
        return result;
      }

      mutationVersionRef.current += 1;
      skipNextRealtimeRef.current = true;
      setStatusError(null);
      setState((prev) => ({
        organizationId: activeOrgId,
        isClockedIn: false,
        clockInTime: null,
        todayMinutes: finalizeTodayMinutes(prev, result.entry.timestamp),
        activeJobId: null,
        activeJobInfo: null,
        fetchedAt: new Date().toISOString(),
      }));

      return result;
    } catch (error) {
      console.error('Error clocking out:', error);
      setStatusError('unexpected_error');
      return { success: false, error: 'unexpected_error' };
    } finally {
      setIsPending(false);
    }
  }, [activeOrgId]);

  const switchJob = useCallback(
    async (jobId: string | null): Promise<ClockResult> => {
      if (!activeOrgId) {
        return { success: false, error: 'no_active_org' };
      }

      setIsPending(true);
      try {
        const result = await switchJobAction(activeOrgId, jobId);
        if (!result.success) {
          setStatusError(result.error);
          return result;
        }

        mutationVersionRef.current += 1;
        skipNextRealtimeRef.current = true;
        setStatusError(null);
        setState((prev) => ({
          organizationId: activeOrgId,
          isClockedIn: true,
          clockInTime: result.entry.timestamp,
          todayMinutes: finalizeTodayMinutes(prev, result.entry.timestamp),
          activeJobId: jobId,
          activeJobInfo: result.jobInfo ?? null,
          fetchedAt: new Date().toISOString(),
        }));

        if (jobId) {
          void hydrateJobInfo(jobId);
        }

        return result;
      } catch (error) {
        console.error('Error switching job:', error);
        setStatusError('unexpected_error');
        return { success: false, error: 'unexpected_error' };
      } finally {
        setIsPending(false);
      }
    },
    [activeOrgId, hydrateJobInfo]
  );

  const value = useMemo<ClockStateContextValue>(
    () => ({
      state,
      isLoading,
      isPending,
      statusError,
      refresh: () => refresh({ background: true }),
      clockIn,
      clockOut,
      switchJob,
    }),
    [clockIn, clockOut, isLoading, isPending, refresh, state, statusError, switchJob]
  );

  return (
    <ClockStateContext.Provider value={value}>
      {children}
    </ClockStateContext.Provider>
  );
}

export function useClockState() {
  const context = useContext(ClockStateContext);
  if (!context) {
    throw new Error('useClockState must be used within a ClockStateProvider');
  }

  return context;
}

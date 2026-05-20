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
  endBreak as endBreakAction,
  getCurrentClockState,
  getJobInfoById,
  startBreak as startBreakAction,
  switchJob as switchJobAction,
} from '@/lib/time-tracking/actions';
import type {
  ClockResult,
  ClockTimelineSegment,
  LiveClockState
} from '@/lib/time-tracking/types';
import { useOrganization } from '@/components/organization/organization-context';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { computeBreakdownForSettings } from '@/lib/time-tracking/settings';

type ClockStateContextValue = {
  state: LiveClockState | null;
  isLoading: boolean;
  isPending: boolean;
  statusError: string | null;
  refresh: () => Promise<void>;
  clockIn: (jobId: string | null) => Promise<ClockResult>;
  clockOut: () => Promise<ClockResult>;
  startBreak: () => Promise<ClockResult>;
  endBreak: (jobId: string | null) => Promise<ClockResult>;
  switchJob: (jobId: string | null) => Promise<ClockResult>;
};

const ClockStateContext = createContext<ClockStateContextValue | null>(null);

function getSegmentElapsedMinutes(
  state: LiveClockState | null,
  endTimestamp = new Date().toISOString()
): number {
  if (!state?.isClockedIn || !state.statusStartedAt) {
    return 0;
  }

  const startMs = new Date(state.statusStartedAt).getTime();
  const endMs = new Date(endTimestamp).getTime();
  return Math.max(0, (endMs - startMs) / 60000);
}

function finalizePresenceMinutes(
  state: LiveClockState | null,
  endTimestamp = new Date().toISOString()
): number {
  return (state?.todayMinutes ?? 0) + getSegmentElapsedMinutes(state, endTimestamp);
}

function finalizeWorkMinutes(
  state: LiveClockState | null,
  endTimestamp = new Date().toISOString()
): number {
  const breakdown = resolveOptimisticBreakdown(state, endTimestamp)
  return breakdown.workMinutes
}

function finalizeBreakMinutes(
  state: LiveClockState | null,
  endTimestamp = new Date().toISOString()
): number {
  const breakdown = resolveOptimisticBreakdown(state, endTimestamp)
  return breakdown.breakMinutes
}

function appendTimelineSegment(
  segments: ClockTimelineSegment[] | undefined,
  type: 'work' | 'break',
  minutes: number
): ClockTimelineSegment[] {
  if (minutes <= 0) {
    return segments ? [...segments] : [];
  }

  return [...(segments ?? []), { type, minutes }];
}

function resolveOptimisticBreakdown(
  state: LiveClockState | null,
  endTimestamp = new Date().toISOString()
) {
  const totalMinutes = finalizePresenceMinutes(state, endTimestamp)
  const trackedBreakMinutes =
    (state?.breakMode ?? 'manual') === 'manual'
      ? (() => {
          const base = state?.breakMinutes ?? 0
          if (state?.status !== 'on_break') return base
          return base + getSegmentElapsedMinutes(state, endTimestamp)
        })()
      : state?.breakMinutes ?? 0

  return computeBreakdownForSettings(totalMinutes, trackedBreakMinutes, {
    breakMode: state?.breakMode ?? 'manual',
    autoBreakThresholdMinutes: state?.autoBreakThresholdMinutes ?? 360,
    autoBreakDurationMinutes: state?.autoBreakDurationMinutes ?? 30,
  })
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
          breakMode: prev?.breakMode ?? 'manual',
          autoBreakThresholdMinutes: prev?.autoBreakThresholdMinutes ?? 360,
          autoBreakDurationMinutes: prev?.autoBreakDurationMinutes ?? 30,
          status: 'working',
          isClockedIn: true,
          clockInTime: result.entry.timestamp,
          isOnBreak: false,
          statusStartedAt: result.entry.timestamp,
          breakStartTime: null,
          todayMinutes: prev?.todayMinutes ?? 0,
          workMinutes: prev?.workMinutes ?? 0,
          breakMinutes: prev?.breakMinutes ?? 0,
          timelineSegments: prev?.timelineSegments ?? [],
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
        breakMode: prev?.breakMode ?? 'manual',
        autoBreakThresholdMinutes: prev?.autoBreakThresholdMinutes ?? 360,
        autoBreakDurationMinutes: prev?.autoBreakDurationMinutes ?? 30,
        status: 'clocked_out',
        isClockedIn: false,
        clockInTime: null,
        isOnBreak: false,
        statusStartedAt: null,
        breakStartTime: null,
        todayMinutes: finalizePresenceMinutes(prev, result.entry.timestamp),
        workMinutes: finalizeWorkMinutes(prev, result.entry.timestamp),
        breakMinutes: finalizeBreakMinutes(prev, result.entry.timestamp),
        timelineSegments: appendTimelineSegment(
          prev?.timelineSegments,
          prev?.status === 'on_break' ? 'break' : 'work',
          getSegmentElapsedMinutes(prev, result.entry.timestamp)
        ),
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

  const startBreak = useCallback(async (): Promise<ClockResult> => {
    if (!activeOrgId) {
      return { success: false, error: 'no_active_org' };
    }

    setIsPending(true);
    try {
      const result = await startBreakAction(activeOrgId);
      if (!result.success) {
        setStatusError(result.error);
        return result;
      }

      mutationVersionRef.current += 1;
      skipNextRealtimeRef.current = true;
      setStatusError(null);
      setState((prev) => ({
        organizationId: activeOrgId,
        breakMode: prev?.breakMode ?? 'manual',
        autoBreakThresholdMinutes: prev?.autoBreakThresholdMinutes ?? 360,
        autoBreakDurationMinutes: prev?.autoBreakDurationMinutes ?? 30,
        status: 'on_break',
        isClockedIn: true,
        isOnBreak: true,
        clockInTime: prev?.clockInTime ?? result.entry.timestamp,
        statusStartedAt: result.entry.timestamp,
        breakStartTime: result.entry.timestamp,
        todayMinutes: finalizePresenceMinutes(prev, result.entry.timestamp),
        workMinutes: finalizeWorkMinutes(prev, result.entry.timestamp),
        breakMinutes: prev?.breakMinutes ?? 0,
        timelineSegments: appendTimelineSegment(
          prev?.timelineSegments,
          'work',
          getSegmentElapsedMinutes(prev, result.entry.timestamp)
        ),
        activeJobId: null,
        activeJobInfo: null,
        fetchedAt: new Date().toISOString(),
      }));

      return result;
    } catch (error) {
      console.error('Error starting break:', error);
      setStatusError('unexpected_error');
      return { success: false, error: 'unexpected_error' };
    } finally {
      setIsPending(false);
    }
  }, [activeOrgId]);

  const endBreak = useCallback(
    async (jobId: string | null): Promise<ClockResult> => {
      if (!activeOrgId) {
        return { success: false, error: 'no_active_org' };
      }

      setIsPending(true);
      try {
        const result = await endBreakAction(activeOrgId, jobId);
        if (!result.success) {
          setStatusError(result.error);
          return result;
        }

        mutationVersionRef.current += 1;
        skipNextRealtimeRef.current = true;
        setStatusError(null);
        setState((prev) => ({
          organizationId: activeOrgId,
          breakMode: prev?.breakMode ?? 'manual',
          autoBreakThresholdMinutes: prev?.autoBreakThresholdMinutes ?? 360,
          autoBreakDurationMinutes: prev?.autoBreakDurationMinutes ?? 30,
          status: 'working',
          isClockedIn: true,
          isOnBreak: false,
          clockInTime: prev?.clockInTime ?? result.entry.timestamp,
          statusStartedAt: result.entry.timestamp,
          breakStartTime: null,
          todayMinutes: finalizePresenceMinutes(prev, result.entry.timestamp),
          workMinutes: prev?.workMinutes ?? 0,
          breakMinutes: finalizeBreakMinutes(prev, result.entry.timestamp),
          timelineSegments: appendTimelineSegment(
            prev?.timelineSegments,
            'break',
            getSegmentElapsedMinutes(prev, result.entry.timestamp)
          ),
          activeJobId: jobId,
          activeJobInfo: result.jobInfo ?? null,
          fetchedAt: new Date().toISOString(),
        }));

        if (jobId) {
          void hydrateJobInfo(jobId);
        }

        return result;
      } catch (error) {
        console.error('Error ending break:', error);
        setStatusError('unexpected_error');
        return { success: false, error: 'unexpected_error' };
      } finally {
        setIsPending(false);
      }
    },
    [activeOrgId, hydrateJobInfo]
  );

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
          breakMode: prev?.breakMode ?? 'manual',
          autoBreakThresholdMinutes: prev?.autoBreakThresholdMinutes ?? 360,
          autoBreakDurationMinutes: prev?.autoBreakDurationMinutes ?? 30,
          status: 'working',
          isClockedIn: true,
          clockInTime: prev?.clockInTime ?? result.entry.timestamp,
          isOnBreak: false,
          statusStartedAt: result.entry.timestamp,
          breakStartTime: null,
          todayMinutes: finalizePresenceMinutes(prev, result.entry.timestamp),
          workMinutes: finalizeWorkMinutes(prev, result.entry.timestamp),
          breakMinutes: prev?.breakMinutes ?? 0,
          timelineSegments: appendTimelineSegment(
            prev?.timelineSegments,
            'work',
            getSegmentElapsedMinutes(prev, result.entry.timestamp)
          ),
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
      startBreak,
      endBreak,
      switchJob,
    }),
    [
      clockIn,
      clockOut,
      endBreak,
      isLoading,
      isPending,
      refresh,
      startBreak,
      state,
      statusError,
      switchJob,
    ]
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

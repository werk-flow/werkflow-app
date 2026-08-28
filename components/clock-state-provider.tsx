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
import { useLiveView } from '@/hooks/use-live-view';
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
  state: LiveClockState | null | undefined,
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
  state: LiveClockState | null | undefined,
  endTimestamp = new Date().toISOString()
): number {
  return (state?.todayMinutes ?? 0) + getSegmentElapsedMinutes(state, endTimestamp);
}

function finalizeWorkMinutes(
  state: LiveClockState | null | undefined,
  endTimestamp = new Date().toISOString()
): number {
  const breakdown = resolveOptimisticBreakdown(state, endTimestamp)
  return breakdown.workMinutes
}

function finalizeBreakMinutes(
  state: LiveClockState | null | undefined,
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
  state: LiveClockState | null | undefined,
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
  const [isPending, setIsPending] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // One-shot suppression: a mutation just wrote the state locally, so the
  // Realtime echo of the own write does not need a second fetch.
  const skipNextRealtimeRef = useRef(false);
  const stateRef = useRef<LiveClockState | null>(null);

  const view = useLiveView<LiveClockState | null>({
    tables: ['time_entries', 'jobs'],
    read: async () => {
      if (!activeOrgId) {
        setStatusError(null);
        return { ok: true, data: null };
      }
      try {
        const result = await getCurrentClockState(activeOrgId);
        if (result.success) {
          setStatusError(null);
          return { ok: true, data: result.state };
        }
        setStatusError(result.error);
        return { ok: false, error: result.error };
      } catch (error) {
        console.error('Error refreshing clock state:', error);
        setStatusError('fetch_failed');
        return { ok: false, error: 'fetch_failed' };
      }
    },
    initialData:
      initialState && initialState.organizationId === activeOrgId
        ? initialState
        : undefined,
    resetKey: activeOrgId,
    eventFilter: (event) => {
      if (event.table === 'time_entries' && skipNextRealtimeRef.current) {
        skipNextRealtimeRef.current = false;
        return false;
      }
      if (event.table === 'jobs') {
        return Boolean(stateRef.current?.activeJobId);
      }
      return true;
    },
  });

  const state = view.data ?? null;
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const { setData: setState, invalidate: invalidateView, refresh: refreshView } = view;
  const isLoading = view.isLoading;

  const hydrateJobInfo = useCallback(
    async (jobId: string | null) => {
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
    },
    [setState]
  );

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

        invalidateView();
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
    [activeOrgId, hydrateJobInfo, invalidateView, setState]
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

      invalidateView();
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
  }, [activeOrgId, invalidateView, setState]);

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

      invalidateView();
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
  }, [activeOrgId, invalidateView, setState]);

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

        invalidateView();
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
    [activeOrgId, hydrateJobInfo, invalidateView, setState]
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

        invalidateView();
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
    [activeOrgId, hydrateJobInfo, invalidateView, setState]
  );

  const value = useMemo<ClockStateContextValue>(
    () => ({
      state,
      isLoading,
      isPending,
      statusError,
      refresh: refreshView,
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
      refreshView,
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

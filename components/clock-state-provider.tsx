'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { useLiveView } from '@/hooks/use-live-view';
import { useServerAction } from '@/hooks/use-server-action';
import { getCurrentClockState } from '@/lib/time-tracking/actions';
import {
  transitionTimeActivity,
  type TimeTransitionInput,
} from '@/lib/time-tracking/segment-actions';
import { createActivitySelection } from '@/lib/time-tracking/segments';
import type {
  LiveClockState,
  TimeActivitySelection,
  TimeTransitionResult,
} from '@/lib/time-tracking/types';

type ClockStateContextValue = {
  state: LiveClockState | null;
  isLoading: boolean;
  isPending: boolean;
  statusError: string | null;
  refresh: () => Promise<void>;
  transitionActivity: (selection: TimeActivitySelection) => Promise<TimeTransitionResult>;
  recoverAndContinue: (selection: TimeActivitySelection) => Promise<TimeTransitionResult>;
  clockIn: (jobId: string | null) => Promise<TimeTransitionResult>;
  clockOut: (acknowledgeRecovery?: boolean) => Promise<TimeTransitionResult>;
  startBreak: () => Promise<TimeTransitionResult>;
  endBreak: (jobId: string | null) => Promise<TimeTransitionResult>;
  switchJob: (jobId: string | null) => Promise<TimeTransitionResult>;
};

const ClockStateContext = createContext<ClockStateContextValue | null>(null);

export function ClockStateProvider({
  children,
  initialState = null,
}: {
  children: ReactNode;
  initialState?: LiveClockState | null;
}) {
  const { activeOrgId } = useOrganization();
  const view = useLiveView<LiveClockState | null>({
    tables: ['time_entries', 'time_sessions', 'time_segments', 'jobs'],
    read: async () => {
      if (!activeOrgId) return { ok: true, data: null };
      const result = await getCurrentClockState(activeOrgId);
      return result.success
        ? { ok: true, data: result.state }
        : { ok: false, error: result.error };
    },
    initialData:
      initialState && initialState.organizationId === activeOrgId
        ? initialState
        : undefined,
    resetKey: activeOrgId,
  });
  const { run, isPending } = useServerAction(transitionTimeActivity);
  const refresh = view.refresh;
  const currentState =
    view.data?.organizationId === activeOrgId ? view.data : null;
  const sessionId = currentState?.sessionId ?? null;
  const sessionVersion = currentState?.sessionVersion ?? null;
  const legacyOpen = currentState?.legacyOpen ?? false;
  const isClockedIn = currentState?.isClockedIn ?? false;
  const recoveryReason = currentState?.recoveryReason ?? null;

  const execute = useCallback(
    async (
      action: TimeTransitionInput['action'],
      selection: TimeActivitySelection | null,
      acknowledgeLong = false
    ): Promise<TimeTransitionResult> => {
      if (!activeOrgId) return { success: false, error: 'no_active_org' };
      let result: TimeTransitionResult;
      try {
        result = await run({
          organizationId: activeOrgId,
          operationId: crypto.randomUUID(),
          action,
          expectedSessionId: sessionId,
          expectedVersion: sessionVersion,
          selection,
          acknowledgeLong,
        });
      } catch {
        return { success: false, error: 'time_transition_failed' };
      }
      if (
        result.success ||
        (!result.success && result.error === 'time_transition_stale_version')
      ) {
        await refresh();
      }
      return result;
    },
    [activeOrgId, refresh, run, sessionId, sessionVersion]
  );

  const transitionActivity = useCallback(
    async (selection: TimeActivitySelection): Promise<TimeTransitionResult> => {
      const action = legacyOpen
        ? 'continue_legacy'
        : isClockedIn
          ? 'switch'
          : 'start';
      return execute(action, selection);
    },
    [execute, isClockedIn, legacyOpen]
  );
  const recoverAndContinue = useCallback(
    (selection: TimeActivitySelection) => execute('recover_continue', selection, true),
    [execute]
  );
  const clockIn = useCallback(
    (jobId: string | null) => transitionActivity(createActivitySelection('work', jobId)),
    [transitionActivity]
  );
  const clockOut = useCallback((acknowledgeRecovery = false) => {
    const action = legacyOpen
      ? 'end_legacy'
      : recoveryReason && acknowledgeRecovery
        ? 'recover_end'
        : 'end';
    return execute(action, null, acknowledgeRecovery && action === 'recover_end');
  }, [execute, legacyOpen, recoveryReason]);
  const startBreak = useCallback(
    () => transitionActivity(createActivitySelection('break')),
    [transitionActivity]
  );
  const endBreak = useCallback(
    (jobId: string | null) => transitionActivity(createActivitySelection('work', jobId)),
    [transitionActivity]
  );
  const switchJob = useCallback(
    (jobId: string | null) => transitionActivity(createActivitySelection('work', jobId)),
    [transitionActivity]
  );

  const value = useMemo<ClockStateContextValue>(
    () => ({
      state: currentState,
      isLoading: view.isLoading,
      isPending,
      statusError: view.error ?? null,
      refresh,
      transitionActivity,
      recoverAndContinue,
      clockIn,
      clockOut,
      startBreak,
      endBreak,
      switchJob,
    }),
    [
      clockIn,
      clockOut,
      currentState,
      endBreak,
      isPending,
      recoverAndContinue,
      startBreak,
      switchJob,
      transitionActivity,
      view.error,
      view.isLoading,
      refresh,
    ]
  );

  return <ClockStateContext.Provider value={value}>{children}</ClockStateContext.Provider>;
}

export function useClockState(): ClockStateContextValue {
  const context = useContext(ClockStateContext);
  if (!context) throw new Error('useClockState must be used within a ClockStateProvider');
  return context;
}

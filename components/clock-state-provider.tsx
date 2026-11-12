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

import { CLOCK_ACTION_FAILED, useClockOutbox, type ClockOutboxState } from '@/components/clock-outbox-state';
import { useOrganization } from '@/components/organization/organization-context';
import { useUserProfile } from '@/components/user/user-profile-context';
import { useLiveView, type LiveViewState } from '@/hooks/use-live-view';
import { useServerAction } from '@/hooks/use-server-action';
import type { ClockDeviceView } from '@/lib/field-sync/device/time-outbox';
import { applyTransitionEcho } from '@/lib/time-tracking/clock-echo';
import { fetchCurrentClockState } from '@/lib/time-tracking/state-client';
import { isClockStateEventRelevant } from '@/lib/time-tracking/clock-state-events';
import { transitionTimeActivity, type TimeTransitionInput } from '@/lib/time-tracking/segment-actions';
import { createActivitySelection } from '@/lib/time-tracking/segments';
import type { LiveClockState, TimeActivitySelection, TimeTransitionResult } from '@/lib/time-tracking/types';

type ClockStateContextValue = {
  /** The clock as it stands: the server's state, with the phone's unsent events applied while they wait. */
  state: LiveClockState | null;
  /** The clock events the phone's outbox holds for the person and has not sent, or null. */
  unsent: ClockDeviceView | null;
  /** The clock as the server last confirmed it, without unsent events: what a settled chain goes on from. */
  confirmed: LiveClockState | null;
  /** The device storage failed: the phone cannot keep clock actions without signal now. */
  deviceFailed: boolean;
  /** This page kept clock actions the outbox does not show yet: its code could not load without signal. */
  waitsForNetwork: boolean;
  isLoading: boolean;
  isReady: boolean;
  isPending: boolean;
  statusError: string | null;
  refresh: () => Promise<void>;
  transitionActivity: (selection: TimeActivitySelection) => Promise<TimeTransitionResult>;
  recoverAndContinue: (selection: TimeActivitySelection) => Promise<TimeTransitionResult>;
  clockIn: (jobId: string | null) => Promise<TimeTransitionResult>;
  clockOut: (acknowledgeRecovery?: boolean) => Promise<TimeTransitionResult>;
  switchJob: (jobId: string | null) => Promise<TimeTransitionResult>;
};

const ClockStateContext = createContext<ClockStateContextValue | null>(null);

type ClockLiveView = LiveViewState<LiveClockState | null>;

type ClockTransitionExecute = (
  action: TimeTransitionInput['action'],
  selection: TimeActivitySelection | null,
  acknowledgeLong?: boolean,
) => Promise<TimeTransitionResult>;

/** Echoes an accepted or kept action first, so no in-flight read overwrites it, then reads fresh. */
function useSettleTransition(
  invalidate: ClockLiveView['invalidate'],
  setData: ClockLiveView['setData'],
  refresh: ClockLiveView['refresh'],
  /** Takes the server's answer into the confirmed clock and notes when (useClockServerView). */
  confirm: ClockConfirmed['confirm'],
): (result: TimeTransitionResult, selection: TimeActivitySelection | null, at: Date) => Promise<void> {
  return useCallback(
    async (result, selection, at) => {
      if (result.success) {
        invalidate();
        // A kept action stands at its tap, also when the online call failed much later; it is no server answer.
        const echo = (previous: LiveClockState) =>
          applyTransitionEcho(previous, selection, result, result.kept ? at : undefined);
        setData((previous) => previous && echo(previous));
        if (!result.kept) confirm((previous) => previous && echo(previous));
      }
      // A kept action has no server state to read yet.
      if (result.success ? !result.kept : result.error === 'time_transition_stale_version') await refresh();
    },
    [confirm, invalidate, refresh, setData],
  );
}

/**
 * Sends one transition against the session the provider last read and echoes it. An action without
 * network, or behind unsent ones, is kept on the phone under the same operation id instead.
 */
/** The online clock call; null when it failed on its way, which it may have done after reaching the server. */
async function tryOnline(
  run: (input: TimeTransitionInput) => Promise<TimeTransitionResult>,
  input: TimeTransitionInput,
): Promise<TimeTransitionResult | null> {
  try {
    return await run(input);
  } catch {
    // best-effort: it may have reached the server; the phone keeps it under the same operation id.
    return null;
  }
}

/** What sending and keeping a clock action needs from the provider. */
type ClockExecuteInput = {
  /** The active organization and the signed-in person; an action is kept on the phone only for a known person. */
  holder: { activeOrgId: string | null; userId: string | null };
  isReady: boolean;
  run: (input: TimeTransitionInput) => Promise<TimeTransitionResult>;
  serverState: LiveClockState | null;
  outbox: ClockOutboxState;
  invalidate: ClockLiveView['invalidate'];
  refresh: ClockLiveView['refresh'];
  setData: ClockLiveView['setData'];
  /** When `serverState` was read or echoed (time-outbox.ts, TimeEventCapture). */
  readTimes: ClockConfirmed;
};

function useClockTransitionExecute({
  holder,
  isReady,
  run,
  serverState,
  outbox,
  invalidate,
  refresh,
  setData,
  readTimes,
}: ClockExecuteInput): ClockTransitionExecute {
  const { activeOrgId, userId } = holder;
  const { keep, holderNow } = outbox;
  const settle = useSettleTransition(invalidate, setData, refresh, readTimes.confirm);
  // Unsent actions go first: one captured after them must never reach the server before them.
  const knownUnsent = outbox.kept || outbox.view?.status === 'pending';
  const { unchecked } = outbox;
  return useCallback(
    async (
      action: TimeTransitionInput['action'],
      selection: TimeActivitySelection | null,
      acknowledgeLong = false,
    ): Promise<TimeTransitionResult> => {
      if (!activeOrgId) return { success: false, error: 'no_active_org' };
      // Never infer a new session from an unknown or failed initial read.
      if (!isReady) return CLOCK_ACTION_FAILED;
      // The time of the tap, also when the online call fails only much later.
      const capturedAt = new Date().toISOString();
      const expectedSessionId = serverState?.sessionId ?? null;
      const expectedVersion = serverState?.sessionVersion ?? null;
      const command = {
        operationId: crypto.randomUUID(),
        action,
        expectedSessionId,
        expectedVersion,
        selection,
      };
      const standsOnUnsent = knownUnsent || unchecked.current;
      // A phone that reports no network asks no server.
      const triedOnline = !standsOnUnsent && navigator.onLine;
      let result: TimeTransitionResult | null = null;
      const tapHolder = holderNow();
      if (triedOnline) {
        result = await tryOnline(run, { ...command, organizationId: activeOrgId, acknowledgeLong });
        // A switch finished meanwhile: the answer is the former organization's, never the clock shown now,
        // and its wipe ends what this page may keep.
        if (holderNow() !== tapHolder) return result ?? CLOCK_ACTION_FAILED;
      }
      if (!result) {
        if (!userId) return CLOCK_ACTION_FAILED;
        result = keep({
          ...command,
          userId,
          organizationId: activeOrgId,
          triedOnline,
          base: serverState,
          readAt: readTimes.last(),
          capturedAt,
        });
      }
      await settle(result, selection, new Date(capturedAt));
      return result;
    },
    [
      activeOrgId,
      userId,
      isReady,
      holderNow,
      keep,
      knownUnsent,
      readTimes,
      run,
      serverState,
      settle,
      unchecked,
    ],
  );
}

/** The clock's commands, each mapped onto the transition the running session allows. */
function useClockTransitionCommands(
  execute: ClockTransitionExecute,
  legacyOpen: boolean,
  isClockedIn: boolean,
  recoveryReason: LiveClockState['recoveryReason'],
): Pick<
  ClockStateContextValue,
  'transitionActivity' | 'recoverAndContinue' | 'clockIn' | 'clockOut' | 'switchJob'
> {
  const transitionActivity = useCallback(
    async (selection: TimeActivitySelection): Promise<TimeTransitionResult> => {
      const action = legacyOpen ? 'continue_legacy' : isClockedIn ? 'switch' : 'start';
      return execute(action, selection);
    },
    [execute, isClockedIn, legacyOpen],
  );
  const recoverAndContinue = useCallback(
    (selection: TimeActivitySelection) => execute('recover_continue', selection, true),
    [execute],
  );
  const clockIn = useCallback(
    (jobId: string | null) => transitionActivity(createActivitySelection('work', jobId)),
    [transitionActivity],
  );
  const clockOut = useCallback(
    (acknowledgeRecovery = false) => {
      const action = legacyOpen
        ? 'end_legacy'
        : recoveryReason && acknowledgeRecovery
          ? 'recover_end'
          : 'end';
      return execute(action, null, acknowledgeRecovery && action === 'recover_end');
    },
    [execute, legacyOpen, recoveryReason],
  );
  const switchJob = useCallback(
    (jobId: string | null) => transitionActivity(createActivitySelection('work', jobId)),
    [transitionActivity],
  );
  return useMemo(
    () => ({ transitionActivity, recoverAndContinue, clockIn, clockOut, switchJob }),
    [transitionActivity, recoverAndContinue, clockIn, clockOut, switchJob],
  );
}

/**
 * The clock as the server confirmed it, apart from a kept action's echo: `confirm` takes a server
 * answer in, `last` says when the server was last read or answered.
 */
type ClockConfirmed = {
  confirm: (update: (previous: LiveClockState | null) => LiveClockState | null) => void;
  last: () => string | null;
};

/** The clock state as the server answers it, live, and when it was last read. */
function useClockServerView(activeOrgId: string | null, initialState: LiveClockState | null) {
  // The running session's job, for the `jobs` event filter below; a ref so
  // the filter reads the latest value without re-registering.
  const activeJobIdRef = useRef<string | null>(null);
  const readAtRef = useRef<string | null>(null);
  const initialData = initialState && initialState.organizationId === activeOrgId ? initialState : null;
  const [confirmed, setConfirmed] = useState<LiveClockState | null>(initialData);
  const view = useLiveView<LiveClockState | null>({
    tables: ['time_entries', 'time_sessions', 'time_segments', 'jobs'],
    eventFilter: (event) => isClockStateEventRelevant(event, activeJobIdRef.current),
    read: async ({ signal }) => {
      if (!activeOrgId) return { ok: true, data: null };
      const startedAt = new Date().toISOString();
      const result = await fetchCurrentClockState(activeOrgId, signal);
      if (result.success) {
        readAtRef.current = startedAt;
        setConfirmed(result.state);
      }
      return result.success ? { ok: true, data: result.state } : { ok: false, error: result.error };
    },
    initialData: initialData ?? undefined,
    resetKey: activeOrgId,
  });
  const serverState = view.data?.organizationId === activeOrgId ? view.data : null;
  useEffect(() => {
    activeJobIdRef.current = serverState?.activeJobId ?? null;
  }, [serverState?.activeJobId]);
  const readTimes = useMemo<ClockConfirmed>(
    () => ({
      confirm: (update) => {
        readAtRef.current = new Date().toISOString();
        setConfirmed(update);
      },
      last: () => readAtRef.current,
    }),
    [],
  );
  const confirmedState = confirmed?.organizationId === activeOrgId ? confirmed : null;
  // The clock owns its failure contract (lib/conventions/live-view-stale.test.ts): a failed read shows statusError.
  const { isLoading, error, refresh, invalidate, setData } = view;
  return {
    serverState,
    confirmed: confirmedState,
    isLoading,
    error,
    refresh,
    invalidate,
    setData,
    readTimes,
  };
}

export function ClockStateProvider({
  children,
  initialState = null,
}: {
  children: ReactNode;
  initialState?: LiveClockState | null;
}) {
  const { activeOrgId } = useOrganization();
  const userId = useUserProfile().profile?.id ?? null;
  const outboxHolder = useMemo(
    () => (userId && activeOrgId ? { userId, organizationId: activeOrgId } : null),
    [userId, activeOrgId],
  );
  const view = useClockServerView(activeOrgId, initialState);
  const { serverState, confirmed, readTimes } = view;
  const { run, isPending } = useServerAction(transitionTimeActivity);
  const { refresh, invalidate, setData } = view;
  const outbox = useClockOutbox(outboxHolder, refresh);
  const unsent = outbox.view;
  // While the outbox shows unsent events, the clock stands where they left it; a stopped chain shows the server's state.
  // A stopped chain shows the clock the server confirmed, never a kept action's echo.
  const currentState = unsent?.state ?? (unsent ? confirmed : serverState);
  // Unsent actions carry the clock; without network a failed read leaves the last confirmed clock usable.
  const standsOnDevice = Boolean(unsent?.state) || outbox.kept || (Boolean(view.error) && !navigator.onLine);
  const isReady = currentState !== null && !view.isLoading && (!view.error || standsOnDevice);
  const statusError = standsOnDevice ? null : (view.error ?? null);
  const execute = useClockTransitionExecute({
    holder: { activeOrgId, userId },
    isReady,
    run,
    serverState: confirmed,
    outbox,
    invalidate,
    refresh,
    setData,
    readTimes,
  });
  const commands = useClockTransitionCommands(
    execute,
    currentState?.legacyOpen ?? false,
    currentState?.isClockedIn ?? false,
    currentState?.recoveryReason ?? null,
  );

  const value = useMemo<ClockStateContextValue>(
    () => ({
      state: currentState,
      unsent,
      confirmed,
      deviceFailed: outbox.deviceFailed,
      waitsForNetwork: outbox.kept,
      isLoading: view.isLoading,
      isReady,
      isPending,
      statusError,
      refresh,
      ...commands,
    }),
    [
      commands,
      currentState,
      confirmed,
      outbox.deviceFailed,
      isPending,
      statusError,
      unsent,
      outbox.kept,
      view.isLoading,
      isReady,
      refresh,
    ],
  );

  return <ClockStateContext.Provider value={value}>{children}</ClockStateContext.Provider>;
}

export function useClockState(): ClockStateContextValue {
  const context = useContext(ClockStateContext);
  if (!context) throw new Error('useClockState must be used within a ClockStateProvider');
  return context;
}

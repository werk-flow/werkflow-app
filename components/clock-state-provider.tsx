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

import { useOrganization } from '@/components/organization/organization-context';
import { useUserProfile } from '@/components/user/user-profile-context';
import { useLiveView, type LiveViewState } from '@/hooks/use-live-view';
import { useServerAction } from '@/hooks/use-server-action';
import type { ClockDeviceView } from '@/lib/field-sync/device/time-outbox';
import type { OutboxHolder } from '@/lib/field-sync/device/time-outbox-store';
import { deviceMayHoldUnsentWork, keepClockAction } from '@/lib/field-sync/device/unsent-mark';
import { applyTransitionEcho } from '@/lib/time-tracking/clock-echo';
import { fetchCurrentClockState } from '@/lib/time-tracking/state-client';
import { isClockStateEventRelevant } from '@/lib/time-tracking/clock-state-events';
import { transitionTimeActivity, type TimeTransitionInput } from '@/lib/time-tracking/segment-actions';
import { createActivitySelection } from '@/lib/time-tracking/segments';
import type { LiveClockState, TimeActivitySelection, TimeTransitionResult } from '@/lib/time-tracking/types';

const FAILED: TimeTransitionResult = { success: false, error: 'time_transition_failed' };
/** The clock's answer for an action kept on the phone: what the server would answer once it accepts it. */
const KEPT = {
  success: true,
  kept: true,
  sessionId: null,
  segmentId: null,
  version: null,
  recoveryReason: null,
  replayed: false,
  legacyBridged: false,
} as const;

type ClockStateContextValue = {
  /** The clock as it stands: the server's state, with the phone's unsent events applied while they wait. */
  state: LiveClockState | null;
  /** The clock events the phone's outbox holds for the person and has not sent, or null. */
  unsent: ClockDeviceView | null;
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

type ClockOutbox = typeof import('@/lib/field-sync/device/clock-outbox');
type ClockOutboxState = {
  /** What the phone's outbox holds unsent for the person, once its code ran. */
  view: ClockDeviceView | null;
  /** This page kept an action the outbox does not show yet: its code could not load without signal. */
  kept: boolean;
  keep: (action: Parameters<typeof keepClockAction>[0]) => boolean;
};

/**
 * The phone's time outbox for the signed-in person (decision record 0010). Its code loads only
 * when the device may hold unsent work at the app start, on `online`, and after a clock action
 * met no network, so no cold start pays for it.
 */
function useClockOutbox(holder: OutboxHolder | null, refresh: () => Promise<void>): ClockOutboxState {
  const [view, setView] = useState<ClockDeviceView | null>(null);
  const [kept, setKept] = useState(false);
  const takeInRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!holder) return;
    let stop: (() => void) | null = null;
    let ended = false;
    let wasPending = false;
    let watching: Promise<ClockOutbox> | null = null;
    const load = async (): Promise<ClockOutbox> => {
      try {
        const outbox = await import('@/lib/field-sync/device/clock-outbox');
        const stopWatching = await outbox.watchClockOutbox(holder, (next) => {
          setView(next);
          setKept(false);
          // The chain was sent or stopped: the server's state stands again, so read it.
          if (wasPending && next?.status !== 'pending') void refresh();
          wasPending = next?.status === 'pending';
        });
        if (ended) stopWatching();
        else stop = stopWatching;
        return outbox;
      } catch (error) {
        // The next call loads again: no signal yet, a chunk a deployment removed, or a device storage that failed once.
        watching = null;
        throw error;
      }
    };
    /** Hands what pages kept to the outbox; without its code the actions stay kept and marked until the next `online`. */
    const takeIn = (): void => {
      (watching ??= load())
        .then((outbox) => outbox.takeInKeptClockAction())
        // eslint-disable-next-line no-restricted-syntax -- no signal is the expected case here; the actions stay kept and marked, and `online` or the next start tries again
        .catch(() => undefined);
    };
    takeInRef.current = takeIn;
    if (deviceMayHoldUnsentWork()) takeIn();
    // Every return of the network asks the outbox: another tab may have sent what this page kept.
    window.addEventListener('online', takeIn);
    return () => {
      ended = true;
      takeInRef.current = null;
      window.removeEventListener('online', takeIn);
      stop?.();
      // The next person or organization never sees these events, also when its own outbox is never asked.
      setView(null);
      setKept(false);
    };
  }, [holder, refresh]);

  const keep = useCallback<ClockOutboxState['keep']>((action) => {
    if (!keepClockAction(action)) return false;
    setKept(true);
    takeInRef.current?.();
    return true;
  }, []);
  return { view, kept, keep };
}

/**
 * Sends one transition against the session the provider last read, echoes an
 * accepted one at once and reads fresh after it or after a stale version. An
 * action that meets no network, or that stands on unsent ones, is kept on the
 * phone instead, under the same operation id, and echoed the same way.
 */
function useClockTransitionExecute({
  holder,
  isReady,
  run,
  serverState,
  outbox,
  invalidate,
  refresh,
  setData,
}: {
  /** The active organization and the signed-in person; an action is kept on the phone only for a known person. */
  holder: { activeOrgId: string | null; userId: string | null };
  isReady: boolean;
  run: (input: TimeTransitionInput) => Promise<TimeTransitionResult>;
  serverState: LiveClockState | null;
  outbox: ClockOutboxState;
  invalidate: ClockLiveView['invalidate'];
  refresh: ClockLiveView['refresh'];
  setData: ClockLiveView['setData'];
}): ClockTransitionExecute {
  const { activeOrgId, userId } = holder;
  const { keep } = outbox;
  // Unsent actions go first: one captured after them must never reach the server before them.
  const standsOnUnsent = outbox.kept || outbox.view?.status === 'pending';
  // Events that wait for the person's decision carry nothing new: an action kept behind them would never be sent.
  const stopped = outbox.view?.status === 'stopped';
  return useCallback(
    async (
      action: TimeTransitionInput['action'],
      selection: TimeActivitySelection | null,
      acknowledgeLong = false,
    ): Promise<TimeTransitionResult> => {
      if (!activeOrgId) return { success: false, error: 'no_active_org' };
      // Never infer a new session from an unknown or failed initial read.
      if (!isReady) return FAILED;
      const command = {
        operationId: crypto.randomUUID(),
        action,
        expectedSessionId: serverState?.sessionId ?? null,
        expectedVersion: serverState?.sessionVersion ?? null,
        selection,
      };
      // A phone that reports no network asks no server.
      const triedOnline = !standsOnUnsent && navigator.onLine;
      let result: TimeTransitionResult | null = null;
      if (triedOnline) {
        try {
          result = await run({ ...command, organizationId: activeOrgId, acknowledgeLong });
        } catch {
          // best-effort: the call may have reached the server, so the phone keeps the action below under the same operation id and it is recorded once.
        }
      }
      if (!result) {
        // Only a start, a switch and an end can wait for signal. The first kept action stands on
        // the clock the server confirmed, kept without job, customer and project names.
        const base =
          standsOnUnsent || !serverState
            ? null
            : { ...serverState, activeJobInfo: null, resumeJobInfo: null };
        const waits = action === 'start' || action === 'switch' || action === 'end';
        if (stopped || !waits || !userId) return FAILED;
        if (!keep({ ...command, userId, organizationId: activeOrgId, triedOnline, base })) return FAILED;
        result = { ...KEPT, outcome: action === 'end' ? 'ended' : 'active' };
      }
      if (result.success) {
        // Echo first so no in-flight read overwrites it, then read fresh.
        const accepted = result;
        invalidate();
        setData((previous) => (previous ? applyTransitionEcho(previous, selection, accepted) : previous));
      }
      // A kept action has no server state to read yet.
      const reads = result.success ? !result.kept : result.error === 'time_transition_stale_version';
      if (reads) await refresh();
      return result;
    },
    [
      activeOrgId,
      userId,
      invalidate,
      isReady,
      keep,
      refresh,
      run,
      serverState,
      setData,
      standsOnUnsent,
      stopped,
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
  // The running session's job, for the `jobs` event filter below; a ref so
  // the filter reads the latest value without re-registering.
  const activeJobIdRef = useRef<string | null>(null);
  const view = useLiveView<LiveClockState | null>({
    tables: ['time_entries', 'time_sessions', 'time_segments', 'jobs'],
    eventFilter: (event) => isClockStateEventRelevant(event, activeJobIdRef.current),
    read: async ({ signal }) => {
      if (!activeOrgId) return { ok: true, data: null };
      const result = await fetchCurrentClockState(activeOrgId, signal);
      return result.success ? { ok: true, data: result.state } : { ok: false, error: result.error };
    },
    initialData: initialState && initialState.organizationId === activeOrgId ? initialState : undefined,
    resetKey: activeOrgId,
  });
  const { run, isPending } = useServerAction(transitionTimeActivity);
  const { refresh, invalidate, setData } = view;
  const serverState = view.data?.organizationId === activeOrgId ? view.data : null;
  const outbox = useClockOutbox(outboxHolder, refresh);
  const unsent = outbox.view;
  // While the outbox shows unsent events, the clock stands where they left it; a stopped chain shows the server's state.
  const currentState = unsent?.state ?? serverState;
  // Unsent actions carry the clock on their own. A read that failed on a phone without network leaves
  // the last confirmed clock usable: its next action is kept on the phone.
  const standsOnDevice = Boolean(unsent?.state) || outbox.kept || (Boolean(view.error) && !navigator.onLine);
  const isReady = currentState !== null && !view.isLoading && (!view.error || standsOnDevice);
  const statusError = standsOnDevice ? null : (view.error ?? null);
  useEffect(() => {
    activeJobIdRef.current = serverState?.activeJobId ?? null;
  }, [serverState?.activeJobId]);

  const execute = useClockTransitionExecute({
    holder: { activeOrgId, userId },
    isReady,
    run,
    serverState,
    outbox,
    invalidate,
    refresh,
    setData,
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
      waitsForNetwork: outbox.kept,
      isLoading: view.isLoading,
      isReady,
      isPending,
      statusError,
      refresh,
      ...commands,
    }),
    [commands, currentState, isPending, statusError, unsent, outbox.kept, view.isLoading, isReady, refresh],
  );

  return <ClockStateContext.Provider value={value}>{children}</ClockStateContext.Provider>;
}

export function useClockState(): ClockStateContextValue {
  const context = useContext(ClockStateContext);
  if (!context) throw new Error('useClockState must be used within a ClockStateProvider');
  return context;
}

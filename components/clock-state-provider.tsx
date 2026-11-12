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
  type RefObject,
} from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { useUserProfile } from '@/components/user/user-profile-context';
import { useLiveView, type LiveViewState } from '@/hooks/use-live-view';
import { useServerAction } from '@/hooks/use-server-action';
import type { ClockDeviceView } from '@/lib/field-sync/device/time-outbox';
import type { OutboxHolder } from '@/lib/field-sync/device/time-outbox-store';
import { deviceMayHoldUnsentWork, keepClockAction, wipeSignal } from '@/lib/field-sync/device/unsent-mark';
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

/**
 * The one lazy load of the clock's outbox and of the view of its unsent events. It rejects without
 * signal and in a tab left open across a deployment.
 */
export function loadClockOutbox(): Promise<typeof import('@/components/clock-unsent-events')> {
  return import('@/components/clock-unsent-events');
}

type ClockOutboxState = {
  /** What the phone's outbox holds unsent for the person, once its code ran. */
  view: ClockDeviceView | null;
  /** This page kept an action the outbox does not show yet: its code could not load without signal. */
  kept: boolean;
  /**
   * The device held unsent work when the page started, and the outbox has not shown it yet, as
   * without signal. Read when an action starts; it renders nothing.
   */
  unchecked: RefObject<boolean>;
  keep: (action: Parameters<typeof keepClockAction>[0]) => TimeTransitionResult;
};

/**
 * The phone's time outbox for the signed-in person (decision record 0010). Its code loads only
 * when the device may hold unsent work at the app start, on `online`, and after a clock action
 * met no network, so no cold start pays for it.
 */
function useClockOutbox(holder: OutboxHolder | null, refresh: () => Promise<void>): ClockOutboxState {
  const [view, setView] = useState<ClockDeviceView | null>(null);
  const [kept, setKept] = useState(false);
  const attachRef = useRef<(() => void) | null>(null);
  // The wipe signal this page's holder started under: after another tab's sign-out or switch the
  // page keeps nothing more, since its person may no longer be the one signed in.
  const signalRef = useRef<string | null>(null);
  const uncheckedRef = useRef(false);
  useEffect(() => {
    if (!holder) return;
    let detach: (() => void) | null = null;
    let ended = false;
    const onView = (next: ClockDeviceView | null): void => {
      uncheckedRef.current = false;
      setView(next);
      setKept(false);
    };
    /** Hands what pages kept to the outbox; without its code the actions stay kept and marked until the next `online`. */
    /** Hands what pages kept to the outbox; without its code the actions stay kept and marked until the next `online`. */
    const attach = async (): Promise<void> => {
      try {
        const outbox = await loadClockOutbox();
        detach = await outbox.attachClockOutbox(holder, onView, () => void refresh());
        if (ended) detach();
      } catch {
        // best-effort: no signal is the expected case here; the actions stay kept and marked, and `online` or the next start tries again.
      }
    };
    const attachNow = (): void => void attach();
    attachRef.current = attachNow;
    signalRef.current = wipeSignal();
    // Until the outbox shows what waits, a new action goes behind it, never past it to the server.
    uncheckedRef.current = deviceMayHoldUnsentWork();
    if (uncheckedRef.current) attachNow();
    // Every return of the network asks the outbox: another tab may have sent what this page kept.
    window.addEventListener('online', attachNow);
    return () => {
      ended = true;
      attachRef.current = null;
      window.removeEventListener('online', attachNow);
      detach?.();
      // The next person or organization never sees these events, also when its own outbox is never asked.
      setView(null);
      setKept(false);
    };
  }, [holder, refresh]);

  /**
   * Keeps a start, a switch or an end on the phone and answers as the accepted action would. Every
   * other action needs the server's answer first, and events that wait for the person's decision
   * carry nothing new: an action kept behind them would never be sent.
   */
  const stopped = view?.status === 'stopped';
  const keep = useCallback<ClockOutboxState['keep']>(
    (action) => {
      const signal = signalRef.current;
      const waits = action.action === 'start' || action.action === 'switch' || action.action === 'end';
      if (stopped || !waits || signal === null || !keepClockAction(action, signal)) return FAILED;
      setKept(true);
      attachRef.current?.();
      return { ...KEPT, outcome: action.action === 'end' ? 'ended' : 'active' };
    },
    [stopped],
  );
  return { view, kept, unchecked: uncheckedRef, keep };
}

/**
 * The clock a first kept action stands on: the one the server confirmed, kept without job, customer
 * and project names. Null for an action behind others, which stands on them.
 */
function keptBase(serverState: LiveClockState | null): LiveClockState | null {
  return serverState && { ...serverState, activeJobInfo: null, resumeJobInfo: null };
}

/** Echoes an accepted or kept action first, so no in-flight read overwrites it, then reads fresh. */
function useSettleTransition(
  invalidate: ClockLiveView['invalidate'],
  setData: ClockLiveView['setData'],
  refresh: ClockLiveView['refresh'],
): (result: TimeTransitionResult, selection: TimeActivitySelection | null) => Promise<void> {
  return useCallback(
    async (result, selection) => {
      if (result.success) {
        invalidate();
        setData((previous) => previous && applyTransitionEcho(previous, selection, result));
      }
      // A kept action has no server state to read yet.
      if (result.success ? !result.kept : result.error === 'time_transition_stale_version') await refresh();
    },
    [invalidate, refresh, setData],
  );
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
  const settle = useSettleTransition(invalidate, setData, refresh);
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
      if (!isReady) return FAILED;
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
      if (triedOnline) {
        try {
          result = await run({ ...command, organizationId: activeOrgId, acknowledgeLong });
        } catch {
          // best-effort: the call may have reached the server, so the phone keeps the action below under the same operation id and it is recorded once.
        }
      }
      if (!result) {
        if (!userId) return FAILED;
        const base = keptBase(standsOnUnsent ? null : serverState);
        result = keep({
          ...command,
          userId,
          organizationId: activeOrgId,
          triedOnline,
          base,
          capturedAt,
        });
      }
      await settle(result, selection);
      return result;
    },
    [activeOrgId, userId, isReady, keep, knownUnsent, run, serverState, settle, unchecked],
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

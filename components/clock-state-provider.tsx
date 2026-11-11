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
type KeptAction = Parameters<typeof keepClockAction>[0];

/**
 * The phone's time outbox for the signed-in person (decision record 0010). Its code loads only
 * when the device may hold unsent work: at the app start, on `online`, and after a clock action
 * met no network. `view` is what the outbox holds unsent. `kept` counts the actions this page
 * kept since then that no view shows yet, because the outbox code could not load without signal.
 */
function useClockOutbox(
  holder: OutboxHolder | null,
  refresh: () => Promise<void>,
): { view: ClockDeviceView | null; kept: number; keep: (action: KeptAction) => boolean } {
  // Kept with its holder: after an organization switch the former holder's events show nowhere.
  const [watched, setWatched] = useState<{ holder: OutboxHolder; view: ClockDeviceView | null } | null>(null);
  const [kept, setKept] = useState(0);
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
        const stopWatching = await outbox.watchClockOutbox(holder, (view) => {
          setWatched({ holder, view });
          setKept(0);
          // The chain was sent or stopped: the server's state stands again, so read it.
          if (wasPending && view?.status !== 'pending') void refresh();
          wasPending = view?.status === 'pending';
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
    /** Hands what pages kept to the outbox; without its code the actions stay kept, marked as waiting, until `online`. */
    const takeIn = (): void => {
      (watching ??= load())
        .then((outbox) => outbox.takeInKeptClockAction())
        // eslint-disable-next-line no-restricted-syntax -- no signal is the expected case here; the actions stay kept and marked, and `online` or the next start tries again
        .catch(() => undefined);
    };
    const whenOnline = (): void => {
      if (deviceMayHoldUnsentWork()) takeIn();
    };
    takeInRef.current = takeIn;
    whenOnline();
    window.addEventListener('online', whenOnline);
    return () => {
      ended = true;
      takeInRef.current = null;
      window.removeEventListener('online', whenOnline);
      stop?.();
    };
  }, [holder, refresh]);

  const keep = useCallback((action: KeptAction): boolean => {
    if (!keepClockAction(action)) return false;
    setKept((count) => count + 1);
    takeInRef.current?.();
    return true;
  }, []);
  return { view: watched?.holder === holder ? watched.view : null, kept, keep };
}

/**
 * Keeps a clock action on the phone and echoes it as the accepted action would show. Only a start,
 * a switch and an end can wait for signal: a recovery or legacy action needs the server's answer
 * first. The first kept action stands on `base`, the clock the server confirmed; one after it
 * passes null and stands on the action before it.
 */
function useKeepOnPhone({
  userId,
  keep,
  invalidate,
  setData,
}: {
  userId: string | null;
  keep: ReturnType<typeof useClockOutbox>['keep'];
  invalidate: ClockLiveView['invalidate'];
  setData: ClockLiveView['setData'];
}): (input: TimeTransitionInput, base: LiveClockState | null, triedOnline: boolean) => TimeTransitionResult {
  return useCallback(
    (input, base, triedOnline) => {
      const { organizationId, operationId, action, expectedSessionId, expectedVersion, selection } = input;
      const command = { operationId, action, expectedSessionId, expectedVersion, selection };
      const offline = action === 'start' || action === 'switch' || action === 'end';
      if (!offline || !userId || !keep({ ...command, userId, organizationId, triedOnline, base }))
        return FAILED;
      const result: TimeTransitionResult = {
        success: true,
        outcome: action === 'end' ? 'ended' : 'active',
        sessionId: null,
        segmentId: null,
        version: null,
        recoveryReason: null,
        replayed: false,
        legacyBridged: false,
      };
      invalidate();
      setData((previous) => (previous ? applyTransitionEcho(previous, selection, result) : previous));
      return result;
    },
    [invalidate, keep, setData, userId],
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
  outbox: ReturnType<typeof useClockOutbox>;
  invalidate: ClockLiveView['invalidate'];
  refresh: ClockLiveView['refresh'];
  setData: ClockLiveView['setData'];
}): ClockTransitionExecute {
  const { activeOrgId, userId } = holder;
  const keepOnPhone = useKeepOnPhone({ userId, keep: outbox.keep, invalidate, setData });
  // Unsent actions go first: one captured after them must never reach the server before them.
  const standsOnUnsent = outbox.kept > 0 || outbox.view?.status === 'pending';
  // The first kept action stands on the clock the server confirmed; the ones after it stand on it.
  const base = standsOnUnsent || outbox.view ? null : serverState;
  return useCallback(
    async (
      action: TimeTransitionInput['action'],
      selection: TimeActivitySelection | null,
      acknowledgeLong = false,
    ): Promise<TimeTransitionResult> => {
      if (!activeOrgId) return { success: false, error: 'no_active_org' };
      // Never infer a new session from an unknown or failed initial read.
      if (!isReady) return FAILED;
      const input: TimeTransitionInput = {
        organizationId: activeOrgId,
        operationId: crypto.randomUUID(),
        action,
        expectedSessionId: serverState?.sessionId ?? null,
        expectedVersion: serverState?.sessionVersion ?? null,
        selection,
        acknowledgeLong,
      };
      // A phone that reports no network asks no server.
      if (standsOnUnsent || !navigator.onLine) return keepOnPhone(input, base, false);
      let result: TimeTransitionResult;
      try {
        result = await run(input);
      } catch {
        // The call may have reached the server: the phone keeps the action under the same operation id, so it is recorded once.
        return keepOnPhone(input, base, true);
      }
      if (result.success) {
        // Echo first so no in-flight read overwrites it, then read fresh.
        invalidate();
        setData((previous) => (previous ? applyTransitionEcho(previous, selection, result) : previous));
      }
      if (result.success || (!result.success && result.error === 'time_transition_stale_version')) {
        await refresh();
      }
      return result;
    },
    [activeOrgId, base, invalidate, isReady, keepOnPhone, refresh, run, serverState, setData, standsOnUnsent],
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

/** The signed-in person and the active organization: whose unsent clock events this tab shows and sends. */
function useClockHolder(activeOrgId: string | null): { userId: string | null; outbox: OutboxHolder | null } {
  const userId = useUserProfile().profile?.id ?? null;
  const outbox = useMemo(
    () => (userId && activeOrgId ? { userId, organizationId: activeOrgId } : null),
    [userId, activeOrgId],
  );
  return { userId, outbox };
}

/**
 * Whether the clock can act, and the failed read it shows. Unsent actions carry the clock on their
 * own. A read that failed on a phone without network leaves the last confirmed clock usable, and
 * its next action is kept on the phone.
 */
function clockReadiness(
  view: Pick<ClockLiveView, 'isLoading' | 'error'>,
  clock: { known: boolean; standsOnUnsent: boolean },
): { isReady: boolean; statusError: string | null } {
  const standsOnDevice = clock.standsOnUnsent || (Boolean(view.error) && !navigator.onLine);
  return {
    isReady: clock.known && !view.isLoading && (!view.error || standsOnDevice),
    statusError: standsOnDevice ? null : (view.error ?? null),
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
  const { userId, outbox: outboxHolder } = useClockHolder(activeOrgId);
  const outbox = useClockOutbox(outboxHolder, refresh);
  const unsent = outbox.view;
  // While the outbox shows unsent events, the clock stands where they left it; a stopped chain shows the server's state.
  const currentState = unsent?.state ?? serverState;
  const { isReady, statusError } = clockReadiness(view, {
    known: currentState !== null,
    standsOnUnsent: Boolean(unsent?.state) || outbox.kept > 0,
  });
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
      waitsForNetwork: outbox.kept > 0,
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

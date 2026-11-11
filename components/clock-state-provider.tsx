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
import { logError } from '@/lib/logging';
import type { ClockDeviceView, OfflineClockCommand } from '@/lib/field-sync/device/time-outbox';
import type { OutboxHolder } from '@/lib/field-sync/device/time-outbox-store';
import { deviceMayHoldUnsentWork } from '@/lib/field-sync/device/unsent-mark';
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
  /** The clock events this phone holds for the person and has not sent, or null. */
  unsent: ClockDeviceView | null;
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

/**
 * The phone's time outbox for the signed-in person (decision record 0010). Its code loads only
 * when the device may hold unsent events, at the app start, or when a clock action meets no
 * network. `view` is what the phone holds unsent; `capture` keeps one more action on it.
 */
function useClockOutbox(
  holder: OutboxHolder | null,
  refresh: () => Promise<void>,
): {
  view: ClockDeviceView | null;
  capture: (
    command: OfflineClockCommand,
    base: LiveClockState | null,
    triedOnline: boolean,
  ) => Promise<TimeTransitionResult>;
} {
  // Kept with its holder: after an organization switch the former holder's events show nowhere.
  const [watched, setWatched] = useState<{ holder: OutboxHolder; view: ClockDeviceView | null } | null>(null);
  const watchRef = useRef<(() => Promise<ClockOutbox>) | null>(null);
  useEffect(() => {
    if (!holder) return;
    let stop: (() => void) | null = null;
    let ended = false;
    let wasPending = false;
    let watching: Promise<ClockOutbox> | null = null;
    const watch = (): Promise<ClockOutbox> =>
      (watching ??= import('@/lib/field-sync/device/clock-outbox')
        .then(async (outbox) => {
          const stopWatching = await outbox.watchClockOutbox(holder, (view) => {
            setWatched({ holder, view });
            // The chain was sent or stopped: the server's state stands again, so read it.
            if (wasPending && view?.status !== 'pending') void refresh();
            wasPending = view?.status === 'pending';
          });
          if (ended) stopWatching();
          else stop = stopWatching;
          return outbox;
        })
        .catch((error: unknown) => {
          // The next call loads again: a chunk a deployment removed, or a device storage that failed once.
          watching = null;
          throw error;
        }));
    watchRef.current = watch;
    if (deviceMayHoldUnsentWork())
      watch().catch((error: unknown) => {
        // The events stay on the phone; the next clock action without network and every sign-out read them.
        logError('ClockStateProvider: time outbox failed to load', error);
      });
    return () => {
      ended = true;
      watchRef.current = null;
      stop?.();
    };
  }, [holder, refresh]);

  const capture = useCallback(
    async (
      command: OfflineClockCommand,
      base: LiveClockState | null,
      triedOnline: boolean,
    ): Promise<TimeTransitionResult> => {
      if (!holder || !watchRef.current) return FAILED;
      try {
        const outbox = await watchRef.current();
        return await outbox.captureClockAction(holder, { command, base, triedOnline });
      } catch (error) {
        // The outbox code did not load, or the device refused to store: the action is not recorded, and the clock says so.
        logError('ClockStateProvider: clock action not kept on the device', error);
        return FAILED;
      }
    },
    [holder],
  );
  return { view: watched?.holder === holder ? watched.view : null, capture };
}

/**
 * Sends one transition against the session the provider last read, echoes an
 * accepted one at once and reads fresh after it or after a stale version. An
 * action that meets no network, or that stands on unsent events, is kept on
 * the phone instead, under the same operation id.
 */
function useClockTransitionExecute({
  activeOrgId,
  isReady,
  run,
  serverState,
  unsent,
  capture,
  invalidate,
  refresh,
  setData,
}: {
  activeOrgId: string | null;
  isReady: boolean;
  run: (input: TimeTransitionInput) => Promise<TimeTransitionResult>;
  serverState: LiveClockState | null;
  unsent: ClockDeviceView | null;
  capture: ReturnType<typeof useClockOutbox>['capture'];
  invalidate: ClockLiveView['invalidate'];
  refresh: ClockLiveView['refresh'];
  setData: ClockLiveView['setData'];
}): ClockTransitionExecute {
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
      // Unsent events go first, and a phone that reports no network asks no server.
      if (unsent?.state || !navigator.onLine) return capture(input, serverState, false);
      let result: TimeTransitionResult;
      try {
        result = await run(input);
      } catch {
        // The call may have reached the server: the phone keeps the action under the same operation id, so it is recorded once.
        return capture(input, serverState, true);
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
    [activeOrgId, capture, invalidate, isReady, refresh, run, serverState, setData, unsent],
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
  return { transitionActivity, recoverAndContinue, clockIn, clockOut, switchJob };
}

/** The server's clock of the active organization, kept live; `serverState` is null until it is read for that organization. */
function useServerClock(
  activeOrgId: string | null,
  initialState: LiveClockState | null,
): { view: ClockLiveView; serverState: LiveClockState | null } {
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
  const serverState = view.data?.organizationId === activeOrgId ? view.data : null;
  useEffect(() => {
    activeJobIdRef.current = serverState?.activeJobId ?? null;
  }, [serverState?.activeJobId]);
  return { view, serverState };
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
  const holder = useMemo(
    () => (userId && activeOrgId ? { userId, organizationId: activeOrgId } : null),
    [userId, activeOrgId],
  );
  const { view, serverState } = useServerClock(activeOrgId, initialState);
  const { run, isPending } = useServerAction(transitionTimeActivity);
  const { refresh, invalidate, setData } = view;
  const { view: unsent, capture } = useClockOutbox(holder, refresh);
  // While unsent events wait, the clock stands where they left it; a stopped chain shows the server's state.
  const currentState = unsent?.state ?? serverState;
  // A read that failed on a phone without network leaves the last confirmed clock usable: its next action is kept on the phone.
  const withoutNetwork = Boolean(view.error) && !navigator.onLine;
  const standsOnDevice = Boolean(unsent?.state) || withoutNetwork;
  const isReady = currentState !== null && !view.isLoading && (!view.error || standsOnDevice);
  const legacyOpen = currentState?.legacyOpen ?? false;
  const isClockedIn = currentState?.isClockedIn ?? false;
  const recoveryReason = currentState?.recoveryReason ?? null;

  const execute = useClockTransitionExecute({
    activeOrgId,
    isReady,
    run,
    serverState,
    unsent,
    capture,
    invalidate,
    refresh,
    setData,
  });
  const { transitionActivity, recoverAndContinue, clockIn, clockOut, switchJob } = useClockTransitionCommands(
    execute,
    legacyOpen,
    isClockedIn,
    recoveryReason,
  );

  const value = useMemo<ClockStateContextValue>(
    () => ({
      state: currentState,
      unsent,
      isLoading: view.isLoading,
      isReady,
      isPending,
      statusError: standsOnDevice ? null : (view.error ?? null),
      refresh,
      transitionActivity,
      recoverAndContinue,
      clockIn,
      clockOut,
      switchJob,
    }),
    [
      clockIn,
      clockOut,
      currentState,
      isPending,
      recoverAndContinue,
      standsOnDevice,
      switchJob,
      transitionActivity,
      unsent,
      view.error,
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

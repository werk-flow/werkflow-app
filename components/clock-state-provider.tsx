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
import type { ClockMarker, ShownClock } from '@/lib/field-sync/device/shown-clock-rule';
import { useOnline, useShownClock } from '@/lib/field-sync/device/shown-clock';
import { keptActionsWait } from '@/lib/field-sync/device/unsent-mark';
import { applyTransitionEcho } from '@/lib/time-tracking/clock-echo';
import { fetchCurrentClockState } from '@/lib/time-tracking/state-client';
import { isClockStateEventRelevant } from '@/lib/time-tracking/clock-state-events';
import { transitionTimeActivity, type TimeTransitionInput } from '@/lib/time-tracking/segment-actions';
import { createActivitySelection } from '@/lib/time-tracking/segments';
import type { LiveClockState, TimeActivitySelection, TimeTransitionResult } from '@/lib/time-tracking/types';

type ClockStateContextValue = {
  /** The clock as shown (shown-clock.ts): the server's state, with the phone's unsent actions applied while they wait. */
  state: LiveClockState | null;
  /** The clock events the phone's outbox holds for the person and has not sent, as shown, or null. */
  unsent: ClockDeviceView | null;
  /** The calm marker beside the clock while what it shows is not the server's answer. */
  marker: ClockMarker;
  /** The clock as the server last confirmed it, without unsent events: what a settled chain goes on from. */
  confirmed: LiveClockState | null;
  /** The device storage failed: the phone cannot keep clock actions without signal now. */
  deviceFailed: boolean;
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

/** The clock the server answered, and when the read behind it started (`performance.now()`). */
type ServerClock = { state: LiveClockState | null; from: number };

type ClockLiveView = LiveViewState<ServerClock | null>;

type ClockTransitionExecute = (
  action: TimeTransitionInput['action'],
  selection: TimeActivitySelection | null,
  acknowledgeLong?: boolean,
) => Promise<TimeTransitionResult>;

/**
 * Echoes an accepted or kept action first, then reads fresh. An online answer is the server's: it
 * replaces the clock, and no in-flight read overwrites it. A kept action is no server answer: its
 * echo stands apart, at its tap, also when the online call failed much later, until the outbox shows it.
 */
function useSettleTransition(
  view: Pick<ClockLiveView, 'invalidate' | 'setData' | 'refresh'>,
  /** Notes that the clock state now holds the server's answer (useClockServerView). */
  stamp: () => void,
  keepEcho: (echo: (from: LiveClockState) => LiveClockState) => void,
): (result: TimeTransitionResult, selection: TimeActivitySelection | null, at: Date) => Promise<void> {
  const { invalidate, setData, refresh } = view;
  return useCallback(
    async (result, selection, at) => {
      if (result.success && result.kept) {
        keepEcho((from) => applyTransitionEcho(from, selection, result, at));
        // A kept action has no server state to read yet.
        return;
      }
      if (result.success) {
        invalidate();
        setData(
          (previous) =>
            previous && {
              state: previous.state && applyTransitionEcho(previous.state, selection, result),
              from: performance.now(),
            },
        );
        stamp();
      }
      if (result.success || result.error === 'time_transition_stale_version') await refresh();
    },
    [invalidate, keepEcho, refresh, setData, stamp],
  );
}

/**
 * Sends one transition against the session the provider last read and echoes it. An action without
 * network, or behind unsent ones, is kept on the phone under the same operation id instead.
 */
/** The online clock call; null when it failed on its way, which it may have done after reaching the server. */
async function tryOnline(call: () => Promise<TimeTransitionResult>): Promise<TimeTransitionResult | null> {
  try {
    return await call();
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
  view: Pick<ClockLiveView, 'invalidate' | 'setData' | 'refresh'>;
  /** When `serverState` was read or echoed (time-outbox.ts, TimeEventCapture). */
  readTimes: ClockConfirmed;
  keepEcho: (echo: (from: LiveClockState) => LiveClockState) => void;
};

function useClockTransitionExecute({
  holder,
  isReady,
  run,
  serverState,
  outbox,
  view,
  readTimes,
  keepEcho,
}: ClockExecuteInput): ClockTransitionExecute {
  const { activeOrgId, userId } = holder;
  const { keep, holderNow, callKept } = outbox;
  const settle = useSettleTransition(view, readTimes.stamp, keepEcho);
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
      // Kept actions the outbox has not taken in come first, also another tab's or one this version cannot read.
      const standsOnUnsent = knownUnsent || unchecked.current || keptActionsWait();
      // A phone that reports no network asks no server.
      const triedOnline = !standsOnUnsent && navigator.onLine;
      let result: TimeTransitionResult | null = null;
      const tapHolder = holderNow();
      // What the phone keeps of the action, also while its online call runs (unsent-mark.ts, callWhileKept).
      const toKeep = userId && {
        ...command,
        userId,
        organizationId: activeOrgId,
        triedOnline,
        base: serverState,
        readAt: readTimes.last(),
        capturedAt,
      };
      if (triedOnline) {
        const online = () => run({ ...command, organizationId: activeOrgId, acknowledgeLong });
        result = await tryOnline(toKeep ? () => callKept(toKeep, online) : online);
        // A switch finished meanwhile: the answer is the former organization's, never the clock shown now,
        // and its wipe ends what this page may keep.
        if (holderNow() !== tapHolder) return result ?? CLOCK_ACTION_FAILED;
      }
      if (!result) {
        if (!toKeep) return CLOCK_ACTION_FAILED;
        result = keep(toKeep);
      }
      await settle(result, selection, new Date(capturedAt));
      return result;
    },
    [
      activeOrgId,
      userId,
      isReady,
      holderNow,
      callKept,
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
 * When the server last answered: `stamp` notes an online answer, `last` reads the time, `lastStart`
 * when the newest read started (`performance.now()`).
 */
type ClockConfirmed = {
  stamp: () => void;
  last: () => string | null;
  lastStart: () => number;
};

/** The clock state as the server answers it, live, and when it was last read. */
function useClockServerView(activeOrgId: string | null) {
  // The running session's job, for the `jobs` event filter below; a ref so
  // the filter reads the latest value without re-registering.
  const activeJobIdRef = useRef<string | null>(null);
  const readAtRef = useRef<string | null>(null);
  const readStartRef = useRef(-1);
  // When the newest failed read started: with network it ends the shown clock's wait (shown-clock.ts).
  const [failedFrom, setFailedFrom] = useState(-1);
  const view = useLiveView<ServerClock | null>({
    tables: ['time_entries', 'time_sessions', 'time_segments', 'jobs'],
    eventFilter: (event) => isClockStateEventRelevant(event, activeJobIdRef.current),
    read: async ({ signal }) => {
      if (!activeOrgId) return { ok: true, data: null };
      const startedAt = new Date().toISOString();
      const from = performance.now();
      readStartRef.current = from;
      const result = await fetchCurrentClockState(activeOrgId, signal);
      if (result.success) {
        readAtRef.current = startedAt;
        return { ok: true, data: { state: result.state, from } };
      }
      // A read that fails without network is no answer: the shown clock keeps waiting (shown-clock-rule.ts).
      if (!signal.aborted && navigator.onLine) setFailedFrom(from);
      return { ok: false, error: result.error };
    },
    resetKey: activeOrgId,
  });
  const serverState = view.data?.state?.organizationId === activeOrgId ? view.data.state : null;
  useEffect(() => {
    activeJobIdRef.current = serverState?.activeJobId ?? null;
  }, [serverState?.activeJobId]);
  const readTimes = useMemo<ClockConfirmed>(
    () => ({
      stamp: () => {
        readAtRef.current = new Date().toISOString();
      },
      last: () => readAtRef.current,
      lastStart: () => readStartRef.current,
    }),
    [],
  );
  // The clock owns its failure contract (lib/conventions/live-view-stale.test.ts): a failed read shows statusError.
  const { isLoading, error, refresh, invalidate, setData } = view;
  return {
    serverState,
    serverFrom: view.data?.from ?? -1,
    failedFrom,
    isLoading,
    error,
    refresh,
    invalidate,
    setData,
    readTimes,
  };
}

/** The echo of actions this page kept while the outbox does not show them yet; it ends when the outbox answers. */
function useKeptEcho(kept: boolean, phoneState: LiveClockState | null) {
  const [keptEcho, setKeptEcho] = useState<LiveClockState | null>(null);
  // A tap goes on from this page's earlier kept echo only while the outbox still does not show it.
  const keepEcho = useCallback(
    (echo: (from: LiveClockState) => LiveClockState) =>
      setKeptEcho((previous) => {
        const from = (kept && previous) || phoneState;
        return from && echo(from);
      }),
    [kept, phoneState],
  );
  return { keptEcho: kept ? keptEcho : null, keepEcho };
}

/** What the clock shows (shown-clock.ts), from the provider's server view, outbox and kept echo. */
function useProviderShownClock(
  view: ReturnType<typeof useClockServerView>,
  outbox: ClockOutboxState,
  keptEcho: LiveClockState | null,
  holder: { userId: string; organizationId: string } | null,
): { shown: ShownClock; online: boolean } {
  const online = useOnline();
  const { readTimes, refresh } = view;
  const readAgain = useMemo(() => ({ lastStart: readTimes.lastStart, refresh }), [readTimes, refresh]);
  const shown = useShownClock(
    {
      server: view.serverState,
      serverFrom: view.serverFrom,
      failedFrom: view.failedFrom,
      device: outbox.view,
      deviceFrom: outbox.answeredAt,
      keptEcho,
      checkingDevice: outbox.checking,
      online,
      scope: holder && `${holder.userId}:${holder.organizationId}`,
    },
    readAgain,
  );
  return { shown, online };
}

/**
 * Whether a clock action may start, and the read failure the dock shows. Unsent actions carry the
 * clock (`standsOnDevice`); without network a failed read leaves the last confirmed clock usable.
 */
function clockReadiness(input: {
  phoneState: LiveClockState | null;
  shown: ShownClock;
  error: string | null;
  isLoading: boolean;
  standsOnDevice: boolean;
}): { isReady: boolean; statusError: string | null } {
  const { phoneState, shown, error, isLoading, standsOnDevice } = input;
  return {
    // While unsent actions settle, no action starts from a clock the server has not answered yet.
    isReady: phoneState !== null && !isLoading && !shown.settling && (!error || standsOnDevice),
    // While they settle, only the read that should settle them shows its failure, also without
    // network: the server's older clock is never shown in its place.
    statusError: shown.readFailed
      ? (error ?? 'time_state_unavailable')
      : standsOnDevice || shown.settling
        ? null
        : error,
  };
}

export function ClockStateProvider({ children }: { children: ReactNode }) {
  const { activeOrgId } = useOrganization();
  const userId = useUserProfile().profile?.id ?? null;
  const outboxHolder = useMemo(
    () => (userId && activeOrgId ? { userId, organizationId: activeOrgId } : null),
    [userId, activeOrgId],
  );
  const view = useClockServerView(activeOrgId);
  const { serverState, readTimes } = view;
  const { run, isPending } = useServerAction(transitionTimeActivity);
  const { refresh, invalidate, setData } = view;
  const outbox = useClockOutbox(outboxHolder, refresh);
  const unsent = outbox.view;
  // What the phone holds: while unsent events wait, the clock stands where they left it; a stopped
  // chain shows the clock the server confirmed.
  const deviceState = unsent?.state ?? serverState;
  const { keptEcho, keepEcho } = useKeptEcho(outbox.kept, deviceState);
  const phoneState = keptEcho ?? deviceState;
  const { shown, online } = useProviderShownClock(view, outbox, keptEcho, outboxHolder);
  const { isReady, statusError } = clockReadiness({
    phoneState,
    shown,
    error: view.error,
    isLoading: view.isLoading,
    standsOnDevice: Boolean(unsent?.state) || outbox.kept || (Boolean(view.error) && !online),
  });
  const execute = useClockTransitionExecute({
    holder: { activeOrgId, userId },
    isReady,
    run,
    serverState,
    outbox,
    view: { invalidate, setData, refresh },
    readTimes,
    keepEcho,
  });
  const commands = useClockTransitionCommands(
    execute,
    phoneState?.legacyOpen ?? false,
    phoneState?.isClockedIn ?? false,
    phoneState?.recoveryReason ?? null,
  );

  const value = useMemo<ClockStateContextValue>(
    () => ({
      state: shown.state,
      unsent: shown.device,
      marker: shown.marker,
      confirmed: serverState,
      deviceFailed: outbox.deviceFailed,
      isLoading: view.isLoading,
      isReady,
      isPending,
      statusError,
      refresh,
      ...commands,
    }),
    [
      commands,
      shown,
      serverState,
      outbox.deviceFailed,
      isPending,
      statusError,
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

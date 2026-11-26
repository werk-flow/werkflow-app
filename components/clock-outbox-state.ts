'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ClockDeviceView } from '@/lib/field-sync/device/time-outbox';
import type { OutboxHolder } from '@/lib/field-sync/device/time-outbox-store';
import { sharedWipeGeneration } from '@/lib/field-sync/device/today-wipe';
import {
  UNSENT_MARK_PREFIX,
  callWhileKept,
  deviceMayHoldUnsentWork,
  keepClockAction,
} from '@/lib/field-sync/device/unsent-mark';
import type { TimeTransitionResult } from '@/lib/time-tracking/types';

// The clock's side of the phone's time outbox (decision record 0010): the state the clock provider
// reads, and the one lazy load of the outbox's code. Every page carries this module, so it holds
// only the few lines a page needs before that code can load.

/** The answer of a clock action that neither reached the server nor was kept on the phone. */
export const CLOCK_ACTION_FAILED: TimeTransitionResult = { success: false, error: 'time_transition_failed' };

type ClockOutboxModule = typeof import('@/components/clock-unsent-events');

let loadedOutbox: ClockOutboxModule | null = null;

/** The one lazy load of the clock's outbox and its view; it rejects without signal. */
async function loadClockOutbox(): Promise<ClockOutboxModule> {
  loadedOutbox = await import('@/components/clock-unsent-events');
  return loadedOutbox;
}

/** The outbox's module once it loaded: every unsent view came through it, so the view renders without waiting. */
export function loadedClockOutbox(): ClockOutboxModule | null {
  return loadedOutbox;
}

export type ClockOutboxState = {
  /** What the phone's outbox holds unsent for the person, once its code ran. */
  view: ClockDeviceView | null;
  /** When the outbox last answered (`performance.now()`), so a clock read can be told apart as older or newer. */
  answeredAt: number;
  /** The device may hold unsent work, and the outbox has not answered yet. */
  checking: boolean;
  /**
   * The first look failed: the outbox's code did not load, or the device store did not answer within
   * `FIRST_LOOK_WAIT_MS`. The clock is unknown until `retry` gets the outbox's answer.
   */
  loadFailed: boolean;
  /** Loads the outbox's code again and hands it what this page kept. */
  retry: () => void;
  /** This page kept an action the outbox does not show yet: its code could not load without signal. */
  kept: boolean;
  /** Unsent work the page started with that the outbox has not shown yet; read when an action starts. */
  unchecked: RefObject<boolean>;
  /** The device storage failed (a full disk): nothing waits behind it, and actions go online. */
  deviceFailed: boolean;
  /** The person and organization the page works for now; another one after a switch. */
  holderNow: () => OutboxHolder | null;
  keep: (action: Parameters<typeof keepClockAction>[0]) => TimeTransitionResult;
  /** Runs the online call with its action written down first (unsent-mark.ts, callWhileKept). */
  callKept: (
    action: Parameters<typeof keepClockAction>[0],
    call: () => Promise<TimeTransitionResult>,
  ) => Promise<TimeTransitionResult>;
};

/** The phone's time outbox (decision record 0010); its code loads only when unsent work may wait. */
/**
 * The page's two ways to keep an action: `keep` after a failed or skipped online call, `callKept` around
 * the online call. Neither keeps behind events that wait for the person: such an action would never be sent.
 * `retry` hands kept actions to the outbox again, loading its code anew.
 */
function useKeepers(
  stopped: boolean,
  signalRef: RefObject<string | null>,
  attachRef: RefObject<(() => void) | null>,
  setKept: (kept: boolean) => void,
): Pick<ClockOutboxState, 'keep' | 'callKept' | 'retry'> {
  const keep = useCallback<ClockOutboxState['keep']>(
    (action) => {
      const signal = signalRef.current;
      const kept = stopped || signal === null ? null : keepClockAction(action, signal);
      if (!kept) return CLOCK_ACTION_FAILED;
      setKept(true);
      attachRef.current?.();
      return kept;
    },
    [attachRef, setKept, signalRef, stopped],
  );
  const callKept = useCallback<ClockOutboxState['callKept']>(
    async (action, call) => {
      const result = await callWhileKept(action, signalRef.current, call);
      // The call failed on its way: its entry is the kept action now, and the outbox takes it in.
      if (result.success && result.kept) {
        setKept(true);
        attachRef.current?.();
      }
      return result;
    },
    [attachRef, setKept, signalRef],
  );
  const retry = useCallback(() => attachRef.current?.(), [attachRef]);
  return { keep, callKept, retry };
}

/**
 * The page's first look at the device: open while the device may hold unsent work the outbox has not
 * shown, failed when the outbox's code could not load or the device store did not answer in time.
 * Only the outbox's answer or a failed device storage closes it.
 */
type FirstLook = 'closed' | 'open' | 'failed';

/**
 * How long the first look waits for the outbox's answer. No clock action starts while it is open, so a
 * device store that never answers ends in the failure and its retry instead of a clock without controls.
 */
const FIRST_LOOK_WAIT_MS = 10_000;

/** Opens the page's first look at the device; returns the stop of its one bounded wait. */
function watchCheck(
  check: () => Promise<void>,
  setFirstLook: (update: (look: FirstLook) => FirstLook) => void,
): () => void {
  setFirstLook(() => 'open');
  void check();
  // One bounded wait, never a poll: a later answer still closes the look (`onView`).
  const bound = setTimeout(
    () => setFirstLook((look) => (look === 'open' ? 'failed' : look)),
    FIRST_LOOK_WAIT_MS,
  );
  return () => clearTimeout(bound);
}

/** Asks the outbox again on every return of the network and every action another tab kept; returns the stop. */
function askOutboxOnChanges(attachNow: () => void, uncheckedRef: RefObject<boolean>): () => void {
  // Every return of the network asks the outbox: another tab may have sent what this page kept.
  window.addEventListener('online', attachNow);
  // Another tab kept an action: until the outbox shows it, a tap here waits behind it.
  const onKept = (event: StorageEvent): void => {
    if (!event.key?.startsWith(UNSENT_MARK_PREFIX)) return;
    uncheckedRef.current = true;
    attachNow();
  };
  window.addEventListener('storage', onKept);
  return () => {
    window.removeEventListener('online', attachNow);
    window.removeEventListener('storage', onKept);
  };
}

export function useClockOutbox(holder: OutboxHolder | null, refresh: () => Promise<void>): ClockOutboxState {
  const [answer, setAnswer] = useState<{ view: ClockDeviceView | null; at: number }>({ view: null, at: -1 });
  const [kept, setKept] = useState(false);
  const [firstLook, setFirstLook] = useState<FirstLook>('closed');
  const [deviceFailed, setDeviceFailed] = useState(false);
  const attachRef = useRef<(() => void) | null>(null);
  // The wipe signal the page started under: after another tab's wipe it keeps nothing more, and its outbox holds nothing.
  const signalRef = useRef<string | null>(null);
  const uncheckedRef = useRef(false);
  const holderRef = useRef<OutboxHolder | null>(null);
  useEffect(() => {
    if (!holder) return;
    holderRef.current = holder;
    let detach: (() => void) | null = null;
    let ended = false;
    const onView = (next: ClockDeviceView | null, holdEnded = false): void => {
      // An attachment of the holder before a switch may still answer: never shown for the next one.
      if (ended) return;
      // After another tab's sign-out or switch the person's waiting events are out of sight: a tap waits behind them.
      uncheckedRef.current = holdEnded;
      setAnswer({ view: next, at: performance.now() });
      setKept(false);
      setFirstLook('closed');
    };
    /** Hands kept actions to the outbox; without signal they stay kept until the next `online`. */
    const attach = async (): Promise<void> => {
      let outbox: Awaited<ReturnType<typeof loadClockOutbox>>;
      try {
        outbox = await loadClockOutbox();
      } catch {
        // No signal is the expected cause; `online`, a retry or the next start tries again.
        if (!ended) setFirstLook((look) => (look === 'open' ? 'failed' : look));
        return;
      }
      try {
        detach = await outbox.attachClockOutbox(holder, onView, () => void refresh(), signalRef.current);
        // An attachment that ends after a switch never touches the next holder's state.
        if (ended) return detach();
        setDeviceFailed(false);
      } catch {
        if (ended) return;
        // The device storage failed (the outbox logged it): never mistaken for no signal, so actions go online.
        uncheckedRef.current = false;
        setDeviceFailed(true);
        setFirstLook('closed');
      }
    };
    const attachNow = (): void => void attach();
    attachRef.current = attachNow;
    signalRef.current = sharedWipeGeneration();
    // Until the outbox shows what waits, a new action goes behind it, never past it to the server.
    uncheckedRef.current = deviceMayHoldUnsentWork();
    // The clock shows nothing it is not sure of until this first look answered (shown-clock.ts).
    const stopWaiting = uncheckedRef.current ? watchCheck(attach, setFirstLook) : null;
    const stopListening = askOutboxOnChanges(attachNow, uncheckedRef);
    return () => {
      ended = true;
      stopWaiting?.();
      holderRef.current = null;
      attachRef.current = null;
      stopListening();
      detach?.();
      // The next person or organization never sees these events.
      setAnswer({ view: null, at: performance.now() });
      setKept(false);
      setFirstLook('closed');
      setDeviceFailed(false);
    };
  }, [holder, refresh]);

  const holderNow = useCallback(() => holderRef.current, []);
  const { keep, callKept, retry } = useKeepers(
    answer.view?.status === 'stopped',
    signalRef,
    attachRef,
    setKept,
  );
  return {
    view: answer.view,
    answeredAt: answer.at,
    checking: firstLook !== 'closed',
    loadFailed: firstLook === 'failed',
    retry,
    kept,
    unchecked: uncheckedRef,
    deviceFailed,
    holderNow,
    keep,
    callKept,
  };
}

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

/** The one lazy load of the clock's outbox and its view; it rejects without signal. */
export function loadClockOutbox(): Promise<typeof import('@/components/clock-unsent-events')> {
  return import('@/components/clock-unsent-events');
}

export type ClockOutboxState = {
  /** What the phone's outbox holds unsent for the person, once its code ran. */
  view: ClockDeviceView | null;
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
  callKept: <T>(action: Parameters<typeof keepClockAction>[0], call: () => Promise<T>) => Promise<T>;
};

/** The phone's time outbox (decision record 0010); its code loads only when unsent work may wait. */
export function useClockOutbox(holder: OutboxHolder | null, refresh: () => Promise<void>): ClockOutboxState {
  const [view, setView] = useState<ClockDeviceView | null>(null);
  const [kept, setKept] = useState(false);
  const [deviceFailed, setDeviceFailed] = useState(false);
  const attachRef = useRef<(() => void) | null>(null);
  // The wipe signal the page started under: after another tab's wipe it keeps nothing more.
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
      setView(next);
      setKept(false);
    };
    /** Hands kept actions to the outbox; without signal they stay kept until the next `online`. */
    const attach = async (): Promise<void> => {
      let outbox: Awaited<ReturnType<typeof loadClockOutbox>>;
      try {
        outbox = await loadClockOutbox();
      } catch {
        // best-effort: no signal is expected here; `online` or the next start tries again.
        return;
      }
      try {
        detach = await outbox.attachClockOutbox(holder, onView, () => void refresh());
        if (ended) detach();
        setDeviceFailed(false);
      } catch {
        // The device storage failed (the outbox logged it): never mistaken for no signal, so actions go online.
        uncheckedRef.current = false;
        setDeviceFailed(true);
      }
    };
    const attachNow = (): void => void attach();
    attachRef.current = attachNow;
    signalRef.current = sharedWipeGeneration();
    // Until the outbox shows what waits, a new action goes behind it, never past it to the server.
    uncheckedRef.current = deviceMayHoldUnsentWork();
    if (uncheckedRef.current) attachNow();
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
      ended = true;
      holderRef.current = null;
      attachRef.current = null;
      window.removeEventListener('online', attachNow);
      window.removeEventListener('storage', onKept);
      detach?.();
      // The next person or organization never sees these events.
      setView(null);
      setKept(false);
      setDeviceFailed(false);
    };
  }, [holder, refresh]);

  /** Keeps an action on the phone, never behind events that wait for the person: it would never be sent. */
  const stopped = view?.status === 'stopped';
  const keep = useCallback<ClockOutboxState['keep']>(
    (action) => {
      const signal = signalRef.current;
      const kept = stopped || signal === null ? null : keepClockAction(action, signal);
      if (!kept) return CLOCK_ACTION_FAILED;
      setKept(true);
      attachRef.current?.();
      return kept;
    },
    [stopped],
  );
  const holderNow = useCallback(() => holderRef.current, []);
  const callKept = useCallback<ClockOutboxState['callKept']>(
    (action, call) => callWhileKept(action, signalRef.current, call),
    [],
  );
  return { view, kept, unchecked: uncheckedRef, deviceFailed, holderNow, keep, callKept };
}

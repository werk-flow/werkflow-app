'use client';

import './registrations';
import { holdClock, outboxChanged, takeInKept } from './clock-device';
import { runSync, startSyncRunner } from './sync-runner';
import { discardTimeEvents, retryFirstTimeEvent, type ClockDeviceView } from './time-outbox';
import type { OutboxHolder } from './time-outbox-store';

// What the clock calls on the phone's time outbox. The clock's provider loads
// this module only when the device may hold unsent events or a clock action
// meets no network, so no page pays for it at start. A page whose signal is already gone keeps its
// action with the few lines of unsent-mark.ts and hands it over here later.

type ViewListener = (view: ClockDeviceView | null) => void;

/** The pages' listeners that already watch the outbox, each with the call that ends its watching. */
const attached = new WeakMap<ViewListener, () => void>();

/**
 * What a page calls whenever the device may hold unsent clock events: at its start, on `online`,
 * and after it kept an action without the server's answer. The first call for a listener shows it
 * the holder's unsent events, now and after every change, and starts the runner, which sends now
 * and on every `online`. Every call takes the actions pages kept into the outbox and tries to
 * send at once: a phone can be wrong about having no network. `onSettled` runs when a waiting
 * chain was sent or stopped, so the page reads the server's state again. Returns the call that
 * ends the watching.
 */
export async function attachClockOutbox(
  holder: OutboxHolder,
  listener: ViewListener,
  onSettled: () => void,
): Promise<() => void> {
  let detach = attached.get(listener);
  if (!detach) {
    let wasPending = false;
    detach = await holdClock(holder, (view) => {
      listener(view);
      if (wasPending && view?.status !== 'pending') onSettled();
      wasPending = view?.status === 'pending';
    });
    attached.set(listener, detach);
    // eslint-disable-next-line no-restricted-syntax -- the runner logs a sender's failure itself, and the events stay shown as unsent
    void startSyncRunner().catch(() => undefined);
  }
  await takeInKept();
  void sendUnsentNow();
  return detach;
}

/** „Jetzt senden“: one pass over every sender, resolved when it ended. */
export function sendUnsentNow(): Promise<void> {
  return runSync();
}

/** „Erneut senden“ for a refused first event: sends it again, unchanged. */
export async function resendRefusedTimeEvent(holder: OutboxHolder): Promise<void> {
  await retryFirstTimeEvent(holder);
  await runSync();
}

/** Deletes the holder's unsent events after the person confirmed it, or after their correction was filed. */
export async function deleteUnsentTimeEvents(holder: OutboxHolder): Promise<void> {
  await discardTimeEvents(holder);
  await outboxChanged();
}

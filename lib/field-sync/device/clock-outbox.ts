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

/**
 * Shows `listener` the holder's unsent events, now and after every change, and sends what the
 * phone holds: now, the app start, and on every `online`. Returns the call that ends the showing.
 */
export async function watchClockOutbox(
  holder: OutboxHolder,
  listener: (view: ClockDeviceView | null) => void,
): Promise<() => void> {
  const stop = await holdClock(holder, listener);
  // eslint-disable-next-line no-restricted-syntax -- the runner logs a sender's failure itself, and the events stay shown as unsent
  void startSyncRunner().catch(() => undefined);
  return stop;
}

/**
 * Takes the clock action a page just kept without the server's answer into the outbox and tries to
 * send it at once: the online call may only have failed on its way, and a phone can be wrong about
 * having no network. Without one the send fails and the event waits.
 */
export async function takeInKeptClockAction(): Promise<void> {
  await takeInKept();
  void sendUnsentNow();
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

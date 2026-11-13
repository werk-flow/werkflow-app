'use client';

import './registrations';
import { keptActionsWait } from './unsent-mark';
import {
  holdClock,
  outboxChanged,
  removeShownTimeEvents,
  takeInKept,
  type ViewListener,
} from './clock-device';
import { runSync, startSyncRunner } from './sync-runner';
import { retryFirstTimeEvent } from './time-outbox';
import { logError } from '@/lib/logging';
import type { LiveClockState } from '@/lib/time-tracking/types';
import type { OutboxHolder } from './time-outbox-store';

// What the clock calls on the phone's time outbox. The clock's provider loads
// this module only when the device may hold unsent events or a clock action
// meets no network, so no page pays for it at start. A page whose signal is already gone keeps its
// action with the few lines of unsent-mark.ts and hands it over here later.

/** The pages' listeners that already watch the outbox, each with the call that ends its watching. */
const attached = new WeakMap<ViewListener, () => void>();

/**
 * What a page calls whenever the device may hold unsent clock events: at its start, on `online`,
 * and after it kept an action without the server's answer. The first call for a listener shows it
 * the holder's unsent events, now and after every change, and starts the runner, which sends now
 * and on every `online`. Every call takes the actions pages kept into the outbox and tries to
 * send at once: a phone can be wrong about having no network. `onSettled` runs when a waiting
 * chain was sent or stopped, and when another tab's wipe ended the hold, also before the first
 * view: the page then reads the server's state again instead of keeping a kept action's echo.
 * Returns the call that ends the watching.
 */
export async function attachClockOutbox(
  holder: OutboxHolder,
  listener: ViewListener,
  onSettled: () => void,
): Promise<() => void> {
  let detach = attached.get(listener);
  if (!detach) {
    let wasPending = false;
    try {
      detach = await holdClock(holder, (view, holdEnded) => {
        listener(view, holdEnded);
        if (holdEnded || (wasPending && view?.status !== 'pending')) onSettled();
        wasPending = view?.status === 'pending';
      });
    } catch (failure) {
      logError('clock outbox: the device storage failed', failure);
      throw failure;
    }
    const stop = detach;
    // A listener attached again after it was detached holds the outbox again.
    detach = () => {
      attached.delete(listener);
      stop();
    };
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

/**
 * Deletes the unsent events `operationIds` names: the ones the person confirmed deleting, or the
 * ones their filed correction covers. What stays goes on from `resume`, the server's current clock.
 */
export async function deleteUnsentTimeEvents(
  holder: OutboxHolder,
  operationIds: readonly string[],
  resume: LiveClockState | null,
): Promise<void> {
  const { outbox } = await removeShownTimeEvents(holder, operationIds, resume);
  await outboxChanged();
  // What stays is the person's next work to send, also a tap kept behind a stop the person just deleted.
  if (outbox.events.length > 0 || keptActionsWait()) void sendUnsentNow();
}

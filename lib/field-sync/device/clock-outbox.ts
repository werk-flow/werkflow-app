'use client';

import type { LiveClockState, TimeTransitionResult } from '@/lib/time-tracking/types';
import './registrations';
import { clockHolder, holdClock, outboxChanged } from './clock-device';
import { runSync, startSyncRunner } from './sync-runner';
import {
  captureTimeEvent,
  discardTimeEvents,
  retryFirstTimeEvent,
  type ClockDeviceView,
  type OfflineClockCommand,
} from './time-outbox';
import type { OutboxHolder } from './time-outbox-store';

// What the clock calls on the phone's time outbox. The clock's provider loads
// this module only when the device may hold unsent events or a clock action
// meets no network, so no page pays for it at start.

const FAILED: TimeTransitionResult = { success: false, error: 'time_transition_failed' };

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
 * Keeps a clock action the server did not answer on the phone, and answers the clock as the
 * accepted action would. `base` is the clock the server last confirmed. A refusal answers as a
 * failed transition: a recovery or legacy action, a chain that waits for the person, another
 * tab's sign-out, or a device that cannot store.
 */
export async function captureClockAction(
  holder: OutboxHolder,
  capture: { command: OfflineClockCommand; base: LiveClockState | null; triedOnline: boolean },
): Promise<TimeTransitionResult> {
  if (clockHolder()?.userId !== holder.userId || clockHolder()?.organizationId !== holder.organizationId)
    return FAILED;
  const result = await captureTimeEvent(holder, { ...capture, capturedAt: new Date() });
  if (!result.captured) return FAILED;
  await outboxChanged(result.deviceHoldsEvents);
  // A phone that reports a network sends at once; without one the next `online` does.
  if (navigator.onLine) void sendUnsentNow();
  return {
    success: true,
    outcome: capture.command.action === 'end' ? 'ended' : 'active',
    sessionId: null,
    segmentId: null,
    version: null,
    recoveryReason: null,
    replayed: false,
    legacyBridged: false,
  };
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
  const { deviceHoldsEvents } = await discardTimeEvents(holder);
  await outboxChanged(deviceHoldsEvents);
}

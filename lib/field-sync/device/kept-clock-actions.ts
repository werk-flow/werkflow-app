'use client';

import { timeActivitySelectionSchema } from '@/lib/time-tracking/activity-selection-schema';
import { clockStateSchema } from '@/lib/time-tracking/state-client';
import { z } from '@/lib/zod';
import { captureTimeEvent, isOfflineClockAction } from './time-outbox';
import { KEPT_CLOCK_ACTION_PREFIX, clockCallLock } from './unsent-mark';

// Takes the clock actions a page kept without signal (unsent-mark.ts) into the
// time outbox. A page that loses its signal can load no code any more, so it
// writes the action to localStorage with the few lines it carries; this module
// moves it into the outbox, whose rules need IndexedDB. An action's key goes
// only after the outbox holds it.

const keptClockActionSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  /** Created when the person acted; the outbox and every send keep it. */
  operationId: z.string(),
  action: z.string(),
  selection: timeActivitySelectionSchema.nullable(),
  expectedSessionId: z.string().nullable(),
  expectedVersion: z.number().nullable(),
  capturedAt: z.string(),
  /** The online clock call was tried first, under the same operation id. */
  triedOnline: z.boolean(),
  /** Written before the online call and gone once it answered: an entry left behind belongs to a page that closed mid-call. */
  inFlight: z.boolean().optional(),
  /** The wipe signal when the person acted (today-wipe.ts). */
  wipeGeneration: z.string(),
  /** The clock the server last confirmed, as the page read it; null when the page held none. */
  base: clockStateSchema.nullable(),
  /** When the page read `base` from the server (time-outbox.ts, TimeEventCapture). */
  readAt: z.string().nullable(),
});

/** One clock action as a page keeps it when it meets no network. */
export type KeptClockAction = z.infer<typeof keptClockActionSchema>;

/** The keys of the kept clock actions, in the order of their taps. */
function keptActionKeys(): string[] {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '')
    .filter((key) => key.startsWith(KEPT_CLOCK_ACTION_PREFIX))
    .toSorted();
}

function readKeptAction(key: string): KeptClockAction | null {
  try {
    const kept = keptClockActionSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'));
    return kept.success && isOfflineClockAction(kept.data.action) ? kept.data : null;
  } catch {
    return null;
  }
}

/** How long, without Web Locks, an entry written before an online call counts as its page's still. */
const CALL_WITHOUT_LOCKS_MS = 2 * 60 * 1000;

/** Whether the page that wrote this entry before its online call still holds that call open. */
async function callStillRuns(kept: KeptClockAction): Promise<boolean> {
  if (typeof navigator.locks?.request !== 'function')
    return Date.now() - Date.parse(kept.capturedAt) < CALL_WITHOUT_LOCKS_MS;
  return navigator.locks.request(
    clockCallLock(kept.operationId),
    { ifAvailable: true },
    (lock) => lock === null,
  );
}

/**
 * Moves every kept clock action into its person's outbox, in the order of the taps, and answers
 * how many it moved and how many it cannot read. An action this version cannot read stays kept: it
 * is never dropped unread, and a session must not end over it (clock-device.ts). Throws when the
 * device storage fails; the actions then stay kept.
 */
export async function takeInKeptClockActions(
  /** Marks the device as holding unsent work; runs before a key goes, so a tab closed mid-intake never hides the event. */
  markHeld: () => void,
): Promise<{ moved: number; unreadable: number }> {
  let moved = 0;
  let unreadable = 0;
  for (const key of keptActionKeys()) {
    const kept = readKeptAction(key);
    if (!kept) {
      unreadable += 1;
      continue;
    }
    const {
      userId,
      organizationId,
      action,
      base,
      readAt,
      capturedAt,
      triedOnline,
      wipeGeneration,
      inFlight,
      ...command
    } = kept;
    if (!isOfflineClockAction(action)) continue;
    // Its page still waits for the server's answer; what was kept after it waits behind it.
    if (inFlight && (await callStillRuns(kept))) break;
    await captureTimeEvent(
      { userId, organizationId },
      {
        command: { ...command, action },
        base,
        readAt: readAt === null ? null : new Date(readAt),
        capturedAt: new Date(capturedAt),
        triedOnline,
        wipeGeneration,
      },
    );
    // Only after the outbox holds it and the start-up hint says so; a second take-in keeps it once there.
    markHeld();
    localStorage.removeItem(key);
    moved += 1;
  }
  return { moved, unreadable };
}

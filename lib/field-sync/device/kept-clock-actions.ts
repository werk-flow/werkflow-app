'use client';

import { timeActivitySelectionSchema } from '@/lib/time-tracking/activity-selection-schema';
import { clockStateSchema } from '@/lib/time-tracking/state-client';
import { z } from '@/lib/zod';
import { captureTimeEvent, isOfflineClockAction } from './time-outbox';
import { KEPT_CLOCK_ACTION_PREFIX, storageKeys } from './unsent-mark';

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
  /** The wipe signal when the person acted (today-wipe.ts). */
  wipeGeneration: z.string(),
  /** The clock the server last confirmed, for the first action a page keeps; null for the ones after it. */
  base: clockStateSchema.nullable(),
});

/** One clock action as a page keeps it when it meets no network. */
export type KeptClockAction = z.infer<typeof keptClockActionSchema>;

/** The keys of the kept clock actions, in the order of their taps. */
function keptActionKeys(): string[] {
  return storageKeys()
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

/**
 * Moves every kept clock action into its person's outbox, in the order of the taps, and answers
 * how many it moved and how many it cannot read. An action this version cannot read stays kept: it
 * is never dropped unread, and a session must not end over it (clock-device.ts). Throws when the
 * device storage fails; the actions then stay kept.
 */
export async function takeInKeptClockActions(): Promise<{ moved: number; unreadable: number }> {
  let moved = 0;
  let unreadable = 0;
  for (const key of keptActionKeys()) {
    const kept = readKeptAction(key);
    if (!kept) {
      unreadable += 1;
      continue;
    }
    const { userId, organizationId, action, base, capturedAt, triedOnline, wipeGeneration, ...command } =
      kept;
    if (!isOfflineClockAction(action)) continue;
    await captureTimeEvent(
      { userId, organizationId },
      {
        command: { ...command, action },
        base,
        capturedAt: new Date(capturedAt),
        triedOnline,
        wipeGeneration,
      },
    );
    // Only after the outbox holds it; a second take-in of the same action is kept once there.
    localStorage.removeItem(key);
    moved += 1;
  }
  return { moved, unreadable };
}

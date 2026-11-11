'use client';

import { timeActivitySelectionSchema } from '@/lib/time-tracking/activity-selection-schema';
import { clockStateSchema } from '@/lib/time-tracking/state-client';
import { z } from '@/lib/zod';
import { captureTimeEvent, isOfflineClockAction } from './time-outbox';
import { KEPT_CLOCK_ACTIONS_KEY } from './unsent-mark';

// Takes the clock actions a page kept without signal (unsent-mark.ts) into the
// time outbox. A page that loses its signal can load no code any more, so it
// writes the action to localStorage with the few lines it carries; this module
// moves it into the outbox, whose rules need IndexedDB. An action leaves the
// list only after the outbox holds it.

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

function readKeptActions(): unknown[] {
  const kept: unknown = JSON.parse(localStorage.getItem(KEPT_CLOCK_ACTIONS_KEY) ?? '[]');
  return Array.isArray(kept) ? kept : [];
}

/**
 * Moves every kept clock action into its person's outbox, in the kept order, and answers whether
 * it moved any. An action this version cannot read stays in the list: it is never dropped unread.
 * Throws when the device storage fails; the actions then stay kept.
 */
export async function takeInKeptClockActions(): Promise<boolean> {
  const taken = new Set<string>();
  for (const raw of readKeptActions()) {
    const kept = keptClockActionSchema.safeParse(raw);
    if (!kept.success) continue;
    const { userId, organizationId, action, base, capturedAt, triedOnline, wipeGeneration, ...command } =
      kept.data;
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
    taken.add(command.operationId);
  }
  if (taken.size === 0) return false;
  // Read again, with no wait before the write: an action a page kept meanwhile stays for the next call.
  const left = readKeptActions().filter(
    (raw) => !taken.has(z.object({ operationId: z.string() }).safeParse(raw).data?.operationId ?? ''),
  );
  if (left.length > 0) localStorage.setItem(KEPT_CLOCK_ACTIONS_KEY, JSON.stringify(left));
  else localStorage.removeItem(KEPT_CLOCK_ACTIONS_KEY);
  return true;
}

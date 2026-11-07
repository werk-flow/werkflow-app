'use client';

import { Constants } from '@/lib/supabase/database.types';
import { z } from '@/lib/zod';
import { TIME_ENTRY_TYPES, type TimeEntry } from './types';

const STORAGE_KEY = 'werkflow:manual-entry-created';
export const MANUAL_ENTRY_CREATED_EVENT = 'werkflow:manual-entry-created';

/** The queued entries as queueManualEntryBridge stored them: the fields toTimeEntry sets. */
const queuedEntriesSchema = z.array(
  z.object({
    id: z.string(),
    userId: z.string(),
    organizationId: z.string(),
    entryType: z.enum(TIME_ENTRY_TYPES),
    timestamp: z.string(),
    isManual: z.boolean(),
    jobId: z.string().nullable(),
    status: z.enum(Constants.public.Enums.time_entry_status),
    reviewedBy: z.string().nullable(),
    reviewedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    sourceKind: z.enum(['legacy_entry', 'canonical_segment', 'correction_application']).optional(),
    sourceVersion: z.string().optional(),
  }),
);

/**
 * The queue a signed-in user left for the calendar of this tab. It names that
 * user, not the person an entry is for: an admin queues entries they added
 * for an employee.
 */
const queueSchema = z.object({ userId: z.string(), entries: queuedEntriesSchema });

type Queue = { userId: string; entries: TimeEntry[] };

/** The stored queue, or null when it is not one this module wrote. */
function readQueue(raw: string): Queue | null {
  const parsed = queueSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

/** The entries of a created event, or null when its detail is not what the manual entry button sends. */
export function readManualEntryEvent(detail: unknown): TimeEntry[] | null {
  const parsed = z.object({ entries: queuedEntriesSchema }).safeParse(detail);
  return parsed.success ? parsed.data.entries : null;
}

function canUseBrowserStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

/** Queues the signed-in user's new entries until the calendar of this tab reads them. */
export function queueManualEntryBridge(userId: string, entries: TimeEntry[]): void {
  if (!canUseBrowserStorage() || entries.length === 0) {
    return;
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const existing = raw ? readQueue(raw) : null;
    // A queue of another user, or one this module cannot read, is replaced, so it never blocks the bridge.
    const merged = existing?.userId === userId ? [...existing.entries] : [];

    for (const entry of entries) {
      if (!merged.some((candidate) => candidate.id === entry.id)) {
        merged.push(entry);
      }
    }

    const queue: Queue = { userId, entries: merged };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // best-effort: the bridge only shows the new entry early; the saved entry arrives with the next read.
  }
}

/**
 * The queued entries of the signed-in user in the active organization,
 * removed from the queue. A queue another user left in this tab is dropped
 * unread.
 */
export function consumeManualEntryBridge({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}): TimeEntry[] {
  if (!canUseBrowserStorage()) {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const queue = readQueue(raw);
    if (!queue || queue.userId !== userId) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return [];
    }
    const matching = queue.entries.filter((entry) => entry.organizationId === organizationId);
    const remaining = queue.entries.filter((entry) => entry.organizationId !== organizationId);

    if (remaining.length > 0) {
      const rest: Queue = { userId, entries: remaining };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }

    return matching;
  } catch {
    // best-effort: the bridge only shows a new entry early; the saved entry arrives with the next read.
    return [];
  }
}

/** Empties the queue. Every sign-out of this browser calls it before the session ends. */
export function clearManualEntryBridge(): void {
  if (!canUseBrowserStorage()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort: a storage that refuses access holds no queue this module could read either, and the sign-out goes on.
  }
}

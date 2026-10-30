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

/** The stored queue, or null when it is not one this module wrote. */
function readQueuedEntries(raw: string): TimeEntry[] | null {
  const parsed = queuedEntriesSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

function canUseBrowserStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function queueManualEntryBridge(entries: TimeEntry[]): void {
  if (!canUseBrowserStorage() || entries.length === 0) {
    return;
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const existing = raw ? readQueuedEntries(raw) : [];
    if (!existing) return;
    const merged = [...existing];

    for (const entry of entries) {
      if (!merged.some((candidate) => candidate.id === entry.id)) {
        merged.push(entry);
      }
    }

    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // best-effort: the bridge only shows the new entry early; the saved entry arrives with the next read.
  }
}

export function consumeManualEntryBridge(organizationId: string): TimeEntry[] {
  if (!canUseBrowserStorage()) {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const queued = readQueuedEntries(raw);
    if (!queued) return [];
    const matching = queued.filter((entry) => entry.organizationId === organizationId);
    const remaining = queued.filter((entry) => entry.organizationId !== organizationId);

    if (remaining.length > 0) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }

    return matching;
  } catch {
    // best-effort: the bridge only shows a new entry early; the saved entry arrives with the next read.
    return [];
  }
}

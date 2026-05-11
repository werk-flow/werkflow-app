'use client';

import type { TimeEntry } from './types';

const STORAGE_KEY = 'werkflow:manual-entry-created';
export const MANUAL_ENTRY_CREATED_EVENT = 'werkflow:manual-entry-created';

function canUseBrowserStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function queueManualEntryBridge(entries: TimeEntry[]) {
  if (!canUseBrowserStorage() || entries.length === 0) {
    return;
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const existing = raw ? (JSON.parse(raw) as TimeEntry[]) : [];
    const merged = [...existing];

    for (const entry of entries) {
      if (!merged.some((candidate) => candidate.id === entry.id)) {
        merged.push(entry);
      }
    }

    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Best-effort bridge only.
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

    const queued = JSON.parse(raw) as TimeEntry[];
    const matching = queued.filter((entry) => entry.organizationId === organizationId);
    const remaining = queued.filter((entry) => entry.organizationId !== organizationId);

    if (remaining.length > 0) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }

    return matching;
  } catch {
    return [];
  }
}

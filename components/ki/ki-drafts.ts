'use client';

import { tabStorage } from '@/lib/time-tracking/manual-entry-bridge-storage';

// The chat composer's drafts (brief non-negotiable 8): one per person,
// organization and thread, in this tab's sessionStorage, so a draft survives
// navigation and reload and leaves the device with the tab. A memory copy
// carries it when storage is refused. Every sign-out of the tab clears them,
// so this module stays free of the chat's UI: the sign-out loads at start-up.

const DRAFT_PREFIX = 'werkflow:ki-draft:';
const memoryDrafts = new Map<string, string>();
const draftListeners = new Set<() => void>();

export function subscribeDrafts(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
}

export function readDraft(key: string): string {
  const kept = memoryDrafts.get(key);
  if (kept !== undefined) return kept;
  try {
    return tabStorage()?.getItem(key) ?? '';
  } catch {
    // best-effort: storage that refuses a read holds no draft of this page.
    return '';
  }
}

/** Saves or clears the draft under `key`. */
export function writeDraft(key: string, text: string): void {
  memoryDrafts.set(key, text);
  try {
    if (text) tabStorage()?.setItem(key, text);
    else tabStorage()?.removeItem(key);
  } catch {
    // best-effort: the memory copy keeps the draft for this page when the browser refuses storage.
  }
  for (const listener of draftListeners) listener();
}

/** One draft per person, organization and thread; the new chat has its own. */
export function draftKey(userId: string, organizationId: string, threadId: string | null): string {
  return `${DRAFT_PREFIX}${userId}:${organizationId}:${threadId ?? 'neu'}`;
}

/** Drops every chat draft of this tab. Every sign-out calls it before the session ends. */
export function clearKiDrafts(): void {
  memoryDrafts.clear();
  try {
    const storage = tabStorage();
    if (!storage) return;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) if (key?.startsWith(DRAFT_PREFIX)) storage.removeItem(key);
  } catch {
    // best-effort: storage that refuses access holds no draft this tab could show, and the sign-out goes on.
  }
  for (const listener of draftListeners) listener();
}

'use client';

// The WerkFlow KI chat composer's drafts (brief non-negotiable 8): one per person,
// organization and thread, in this tab's sessionStorage, so a draft survives
// navigation and reload and leaves the device with the tab. A memory copy
// carries it when storage is refused. Every browser sign-out clears them
// (lib/conventions/sign-out-clears-tab-state.test.ts), so this module imports
// nothing: the menu sign-out loads at start-up.

const DRAFT_PREFIX = 'werkflow:ki-draft:';

/** The tab's session storage, or null where the browser refuses it. Every sign-out loads this module, so it imports nothing. */
function draftStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    // best-effort: without storage the drafts live in memory only, and a sign-out must go on.
    return null;
  }
}
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
    return draftStorage()?.getItem(key) ?? '';
  } catch {
    // best-effort: storage that refuses a read holds no draft of this page.
    return '';
  }
}

/** Saves or clears the draft under `key`. */
export function writeDraft(key: string, text: string): void {
  memoryDrafts.set(key, text);
  try {
    if (text) draftStorage()?.setItem(key, text);
    else draftStorage()?.removeItem(key);
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
    const storage = draftStorage();
    if (!storage) return;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) if (key?.startsWith(DRAFT_PREFIX)) storage.removeItem(key);
  } catch {
    // best-effort: storage that refuses access holds no draft this tab could show, and the sign-out goes on.
  }
  for (const listener of draftListeners) listener();
}

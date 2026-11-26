'use client';

import { tabStorage } from '@/lib/time-tracking/manual-entry-bridge-storage';

// The sign-out half of the WerkFlow KI drafts (lib/ai/chat-drafts.ts). The menu
// sign-out sits in a chunk every page loads at start-up, so this module holds
// only the key prefix and the clear, and imports only the storage module every
// sign-out already loads. The chat's own module stays with the chat page:
// in the start-up chunk it split a layout script in two for every user
// (werk-flow/werkflow-planning#530).

export const KI_DRAFT_PREFIX = 'werkflow:ki-draft:';

/** How a loaded chat drops its memory copies; set once its draft module loads. */
let dropMemoryDrafts: (() => void) | null = null;

/** The chat's draft module calls this once, so a sign-out also clears the drafts it holds in memory. */
export function onKiDraftsCleared(drop: () => void): void {
  dropMemoryDrafts = drop;
}

/** The chat keys this tab keeps in sessionStorage. */
export function storedKiDraftKeys(): string[] {
  try {
    const storage = tabStorage();
    if (!storage) return [];
    return Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '').filter((key) =>
      key.startsWith(KI_DRAFT_PREFIX),
    );
  } catch {
    // best-effort: storage that refuses access holds no draft; the memory copies still count.
    return [];
  }
}

/** Drops every chat draft of this tab. Every sign-out calls it before the session ends. */
export function clearKiDrafts(): void {
  const keys = storedKiDraftKeys();
  try {
    for (const key of keys) tabStorage()?.removeItem(key);
  } catch {
    // best-effort: storage that refuses access holds no draft this tab could show, and the sign-out goes on.
  }
  dropMemoryDrafts?.();
}

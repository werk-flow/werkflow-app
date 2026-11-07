'use client';

// The storage half of the manual entry bridge, without its schemas. Every
// sign-out imports `clearManualEntryBridge`, and the menu sign-out sits in a
// chunk every page loads at startup, so this module must stay free of Zod and
// the time entry types.

export const MANUAL_ENTRY_BRIDGE_STORAGE_KEY = 'werkflow:manual-entry-created';

/**
 * The tab's session storage, or null outside the browser and where the
 * browser refuses storage: reading `window.sessionStorage` then throws.
 */
export function tabStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    // best-effort: without storage the bridge holds nothing, and a sign-out must go on.
    return null;
  }
}

/** Empties the queue. Every sign-out of this browser calls it before the session ends. */
export function clearManualEntryBridge(): void {
  try {
    tabStorage()?.removeItem(MANUAL_ENTRY_BRIDGE_STORAGE_KEY);
  } catch {
    // best-effort: a storage that refuses the write holds no queue this module could read either, and the sign-out goes on.
  }
}

'use client';

import { logError } from '@/lib/logging';

/** Every cache the service worker (public/sw.js) owns starts with this. */
const SERVICE_WORKER_CACHE_PREFIX = 'werkflow-';

/** Asks the service worker (public/sw.js) to fill its shell again when it is missing. */
const SHELL_REFILL_MESSAGE = 'werkflow:refill-shell';

/**
 * Deletes every cache the service worker owns. Sign-out and an organization
 * switch call it, so nothing one person or organization saw stays readable
 * on a shared device. A failure reaches the log and never blocks the caller.
 */
export async function clearServiceWorkerCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith(SERVICE_WORKER_CACHE_PREFIX)).map((name) => caches.delete(name)),
    );
  } catch (error) {
    // best-effort: the shell cache holds only the offline page and build files, nothing personal, so the sign-out or switch goes on.
    logError('clearServiceWorkerCaches: cache deletion failed', error);
  }
}

/**
 * Asks the active service worker to fill the offline shell again: the cookie-free
 * fallback page and its static files. A signed-in page calls it after a client-side
 * navigation that found the shell deleted (an organization switch, a sign-in after
 * a sign-out), since only a full page load refills it otherwise.
 */
export async function restoreOfflineShell(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.active?.postMessage(SHELL_REFILL_MESSAGE);
  } catch (error) {
    // best-effort: without the shell the device shows the browser's own offline page until the next full load.
    logError('restoreOfflineShell: refill request failed', error);
  }
}

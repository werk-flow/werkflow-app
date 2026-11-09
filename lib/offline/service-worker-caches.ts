'use client';

// The page side of the service worker's caches. Sign-out, an organization
// switch and account deletion import it statically: a lazy chunk can be gone
// in a tab open across a deployment, and a sign-out that waits for it could
// never run. So it imports nothing but the logging every startup chunk
// already carries (lib/conventions/offline-code-loads-lazily.test.ts).

import { logError } from '@/lib/logging';

/** Every cache the service worker (public/sw.js) owns starts with this. */
const SERVICE_WORKER_CACHE_PREFIX = 'werkflow-';

/**
 * The message public/sw.js answers by filling its offline shell again when it
 * is missing. The app shell sends it on mount, the organization switch after
 * it cleared the caches (lib/security/service-worker.test.ts pins both sides).
 */
export const SHELL_REFILL_MESSAGE = 'werkflow:refill-shell';

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
 * Asks the active service worker to fill the offline shell again. The
 * organization switch calls it after its cache clear has finished: the switch
 * navigates on the client, which never refills the shell otherwise.
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

'use client';

import { logError } from '@/lib/logging';

/** Every cache the service worker (public/sw.js) owns starts with this. */
const SERVICE_WORKER_CACHE_PREFIX = 'werkflow-';

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

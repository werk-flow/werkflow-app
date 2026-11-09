'use client';

import { useEffect } from 'react';

import { logError } from '@/lib/logging';

/**
 * Registers the service worker of the installable app shell once the page has
 * loaded, so it adds nothing to the first paint.
 * Development builds skip it: their files change on every edit.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let queued: number | undefined;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
        logError('ServiceWorkerRegistration: registration failed', error);
      });
    };
    // A task after the load event: the page has painted and loaded its own files first.
    const afterLoad = () => {
      queued = window.setTimeout(register);
    };
    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true });
    return () => {
      window.removeEventListener('load', afterLoad);
      window.clearTimeout(queued);
    };
  }, []);
  return null;
}

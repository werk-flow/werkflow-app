'use client';

import { useEffect } from 'react';

import { returnToApp, returnWhenReachable, returnsOnStart } from './return-to-app';

/**
 * Opens the app again once the signal returns, checking again while the new connection settles,
 * also while the page shows the stored day. Its start checks once when the signal came back before
 * the page could listen; a phone may report a network it does not have, so the start never waits
 * on more. Renders nothing.
 */
export function ReturnOnSignal(): null {
  useEffect(() => {
    const onOnline = (): void => void returnWhenReachable();
    window.addEventListener('online', onOnline);
    if (returnsOnStart()) void returnToApp();
    return () => window.removeEventListener('online', onOnline);
  }, []);
  return null;
}

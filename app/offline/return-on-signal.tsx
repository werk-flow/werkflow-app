'use client';

import { useEffect } from 'react';

import { returnToApp, returnsOnStart } from './return-to-app';

/**
 * Opens the app again once the signal returns, also while the page shows the stored day, and at the
 * page's start when the signal came back before the page could listen. Renders nothing.
 */
export function ReturnOnSignal(): null {
  useEffect(() => {
    const onOnline = (): void => void returnToApp();
    window.addEventListener('online', onOnline);
    if (returnsOnStart()) void returnToApp();
    return () => window.removeEventListener('online', onOnline);
  }, []);
  return null;
}

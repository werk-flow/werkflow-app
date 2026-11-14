'use client';

import { useEffect } from 'react';

import { returnToApp } from './return-to-app';

/** Opens the app again once the signal returns, also while the page shows the stored day. Renders nothing. */
export function ReturnOnSignal(): null {
  useEffect(() => {
    const onOnline = (): void => void returnToApp();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);
  return null;
}

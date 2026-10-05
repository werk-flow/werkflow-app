'use client';

import { useEffect } from 'react';

import { logError } from '@/lib/logging';

export function AuthFlashCleanup() {
  useEffect(() => {
    void fetch('/auth/flash', {
      method: 'DELETE',
    }).catch((error: unknown) => {
      // Best-effort: the flash cookie also expires by itself, and nothing on the page depends on it.
      logError('auth.flash.clear_failed', error);
    });
  }, []);

  return null;
}

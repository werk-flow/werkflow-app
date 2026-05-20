'use client';

import { useEffect } from 'react';

export function AuthFlashCleanup() {
  useEffect(() => {
    void fetch('/auth/flash', {
      method: 'DELETE',
    }).catch((error) => {
      console.warn('Failed to clear auth flash cookie during cleanup.', error);
    });
  }, []);

  return null;
}

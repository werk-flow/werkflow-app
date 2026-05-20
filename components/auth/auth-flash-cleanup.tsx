'use client';

import { useEffect } from 'react';

export function AuthFlashCleanup() {
  useEffect(() => {
    void fetch('/auth/flash', {
      method: 'DELETE',
    });
  }, []);

  return null;
}

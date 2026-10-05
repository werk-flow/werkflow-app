'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Whether the scoped calendar is still mounted. Async reads and mutation
 * feedback check it before they touch state or show a banner.
 */
export function useScopeActive(): { scopeActive: React.RefObject<boolean>; isScopeActive: () => boolean } {
  const scopeActive = useRef(true);
  useEffect(() => {
    scopeActive.current = true;
    return () => {
      scopeActive.current = false;
    };
  }, []);
  const isScopeActive = useCallback(() => scopeActive.current, []);
  return { scopeActive, isScopeActive };
}

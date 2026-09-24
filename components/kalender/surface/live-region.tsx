'use client';

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';

/**
 * One polite live region for the calendar (P1-24a, criterion 33): drop
 * results, refusals and undo outcomes are announced here without a React
 * commit, so a drag that ends in a refusal is heard as well as seen.
 */
const AnnounceContext = createContext<((text: string) => void) | null>(null);

export function CalendarLiveRegion({ children }: { children: ReactNode }): React.JSX.Element {
  const regionRef = useRef<HTMLDivElement>(null);
  const announce = useCallback((text: string) => {
    const region = regionRef.current;
    if (!region) return;
    // Clearing first makes an identical second announcement audible again.
    region.textContent = '';
    window.setTimeout(() => { region.textContent = text; }, 30);
  }, []);
  const value = useMemo(() => announce, [announce]);
  return (
    <AnnounceContext.Provider value={value}>
      {children}
      <div ref={regionRef} aria-live="polite" aria-atomic="true" className="sr-only" data-calendar-live-region="" />
    </AnnounceContext.Provider>
  );
}

export function useCalendarAnnounce(): (text: string) => void {
  const announce = useContext(AnnounceContext);
  if (!announce) throw new Error('useCalendarAnnounce requires a CalendarLiveRegion.');
  return announce;
}

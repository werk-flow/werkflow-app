'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CalendarView } from './calendar-container';

const PHONE_QUERY = '(max-width: 639px)';

function subscribeToPhoneQuery(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True below the `sm` breakpoint, where the calendar draws lists instead of grids. */
export function usePhoneQuery(): boolean {
  return useSyncExternalStore(
    subscribeToPhoneQuery,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/** The rendered height of the element, following resizes. */
export function useObservedHeight(
  elementRef: React.RefObject<HTMLElement | null>,
  initialHeight: number,
): number {
  const [height, setHeight] = useState(initialHeight);
  useEffect(() => {
    const headerEl = elementRef.current;
    if (!headerEl) return;
    const updateHeights = () => setHeight(headerEl.getBoundingClientRect().height);
    updateHeights();
    const observer = new ResizeObserver(updateHeights);
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, [elementRef]);
  return height;
}

/**
 * Readiness marker for measured navigation (PF-22): set from an effect, so it
 * exists only after hydration and after the data owner reports coverage of
 * the rendered window. Tests read the same state users see.
 */
export function useCalendarStateMarker(
  scrollContainerRef: React.RefObject<HTMLElement | null>,
  marker: {
    readinessKind: string;
    calendarStale: boolean;
    view: CalendarView;
    neededStartIso: string;
    horizonWeeks: number;
  },
): void {
  const { readinessKind, calendarStale, view, neededStartIso, horizonWeeks } = marker;
  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return;
    element.dataset.calendarState = readinessKind;
    element.dataset.calendarView = view;
    element.dataset.calendarRangeStart = neededStartIso;
    element.dataset.calendarStale = calendarStale ? 'true' : 'false';
    element.dataset.calendarHorizon = String(horizonWeeks);
  }, [scrollContainerRef, readinessKind, calendarStale, view, neededStartIso, horizonWeeks]);
}

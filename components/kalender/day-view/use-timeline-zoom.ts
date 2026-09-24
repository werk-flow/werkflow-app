'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DAY_NAME_COLUMN_PX, fittedHourWidth, TIMELINE_MAX_ZOOM, TIMELINE_MIN_ZOOM, TIMELINE_START_HOUR } from '@/lib/calendar/day-layout';

const WHEEL_STEP = 0.08;

/**
 * The hour width of the day view: fitted to the scroller's viewport at zoom
 * 1, scaled by the zoom the container owns (`+`/`-`), and by ctrl+wheel
 * anchored under the pointer. The scroller is the page's calendar region,
 * which owns both axes. Scrolls to the first working hour per shown day.
 */
export function useTimelineZoom(input: { zoom: number; onZoomChange: (zoom: number) => void; dateKey: string; scroller: () => HTMLElement | null }): number {
  const { zoom, onZoomChange, dateKey, scroller } = input;
  const [viewportWidth, setViewportWidth] = useState(0);
  const hourWidth = fittedHourWidth(Math.max(0, viewportWidth - DAY_NAME_COLUMN_PX), zoom);
  const anchorRef = useRef<{ hour: number; cursorX: number } | null>(null);

  useLayoutEffect(() => {
    const element = scroller();
    if (!element) return;
    setViewportWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [scroller]);

  useEffect(() => {
    const element = scroller();
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const cursorX = event.clientX - rect.left - DAY_NAME_COLUMN_PX;
      anchorRef.current = { hour: (element.scrollLeft + cursorX) / hourWidth, cursorX };
      const factor = Math.max(1 - WHEEL_STEP, Math.min(1 + WHEEL_STEP, 1 - event.deltaY * 0.003));
      onZoomChange(Math.max(TIMELINE_MIN_ZOOM, Math.min(TIMELINE_MAX_ZOOM, zoom * factor)));
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [hourWidth, onZoomChange, scroller, zoom]);

  // Keep the hour under the pointer where it was after the width changed.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const element = scroller();
    if (!anchor || !element) return;
    element.scrollLeft = anchor.hour * hourWidth - anchor.cursorX;
    anchorRef.current = null;
  }, [hourWidth, scroller]);

  const scrollToStart = useCallback(() => {
    const element = scroller();
    if (!element) return;
    // The scroller is the page's: the board may leave a vertical offset that would hide the first row's top lane under the sticky header.
    element.scrollTop = 0;
    element.scrollLeft = TIMELINE_START_HOUR * hourWidth;
  }, [hourWidth, scroller]);

  const measured = viewportWidth > 0;
  useEffect(() => {
    if (measured) scrollToStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the day view scrolls to the working hours once per shown day, once the viewport is measured
  }, [dateKey, measured]);

  return hourWidth;
}

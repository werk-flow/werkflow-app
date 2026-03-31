'use client';

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';

export const BASE_HOUR_WIDTH = 60;
const VISIBLE_HOURS = 13; // 5am to 6pm
const DEFAULT_START_HOUR = 5;
const MAX_ZOOM_MULTIPLIER = 4;
const MAX_ZOOM_STEP = 0.08;

export function getEffectiveHourWidth(zoom: number) {
  return BASE_HOUR_WIDTH * zoom;
}

export function getTimelineWidth(zoom: number) {
  return 24 * getEffectiveHourWidth(zoom);
}

export function useTimelineZoom() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const defaultZoomRef = useRef(1);
  const zoomRef = useRef(1);
  const isCoarsePointer = useRef(false);
  const rafId = useRef<number | null>(null);

  const anchorRef = useRef<{ time: number; cursorX: number } | null>(null);
  const gestureAnchorRef = useRef<{ time: number; cursorX: number } | null>(null);
  const lastWheelTimeRef = useRef(0);

  useEffect(() => {
    isCoarsePointer.current = window.matchMedia('(pointer: coarse)').matches;
  }, []);

  const computeDefaultZoom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return 1;
    return Math.max(1, container.clientWidth / (VISIBLE_HOURS * BASE_HOUR_WIDTH));
  }, []);

  const scrollToHour = useCallback((hour: number, zoom: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollLeft = hour * BASE_HOUR_WIDTH * zoom;
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const init = () => {
      const zoom = computeDefaultZoom();
      defaultZoomRef.current = zoom;
      zoomRef.current = zoom;
      setZoomLevel(zoom);
      requestAnimationFrame(() => scrollToHour(DEFAULT_START_HOUR, zoom));
    };

    init();

    const observer = new ResizeObserver(() => {
      const newDefault = computeDefaultZoom();
      defaultZoomRef.current = newDefault;
      if (zoomRef.current < newDefault) {
        zoomRef.current = newDefault;
        setZoomLevel(newDefault);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [computeDefaultZoom, scrollToHour]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (isCoarsePointer.current) return;
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const cursorXInContainer = e.clientX - rect.left;
      const cursorXInTimeline = container.scrollLeft + cursorXInContainer;

      const currentZoom = zoomRef.current;
      const timeUnderCursor = cursorXInTimeline / (BASE_HOUR_WIDTH * currentZoom);

      const rawFactor = 1 - e.deltaY * 0.003;
      const clampedFactor = Math.max(1 - MAX_ZOOM_STEP, Math.min(1 + MAX_ZOOM_STEP, rawFactor));

      const minZoom = defaultZoomRef.current;
      const maxZoom = minZoom * MAX_ZOOM_MULTIPLIER;
      const newZoom = Math.max(minZoom, Math.min(maxZoom, currentZoom * clampedFactor));

      if (newZoom === currentZoom) return;

      zoomRef.current = newZoom;

      const now = Date.now();
      if (now - lastWheelTimeRef.current > 120 || !gestureAnchorRef.current) {
        gestureAnchorRef.current = { time: timeUnderCursor, cursorX: cursorXInContainer };
      }
      lastWheelTimeRef.current = now;
      anchorRef.current = gestureAnchorRef.current;

      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(() => {
          rafId.current = null;
          setZoomLevel(zoomRef.current);
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, []);

  // Anchor scroll after React commits new element positions but before paint
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const container = scrollContainerRef.current;
    if (!anchor || !container) return;

    container.scrollLeft =
      anchor.time * BASE_HOUR_WIDTH * zoomLevel - anchor.cursorX;
  }, [zoomLevel]);

  const resetZoom = useCallback(() => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    anchorRef.current = null;
    const zoom = computeDefaultZoom();
    defaultZoomRef.current = zoom;
    zoomRef.current = zoom;
    setZoomLevel(zoom);
    requestAnimationFrame(() => scrollToHour(DEFAULT_START_HOUR, zoom));
  }, [computeDefaultZoom, scrollToHour]);

  return {
    scrollContainerRef,
    zoomLevel,
    effectiveHourWidth: getEffectiveHourWidth(zoomLevel),
    timelineWidth: getTimelineWidth(zoomLevel),
    resetZoom,
  };
}

'use client';

import { useRef, useCallback, useEffect, useState } from 'react';

export type DragMode = 'none' | 'move' | 'resize-left' | 'resize-right';

interface UseBlockDragOptions {
  left: number;
  width: number;
  effectiveHourWidth: number;
  enabled: boolean;
  onComplete: (newLeft: number, newWidth: number) => void;
  onDragUpdate?: (left: number, width: number) => void;
  onDragEnd?: () => void;
}

function snapToGrid(px: number, hourWidth: number): number {
  const snapMinutes = hourWidth >= 200 ? 15 : 30;
  const snapPx = (snapMinutes / 60) * hourWidth;
  return Math.round(px / snapPx) * snapPx;
}

export function useBlockDrag({
  left,
  width,
  effectiveHourWidth,
  enabled,
  onComplete,
  onDragUpdate,
  onDragEnd: onDragEndCb
}: UseBlockDragOptions) {
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [currentLeft, setCurrentLeft] = useState(left);
  const [currentWidth, setCurrentWidth] = useState(width);
  const [isHolding, setIsHolding] = useState(false);

  const dragModeRef = useRef<DragMode>('none');
  const startMouseXRef = useRef(0);
  const startLeftRef = useRef(0);
  const startWidthRef = useRef(0);
  const currentLeftRef = useRef(left);
  const currentWidthRef = useRef(width);
  const timelineWidth = 24 * effectiveHourWidth;
  const didDragRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onDragUpdateRef = useRef(onDragUpdate);
  onDragUpdateRef.current = onDragUpdate;
  const onDragEndCbRef = useRef(onDragEndCb);
  onDragEndCbRef.current = onDragEndCb;

  useEffect(() => {
    if (dragModeRef.current !== 'none') return;
    if (isHolding) {
      setIsHolding(false);
    }
    setCurrentLeft(left);
    setCurrentWidth(width);
    currentLeftRef.current = left;
    currentWidthRef.current = width;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, width]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      if (!enabled || mode === 'none') return;
      e.preventDefault();
      e.stopPropagation();

      dragModeRef.current = mode;
      startMouseXRef.current = e.clientX;
      startLeftRef.current = left;
      startWidthRef.current = width;
      currentLeftRef.current = left;
      currentWidthRef.current = width;
      didDragRef.current = false;

      setCurrentLeft(left);
      setCurrentWidth(width);
      setDragMode(mode);

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [enabled, left, width]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const mode = dragModeRef.current;
      if (mode === 'none') return;

      const dx = e.clientX - startMouseXRef.current;
      if (Math.abs(dx) > 3) didDragRef.current = true;

      let newLeft: number;
      let newWidth: number;

      if (mode === 'move') {
        const rawLeft = startLeftRef.current + dx;
        const snapped = snapToGrid(rawLeft, effectiveHourWidth);
        newLeft = Math.max(0, Math.min(snapped, timelineWidth - startWidthRef.current));
        newWidth = startWidthRef.current;
      } else if (mode === 'resize-left') {
        const rawLeft = startLeftRef.current + dx;
        const snapped = snapToGrid(rawLeft, effectiveHourWidth);
        const clamped = Math.max(0, Math.min(snapped, startLeftRef.current + startWidthRef.current - 10));
        newLeft = clamped;
        newWidth = Math.max(startWidthRef.current + (startLeftRef.current - clamped), 10);
      } else {
        const rawWidth = startWidthRef.current + dx;
        const snapped = snapToGrid(startLeftRef.current + rawWidth, effectiveHourWidth) - startLeftRef.current;
        newLeft = startLeftRef.current;
        newWidth = Math.max(10, Math.min(snapped, timelineWidth - startLeftRef.current));
      }

      currentLeftRef.current = newLeft;
      currentWidthRef.current = newWidth;
      setCurrentLeft(newLeft);
      setCurrentWidth(newWidth);
      onDragUpdateRef.current?.(newLeft, newWidth);
    },
    [effectiveHourWidth, timelineWidth]
  );

  const handlePointerUp = useCallback(() => {
    const mode = dragModeRef.current;
    if (mode === 'none') return;

    dragModeRef.current = 'none';
    setDragMode('none');
    onDragEndCbRef.current?.();

    if (!didDragRef.current) return;

    const finalLeft = currentLeftRef.current;
    const finalWidth = currentWidthRef.current;

    if (finalLeft !== left || finalWidth !== width) {
      setIsHolding(true);
      queueMicrotask(() => onCompleteRef.current(finalLeft, finalWidth));
      setTimeout(() => setIsHolding(false), 5000);
    }

    // Reset after the click event that follows pointerup has been handled
    setTimeout(() => { didDragRef.current = false; }, 0);
  }, [left, width]);

  const showCommitted = dragMode !== 'none' || isHolding;

  return {
    dragMode,
    currentLeft: showCommitted ? currentLeft : left,
    currentWidth: showCommitted ? currentWidth : width,
    isDragging: dragMode !== 'none',
    didDrag: didDragRef,
    handlers: {
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
    },
    startMove: (e: React.PointerEvent) => handlePointerDown(e, 'move'),
    startResizeLeft: (e: React.PointerEvent) => handlePointerDown(e, 'resize-left'),
    startResizeRight: (e: React.PointerEvent) => handlePointerDown(e, 'resize-right'),
  };
}

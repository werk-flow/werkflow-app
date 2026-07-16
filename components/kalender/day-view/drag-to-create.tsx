'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { getVisibleGridIntervalMinutes } from './timeline-grid';

interface DragToCreateProps {
  effectiveHourWidth: number;
  timelineWidth: number;
  memberId: string;
  onCreateEntry: (memberId: string, startTime: string, endTime: string) => void;
  disabled?: boolean;
  canCreate?: boolean;
}

function pixelToTime(px: number, hourWidth: number): { hours: number; minutes: number } {
  const totalMinutes = Math.round((px / hourWidth) * 60);
  const clamped = Math.max(0, Math.min(totalMinutes, 24 * 60));
  return { hours: Math.floor(clamped / 60), minutes: clamped % 60 };
}

function snapToGrid(px: number, hourWidth: number): number {
  let snapMinutes: number;
  if (hourWidth >= 200) snapMinutes = 15;
  else if (hourWidth >= 120) snapMinutes = 15;
  else snapMinutes = 30;

  const snapPx = (snapMinutes / 60) * hourWidth;
  return Math.round(px / snapPx) * snapPx;
}

function formatTimeHHMM(hours: number, minutes: number): string {
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export function DragToCreateOverlay({
  effectiveHourWidth,
  timelineWidth,
  memberId,
  onCreateEntry,
  disabled = false,
  canCreate = true
}: DragToCreateProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
  const [dragEnd, setDragEnd] = useState(0);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef(0);
  const dragEndRef = useRef(0);
  const isCoarsePointer = useRef(false);

  useEffect(() => {
    isCoarsePointer.current = window.matchMedia('(pointer: coarse)').matches;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled || !canCreate || isCoarsePointer.current) return;
    if (e.button !== 0) return;
    if (e.detail > 1) return;

    const rect = overlayRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const snapped = snapToGrid(x, effectiveHourWidth);

    dragStartRef.current = snapped;
    dragEndRef.current = snapped;
    isDraggingRef.current = true;
    setDragStart(snapped);
    setDragEnd(snapped);
    setIsDragging(true);
    e.preventDefault();
  }, [disabled, canCreate, effectiveHourWidth]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const rect = overlayRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, timelineWidth));
    const snapped = snapToGrid(x, effectiveHourWidth);
    dragEndRef.current = snapped;
    setDragEnd(snapped);
  }, [isDragging, timelineWidth, effectiveHourWidth]);

  const finishDrag = useCallback((clientX?: number) => {
    if (!isDraggingRef.current) return;

    let finalDragEnd = dragEndRef.current;
    const overlay = overlayRef.current;
    if (clientX !== undefined && overlay) {
      const rect = overlay.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, timelineWidth));
      finalDragEnd = snapToGrid(x, effectiveHourWidth);
      dragEndRef.current = finalDragEnd;
      setDragEnd(finalDragEnd);
    }

    isDraggingRef.current = false;
    setIsDragging(false);

    const left = Math.min(dragStartRef.current, finalDragEnd);
    const right = Math.max(dragStartRef.current, finalDragEnd);
    const minDragPx = (15 / 60) * effectiveHourWidth;

    if (right - left + 0.5 < minDragPx) return;

    const start = pixelToTime(left, effectiveHourWidth);
    const end = pixelToTime(right, effectiveHourWidth);

    onCreateEntry(
      memberId,
      formatTimeHHMM(start.hours, start.minutes),
      formatTimeHHMM(end.hours, end.minutes)
    );
  }, [
    effectiveHourWidth,
    memberId,
    onCreateEntry,
    timelineWidth
  ]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    finishDrag(e.clientX);
  }, [finishDrag]);

  // Handle tap-to-create on mobile
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (disabled || !canCreate || !isCoarsePointer.current) return;

    const rect = overlayRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const hourStart = Math.floor(x / effectiveHourWidth);
    const left = hourStart * effectiveHourWidth;
    const right = left + effectiveHourWidth;

    const start = pixelToTime(left, effectiveHourWidth);
    const end = pixelToTime(right, effectiveHourWidth);

    onCreateEntry(
      memberId,
      formatTimeHHMM(start.hours, start.minutes),
      formatTimeHHMM(end.hours, end.minutes)
    );
  }, [disabled, canCreate, effectiveHourWidth, memberId, onCreateEntry]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (disabled || !canCreate || isCoarsePointer.current) return;
    if (e.button !== 0) return;

    const rect = overlayRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, timelineWidth));
    const intervalMinutes = getVisibleGridIntervalMinutes(effectiveHourWidth);
    const cellWidth = (intervalMinutes / 60) * effectiveHourWidth;
    const left = Math.min(
      timelineWidth - cellWidth,
      Math.floor(x / cellWidth) * cellWidth
    );
    const right = left + cellWidth;

    const start = pixelToTime(left, effectiveHourWidth);
    const end = pixelToTime(right, effectiveHourWidth);

    e.preventDefault();
    onCreateEntry(
      memberId,
      formatTimeHHMM(start.hours, start.minutes),
      formatTimeHHMM(end.hours, end.minutes)
    );
  }, [
    disabled,
    canCreate,
    effectiveHourWidth,
    timelineWidth,
    memberId,
    onCreateEntry
  ]);

  // Finish from the release position even when the pointer leaves the row.
  useEffect(() => {
    if (!isDragging) return;
    const handleGlobalUp = (event: MouseEvent) => {
      finishDrag(event.clientX);
    };
    const handleWindowBlur = () => {
      finishDrag();
    };
    window.addEventListener('mouseup', handleGlobalUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [finishDrag, isDragging]);

  const selectionLeft = Math.min(dragStart, dragEnd);
  const selectionWidth = Math.abs(dragEnd - dragStart);
  const selectionStart = pixelToTime(selectionLeft, effectiveHourWidth);
  const selectionEnd = pixelToTime(selectionLeft + selectionWidth, effectiveHourWidth);

  return (
    <div
      ref={overlayRef}
      className={cn(
        'absolute inset-0 z-[5]',
        !canCreate ? 'cursor-not-allowed' : 'cursor-crosshair'
      )}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {isDragging && selectionWidth > 0 && (
        <div
          className="absolute top-1 bottom-1 rounded-md bg-yellow-400/40 border-2 border-dashed border-yellow-500/60 pointer-events-none flex items-center justify-center"
          style={{ left: selectionLeft, width: selectionWidth }}
        >
          <span className="text-[11px] font-medium text-yellow-800 dark:text-yellow-200 whitespace-nowrap px-1 bg-yellow-400/60 rounded">
            {formatTimeHHMM(selectionStart.hours, selectionStart.minutes)} – {formatTimeHHMM(selectionEnd.hours, selectionEnd.minutes)}
          </span>
        </div>
      )}
    </div>
  );
}

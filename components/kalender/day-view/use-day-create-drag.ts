'use client';

import { useCallback, useRef } from 'react';
import { MIN_ITEM_MINUTES } from '@/lib/calendar/day-layout';
import { formatMinutesOfDay, snapMinutes } from '@/lib/calendar/drag-math';
import type { CalendarSurfaceActions } from '../board/types';

type CreateSweep = {
  /** The row's login; null presets nobody (the „Ohne Zuweisung" row or a record without a login). */
  userId: string | null;
  startMinutes: number;
  endMinutes: number;
  overlay: HTMLElement;
  pointerId: number;
};

/** A press on empty time opens a sweep; a press on a card, a block or a button stays theirs. */
function pressedSweep(
  event: React.PointerEvent<HTMLDivElement>,
  userId: string | null,
  hourWidth: number,
): CreateSweep | null {
  if (
    event.target instanceof Element &&
    event.target.closest('[data-calendar-card], [data-time-block], button')
  )
    return null;
  const timeline = event.currentTarget;
  const overlay = timeline.querySelector<HTMLElement>('[data-day-create-overlay]');
  if (!overlay) return null;
  const rect = timeline.getBoundingClientRect();
  const minutes = snapMinutes(((event.clientX - rect.left) / hourWidth) * 60, 15);
  return { userId, startMinutes: minutes, endMinutes: minutes, overlay, pointerId: event.pointerId };
}

/** Follows the pointer: the sweep's end and the overlay, written straight to the DOM. */
function trackSweep(create: CreateSweep, event: React.PointerEvent<HTMLDivElement>, hourWidth: number): void {
  const rect = event.currentTarget.getBoundingClientRect();
  create.endMinutes = Math.max(
    0,
    Math.min(24 * 60, snapMinutes(((event.clientX - rect.left) / hourWidth) * 60, event.shiftKey ? 5 : 15)),
  );
  const start = Math.min(create.startMinutes, create.endMinutes);
  const end = Math.max(create.startMinutes, create.endMinutes);
  create.overlay.style.left = `${(start / 60) * hourWidth}px`;
  create.overlay.style.width = `${((end - start) / 60) * hourWidth}px`;
  create.overlay.textContent = end > start ? `${formatMinutesOfDay(start)}–${formatMinutesOfDay(end)}` : '';
}

/**
 * Drag-to-create on empty time: DOM-only tracking on the timeline's overlay,
 * so a sweep renders nothing; the entry dialog opens on release when the
 * sweep covers at least the minimum item length.
 */
export function useDayCreateDrag({
  canCreate,
  hourWidth,
  dateIso,
  actions,
}: {
  canCreate: boolean;
  hourWidth: number;
  dateIso: string;
  actions: CalendarSurfaceActions;
}) {
  const createRef = useRef<CreateSweep | null>(null);
  const handleCreatePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, userId: string | null) => {
      if (!canCreate || event.button !== 0 || event.pointerType === 'touch') return;
      const create = pressedSweep(event, userId, hourWidth);
      if (!create) return;
      createRef.current = create;
      event.currentTarget.setPointerCapture(event.pointerId);
      create.overlay.hidden = false;
      create.overlay.style.left = `${(create.startMinutes / 60) * hourWidth}px`;
      create.overlay.style.width = '0px';
      event.preventDefault();
    },
    [canCreate, hourWidth],
  );
  const handleCreatePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const create = createRef.current;
      if (!create || event.pointerId !== create.pointerId) return;
      trackSweep(create, event, hourWidth);
    },
    [hourWidth],
  );
  const handleCreatePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const create = createRef.current;
      if (!create || event.pointerId !== create.pointerId) return;
      createRef.current = null;
      create.overlay.hidden = true;
      event.currentTarget.releasePointerCapture(event.pointerId);
      const start = Math.min(create.startMinutes, create.endMinutes);
      const end = Math.max(create.startMinutes, create.endMinutes);
      if (end - start < MIN_ITEM_MINUTES) return;
      actions.onAddEntry({
        date: dateIso,
        time: formatMinutesOfDay(start),
        endTime: formatMinutesOfDay(end),
        userId: create.userId ?? undefined,
      });
    },
    [actions, dateIso],
  );
  // A cancelled pointer (a touch scroll or a system gesture) drops the sweep without opening the dialog.
  const handleCreatePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const create = createRef.current;
    if (!create || event.pointerId !== create.pointerId) return;
    createRef.current = null;
    create.overlay.hidden = true;
  }, []);
  return {
    handleCreatePointerDown,
    handleCreatePointerMove,
    handleCreatePointerUp,
    handleCreatePointerCancel,
  };
}

'use client';

import { useCallback, useRef } from 'react';
import { MIN_ITEM_MINUTES } from '@/lib/calendar/day-layout';
import { formatMinutesOfDay, snapMinutes } from '@/lib/calendar/drag-math';
import { UNASSIGNED_USER, type CalendarSurfaceActions } from '../board/types';

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
  const createRef = useRef<{
    userId: string;
    startMinutes: number;
    endMinutes: number;
    overlay: HTMLElement;
    pointerId: number;
  } | null>(null);
  const handleCreatePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, userId: string) => {
      if (!canCreate || event.button !== 0 || event.pointerType === 'touch') return;
      if ((event.target as HTMLElement).closest('[data-calendar-card], [data-time-block], button')) return;
      const timeline = event.currentTarget;
      const overlay = timeline.querySelector<HTMLElement>('[data-day-create-overlay]');
      if (!overlay) return;
      const rect = timeline.getBoundingClientRect();
      const minutes = snapMinutes(((event.clientX - rect.left) / hourWidth) * 60, 15);
      createRef.current = {
        userId,
        startMinutes: minutes,
        endMinutes: minutes,
        overlay,
        pointerId: event.pointerId,
      };
      timeline.setPointerCapture(event.pointerId);
      overlay.hidden = false;
      overlay.style.left = `${(minutes / 60) * hourWidth}px`;
      overlay.style.width = '0px';
      event.preventDefault();
    },
    [canCreate, hourWidth],
  );
  const handleCreatePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const create = createRef.current;
      if (!create || event.pointerId !== create.pointerId) return;
      const rect = event.currentTarget.getBoundingClientRect();
      create.endMinutes = Math.max(
        0,
        Math.min(
          24 * 60,
          snapMinutes(((event.clientX - rect.left) / hourWidth) * 60, event.shiftKey ? 5 : 15),
        ),
      );
      const start = Math.min(create.startMinutes, create.endMinutes);
      const end = Math.max(create.startMinutes, create.endMinutes);
      create.overlay.style.left = `${(start / 60) * hourWidth}px`;
      create.overlay.style.width = `${((end - start) / 60) * hourWidth}px`;
      create.overlay.textContent =
        end > start ? `${formatMinutesOfDay(start)}–${formatMinutesOfDay(end)}` : '';
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
        userId: create.userId === UNASSIGNED_USER ? undefined : create.userId,
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

'use client';

import { memo } from 'react';
import { ArrowDown, ArrowUp, Clock, Coffee } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalendarWorkBlock } from '@/lib/time-tracking/calendar-blocks';
import { formatDuration } from '@/lib/time-tracking/helpers';
import type { EntryChangeRequestMap } from '@/lib/time-tracking/types';
import {  } from '@/lib/calendar/day-layout';
import { formatMinutesOfDay } from '@/lib/calendar/drag-math';

export type TimeBlockSegment = { id: string; type: 'work' | 'break'; startMinutes: number; endMinutes: number };

export type TimeBlockProps = {
  block: CalendarWorkBlock;
  segments: TimeBlockSegment[];
  startMinutes: number;
  endMinutes: number;
  hourWidth: number;
  laneTop: number;
  laneHeight: number;
  changeRequestMap: EntryChangeRequestMap;
  showName: string | null;
  canManage: boolean;
  onOpen: (block: CalendarWorkBlock) => void;
  onPointerDownMove: (event: React.PointerEvent<HTMLButtonElement>, block: CalendarWorkBlock) => void;
  onPointerDownEdge: (event: React.PointerEvent<HTMLSpanElement>, block: CalendarWorkBlock, edge: 'start' | 'end') => void;
};

/**
 * One recorded block on the hour axis (P1-24a, package C): work segments in
 * the actual tone, breaks quieter, pending entries hatched in the waiting
 * tone, an open block growing to now. Click opens the entry details; the
 * body drags, the 8px edges resize (24px hit area).
 */
export const TimeBlock = memo(function TimeBlock(props: TimeBlockProps) {
  const { block, segments, startMinutes, endMinutes, hourWidth, laneTop, laneHeight, changeRequestMap, showName, canManage, onOpen, onPointerDownMove, onPointerDownEdge } = props;
  const pending = block.isPending || block.sourceEntries.some((entry) => entry.status === 'pending' || entry.status === 'pending_delete');
  const pendingDelete = block.sourceEntries.some((entry) => entry.status === 'pending_delete');
  const hasRequest = block.sourceEntries.some((entry) => changeRequestMap[entry.id]);
  const width = Math.max(6, ((endMinutes - startMinutes) / 60) * hourWidth);
  const durationMinutes = segments.filter((segment) => segment.type === 'work').reduce((total, segment) => total + (segment.endMinutes - segment.startMinutes), 0);
  const breakMinutes = segments.filter((segment) => segment.type === 'break').reduce((total, segment) => total + (segment.endMinutes - segment.startMinutes), 0);
  const compact = width < 90;
  // The lane item is at least MIN_ITEM_MINUTES wide; the label names the recorded end.
  const recordedEndMinutes = segments.reduce((latest, segment) => Math.max(latest, segment.endMinutes), startMinutes);
  const label = `${showName ? `${showName}, ` : ''}Arbeitszeit ${formatMinutesOfDay(startMinutes)} bis ${block.isOpen ? 'jetzt' : formatMinutesOfDay(recordedEndMinutes)}, ${formatDuration(durationMinutes)}${breakMinutes > 0 ? `, Pause ${formatDuration(breakMinutes)}` : ''}${pendingDelete ? ', Löschung ausstehend' : pending ? ', Freigabe ausstehend' : ''}`;
  return (
    <button
      type="button"
      data-time-block={block.id}
      data-pending={pending || undefined}
      aria-label={label}
      title={label}
      className={cn(
        'group/block absolute flex items-center overflow-hidden rounded-md border text-left text-xs shadow-xs outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring',
        pending ? 'border-warning/60 bg-warning-soft text-warning-soft-foreground' : 'border-calendar-actual-border bg-calendar-actual text-calendar-actual-foreground',
        block.isOpen && 'border-dashed',
        canManage ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
      )}
      style={{ left: (startMinutes / 60) * hourWidth, width, top: laneTop + 3, height: laneHeight - 6 }}
      onClick={() => onOpen(block)}
      onPointerDown={(event) => { if (canManage) onPointerDownMove(event, block); }}
    >
      {segments.map((segment) => segment.type === 'break' && (
        <span
          key={segment.id}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 flex items-center justify-center bg-calendar-break text-calendar-break-foreground"
          style={{ left: ((segment.startMinutes - startMinutes) / 60) * hourWidth, width: Math.max(2, ((segment.endMinutes - segment.startMinutes) / 60) * hourWidth) }}
        >
          {((segment.endMinutes - segment.startMinutes) / 60) * hourWidth > 28 && <Coffee className="size-3 opacity-70" />}
        </span>
      ))}
      {pending && <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,var(--warning)_4px,var(--warning)_5px)] opacity-30" />}
      <span className="relative z-10 flex min-w-0 items-center gap-1 px-2">
        {pendingDelete ? <ArrowDown className="size-3 shrink-0" aria-hidden="true" /> : <Clock className="size-3 shrink-0 opacity-70" aria-hidden="true" />}
        {!compact && (
          <span className="truncate">
            <span className="font-medium tabular-nums">{formatMinutesOfDay(startMinutes)}–{block.isOpen ? 'jetzt' : formatMinutesOfDay(recordedEndMinutes)}</span>
            <span className="ml-1 opacity-80">{pendingDelete ? 'Löschen' : formatDuration(durationMinutes)}</span>
            {hasRequest && <ArrowUp className="ml-1 inline size-3 opacity-70" aria-hidden="true" />}
          </span>
        )}
      </span>
      {canManage && (
        <>
          <span role="presentation" className="absolute inset-y-0 -left-2 w-6 cursor-ew-resize" onPointerDown={(event) => { event.stopPropagation(); onPointerDownEdge(event, block, 'start'); }}>
            <span className="absolute inset-y-0 left-2 w-2 opacity-0 transition-opacity group-hover/block:opacity-100 group-focus-visible/block:opacity-100 bg-calendar-actual-border" />
          </span>
          {!block.isOpen && (
            <span role="presentation" className="absolute inset-y-0 -right-2 w-6 cursor-ew-resize" onPointerDown={(event) => { event.stopPropagation(); onPointerDownEdge(event, block, 'end'); }}>
              <span className="absolute inset-y-0 right-2 w-2 opacity-0 transition-opacity group-hover/block:opacity-100 group-focus-visible/block:opacity-100 bg-calendar-actual-border" />
            </span>
          )}
        </>
      )}
    </button>
  );
});

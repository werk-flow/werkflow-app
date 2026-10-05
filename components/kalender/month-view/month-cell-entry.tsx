'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isStartedOccurrence } from '@/lib/calendar/board';
import { formatMinutesOfDay } from '@/lib/calendar/drag-math';
import type { MonthCellItem } from '@/lib/calendar/month-cell-items';
import { createSessionFromCalendarBlock } from '@/lib/time-tracking/calendar-blocks';
import { formatDuration } from '@/lib/time-tracking/helpers';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { InteractiveCalendarSession } from '@/lib/time-tracking/types';
import type { CalendarSurfaceActions } from '../board/types';
import type { DragSession } from '../drag-engine/drag-engine';
import { CalendarCard } from '../surface/calendar-card';
import { useClock } from '../surface/use-now-tick';

type MonthCellEntryProps = {
  item: MonthCellItem;
  /** The popover's full list uses taller rows than the cell. */
  full: boolean;
  draggable: boolean;
  isAdminOrManager: boolean;
  nowTick: number;
  organizationSettings: OrganizationTimeTrackingSettings;
  actions: CalendarSurfaceActions;
  startDrag: (event: React.PointerEvent, session: DragSession) => void;
  onSessionClick: (session: InteractiveCalendarSession) => void;
};

/** One line in a month day cell: a visit card or a recorded work block, each a drag source for managers. */
export function MonthCellEntry(props: MonthCellEntryProps): React.JSX.Element {
  const {
    item,
    full,
    draggable,
    isAdminOrManager,
    nowTick,
    organizationSettings,
    actions,
    startDrag,
    onSessionClick,
  } = props;
  const clock = useClock();
  if (item.kind === 'job') {
    const { job } = item;
    const sourceUserId = job.assignedUserIds[0] ?? null;
    return (
      <CalendarCard
        job={job}
        size="month"
        draggable={draggable}
        locked={isStartedOccurrence(job, nowTick)}
        className={cn('w-full', full ? 'h-7' : 'h-6')}
        onOpen={(element) => actions.onOpenCard(job, element, null)}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          startDrag(event, {
            payload: {
              kind: 'occurrence',
              job,
              sourceEmployeeRecordId: job.assignedEmployeeRecordIds?.[0] ?? null,
              sourceUserId,
              sourceDate: job.plannedDate ?? '',
            },
            ghost: {
              label: job.title,
              secondary: job.plannedTime ?? undefined,
              width: Math.min(rect.width, 200),
              height: rect.height,
            },
            pointerOffset: { x: Math.min(event.clientX - rect.left, 200), y: event.clientY - rect.top },
          });
        }}
      />
    );
  }
  const pending =
    item.block.isPending ||
    item.block.sourceEntries.some((entry) => entry.status === 'pending' || entry.status === 'pending_delete');
  const label = `${isAdminOrManager ? `${item.name} ` : 'Arbeitszeit '}${formatMinutesOfDay(item.startMinutes)}–${item.block.isOpen ? 'jetzt' : formatMinutesOfDay(item.endMinutes)}`;
  return (
    <PlainButton
      type="button"
      data-time-block={item.block.id}
      className={cn(
        'flex h-6 w-full min-w-0 items-center gap-1 rounded-md border px-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        pending
          ? 'border-warning/60 bg-warning-soft text-warning-soft-foreground'
          : 'border-calendar-actual-border bg-calendar-actual text-calendar-actual-foreground',
        draggable && !item.block.isOpen && 'cursor-grab active:cursor-grabbing',
      )}
      aria-label={`${label}, ${formatDuration(item.endMinutes - item.startMinutes)}`}
      onClick={() =>
        onSessionClick(createSessionFromCalendarBlock(item.block, new Date(clock()), organizationSettings))
      }
      onPointerDown={(event) => {
        if (!draggable || item.block.isOpen) return;
        const rect = event.currentTarget.getBoundingClientRect();
        startDrag(event, {
          payload: {
            kind: 'timeBlock',
            session: createSessionFromCalendarBlock(item.block, new Date(clock()), organizationSettings),
            sourceUserId: item.userId,
            sourceDate: item.dateIso,
            durationMinutes: item.endMinutes - item.startMinutes,
          },
          ghost: { label, width: Math.min(rect.width, 200), height: rect.height },
          pointerOffset: { x: Math.min(event.clientX - rect.left, 200), y: event.clientY - rect.top },
        });
      }}
    >
      <Clock className="size-3 shrink-0 opacity-70" aria-hidden="true" />
      <span className="truncate tabular-nums">
        {label} · {formatDuration(item.endMinutes - item.startMinutes)}
      </span>
    </PlainButton>
  );
}

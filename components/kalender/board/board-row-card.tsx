'use client';

import { memo } from 'react';
import { isNoteEntry, type CalendarBoardRow, type CalendarDispatchState } from '@/lib/calendar/board';
import type { CalendarJob } from '@/lib/jobs/types';
import type { DragSession } from '../drag-engine/drag-engine';
import { CalendarCard, dispatchChip, readinessChips } from '../surface/calendar-card';
import type { CalendarSurfaceActions } from './types';

type BoardRowCardProps = {
  job: CalendarJob;
  /** The lane item's first visible date: the drag source date. */
  startDate: string;
  /** The lane packer's placement: first column, column count and lane. */
  column: number;
  span: number;
  lane: number;
  row: CalendarBoardRow | null;
  dispatchState: CalendarDispatchState;
  /** The job has open material demand. */
  materialDemand: boolean;
  compact: boolean;
  /** A started or past occurrence is history (P1-11): no drag source, no edge handles. */
  locked: boolean;
  actions: CalendarSurfaceActions;
  startDrag: (event: React.PointerEvent, session: DragSession) => void;
  /** This card's occurrence is hovered, here or in another row. */
  hovered: boolean;
  onHoverLink: (occurrenceId: string | null) => void;
};

/** The grid placement of a lane item: its first column after the name column, its column count and its lane. */
export function boardLaneStyle({ column, span, lane }: { column: number; span: number; lane: number }) {
  return { gridColumn: `${column + 2} / span ${span}`, gridRow: lane + 1 } as const;
}

/**
 * One occurrence in a Plantafel row: the card with its dispatch and
 * readiness chips, the drag source, and the edge handles of an all-day bar.
 * Memoized on its shown props, so a row renders again only its changed cards.
 */
export const BoardRowCard = memo(function BoardRowCard(props: BoardRowCardProps): React.JSX.Element {
  const {
    job,
    startDate,
    row,
    dispatchState,
    materialDemand,
    compact,
    locked,
    actions,
    startDrag,
    hovered,
    onHoverLink,
  } = props;
  const note = isNoteEntry(job);
  const chips =
    note || job.entryKind === 'internal'
      ? []
      : [dispatchChip(dispatchState), ...readinessChips(materialDemand)];
  const linked = hovered && (job.assignedEmployeeRecordIds?.length ?? 0) > 1;
  const draggable = actions.isManager && !locked;
  const allDay = !job.plannedTime;
  return (
    <div data-board-item-date={startDate} className="relative min-w-0 p-0.5" style={boardLaneStyle(props)}>
      <CalendarCard
        job={job}
        size="board"
        compact={compact}
        chips={chips}
        linked={linked}
        draggable={draggable}
        locked={locked}
        className="h-full w-full"
        {...(row ? { 'data-employee-record-id': row.employeeRecordId } : {})}
        onHoverLink={onHoverLink}
        onOpen={(element) => actions.onOpenCard(job, element, row)}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          startDrag(event, {
            payload: {
              kind: 'occurrence',
              job,
              sourceEmployeeRecordId: row?.employeeRecordId ?? null,
              sourceUserId: row?.userId ?? null,
              sourceDate: startDate,
            },
            ghost: {
              label: job.title,
              secondary: job.plannedTime
                ? `${job.plannedTime} · ${job.clientName ?? ''}`.trim()
                : (job.clientName ?? undefined),
              width: Math.min(rect.width, 240),
              height: rect.height,
            },
            pointerOffset: { x: Math.min(event.clientX - rect.left, 240), y: event.clientY - rect.top },
          });
        }}
      >
        {draggable && allDay && job.occurrenceId && (
          <>
            <span
              role="presentation"
              className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-calendar-planning-strong/30"
              onPointerDown={(event) => {
                event.stopPropagation();
                startDrag(event, {
                  payload: {
                    kind: 'barEdge',
                    job,
                    edge: 'start',
                    sourceEmployeeRecordId: row?.employeeRecordId ?? null,
                  },
                  ghost: { label: 'Beginn ändern', width: 120, height: 24 },
                  pointerOffset: { x: 60, y: 12 },
                });
              }}
            />
            <span
              role="presentation"
              className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-calendar-planning-strong/30"
              onPointerDown={(event) => {
                event.stopPropagation();
                startDrag(event, {
                  payload: {
                    kind: 'barEdge',
                    job,
                    edge: 'end',
                    sourceEmployeeRecordId: row?.employeeRecordId ?? null,
                  },
                  ghost: { label: 'Ende ändern', width: 120, height: 24 },
                  pointerOffset: { x: 60, y: 12 },
                });
              }}
            />
          </>
        )}
      </CalendarCard>
    </div>
  );
});

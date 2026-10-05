'use client';

import {
  dispatchStateFor,
  isNoteEntry,
  isStartedOccurrence,
  type CalendarBoardRow,
} from '@/lib/calendar/board';
import type { DispatchRecipientDerivedState } from '@/lib/dispatch/types';
import type { CalendarJob } from '@/lib/jobs/types';
import type { DragSession } from '../drag-engine/drag-engine';
import { CalendarCard, dispatchChip, readinessChips } from '../surface/calendar-card';
import type { CalendarSurfaceActions } from './types';

type BoardRowCardProps = {
  job: CalendarJob;
  /** The lane item's first visible date: the drag source date. */
  startDate: string;
  style: React.CSSProperties;
  row: CalendarBoardRow | null;
  dispatch: ReadonlyMap<string, DispatchRecipientDerivedState>;
  materialDemandJobIds: ReadonlySet<string>;
  compact: boolean;
  nowMs: number;
  actions: CalendarSurfaceActions;
  startDrag: (event: React.PointerEvent, session: DragSession) => void;
  hoveredOccurrenceId: string | null;
  onHoverLink: (occurrenceId: string | null) => void;
};

/**
 * One occurrence in a Plantafel row: the card with its dispatch and
 * readiness chips, the drag source, and the edge handles of an all-day bar.
 */
export function BoardRowCard(props: BoardRowCardProps): React.JSX.Element {
  const {
    job,
    startDate,
    style,
    row,
    dispatch,
    materialDemandJobIds,
    compact,
    nowMs,
    actions,
    startDrag,
    hoveredOccurrenceId,
    onHoverLink,
  } = props;
  const state = dispatchStateFor(dispatch, job.occurrenceId, row?.employeeRecordId ?? null);
  const note = isNoteEntry(job);
  const chips =
    note || job.entryKind === 'internal'
      ? []
      : [dispatchChip(state), ...readinessChips(materialDemandJobIds.has(job.jobId ?? ''))];
  const linked =
    hoveredOccurrenceId !== null &&
    hoveredOccurrenceId === job.occurrenceId &&
    (job.assignedEmployeeRecordIds?.length ?? 0) > 1;
  // A started or past occurrence is history (P1-11): no drag source, no edge handles.
  const locked = isStartedOccurrence(job, nowMs);
  const draggable = actions.isManager && !locked;
  const allDay = !job.plannedTime;
  return (
    <div data-board-item-date={startDate} className="relative min-w-0 p-0.5" style={style}>
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
}

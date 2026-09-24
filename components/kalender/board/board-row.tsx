'use client';

import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { boardDayKey, dispatchStateFor, type CalendarBoardDay } from '@/lib/calendar/board';
import { packLanes, type BoardColumn, type BoardSpanItem } from '@/lib/calendar/board-layout';
import { absenceItems, occurrenceSpan, type BoardRowModel } from '@/lib/calendar/board-model';
import type { CalendarJob } from '@/lib/jobs/types';
import type { SicknessCalendarEntry } from '@/lib/sickness/actions';
import type { VacationCalendarEntry } from '@/lib/vacation/actions';
import type { DispatchRecipientDerivedState } from '@/lib/dispatch/types';
import { getRoleLabel } from '@/lib/roles';
import { BarSegment } from '../surface/bar-segment';
import { isNoteEntry } from '@/lib/calendar/board';
import { CalendarCard, dispatchChip, readinessChips } from '../surface/calendar-card';
import { CALENDAR_LAYER_CLASS } from '../surface/layers';
import type { DragSession } from '../drag-engine/drag-engine';
import { BoardCell } from './board-cell';
import { BOARD_COLUMN_MIN_PX, BOARD_LANE_HEIGHT, BOARD_NAME_COLUMN_PX, type CalendarSurfaceActions } from './types';

type LaneEntry = BoardSpanItem & ({ kind: 'job'; job: CalendarJob } | { kind: 'absence'; label: string; pending: boolean; absenceKind: 'vacation' | 'sickness' });

export type BoardRowProps = {
  model: BoardRowModel;
  rowIndex: number;
  columns: BoardColumn[];
  jobs: CalendarJob[];
  vacation: readonly VacationCalendarEntry[];
  sickness: readonly SicknessCalendarEntry[];
  days: ReadonlyMap<string, CalendarBoardDay>;
  planned: ReadonlyMap<string, number>;
  actual: ReadonlyMap<string, { minutes: number; pending: boolean }> | null;
  dispatch: ReadonlyMap<string, DispatchRecipientDerivedState>;
  materialDemandJobIds: ReadonlySet<string>;
  compact: boolean;
  scrollable: boolean;
  actions: CalendarSurfaceActions;
  startDrag: (event: React.PointerEvent, session: DragSession) => void;
  hoveredOccurrenceId: string | null;
  onHoverLink: (occurrenceId: string | null) => void;
  isolate: (employeeRecordId: string) => void;
};

/**
 * One person (or the „Ohne Zuweisung" row) as one CSS grid: the name cell
 * sticky on the left, one background cell per column, and every card or bar
 * placed by the lane packer with a column span, so the row grows with its
 * content and a multi-day occurrence is one element.
 */
export const BoardRow = memo(function BoardRow(props: BoardRowProps) {
  const { model, rowIndex, columns, jobs, vacation, sickness, days, planned, actual, dispatch, materialDemandJobIds, compact, scrollable, actions, startDrag, hoveredOccurrenceId, onHoverLink, isolate } = props;
  const row = model.kind === 'person' ? model.row : null;
  const laneHeight = compact ? BOARD_LANE_HEIGHT.compact : BOARD_LANE_HEIGHT.comfortable;

  const { lanes, laneCount } = useMemo(() => {
    const items: LaneEntry[] = [];
    for (const job of jobs) {
      const span = occurrenceSpan(job);
      if (span) items.push({ ...span, kind: 'job', job });
    }
    if (row) {
      for (const absence of absenceItems({ vacation, sickness, employeeRecordId: row.employeeRecordId })) {
        items.push({ ...absence, kind: 'absence', label: absence.label, pending: absence.pending, absenceKind: absence.kind });
      }
    }
    return packLanes(items, columns);
  }, [columns, jobs, row, sickness, vacation]);

  const rowLabel = row ? row.displayName : 'Ohne Zuweisung';
  return (
    <div
      role="row"
      data-board-row={model.key}
      aria-label={rowLabel}
      className="grid"
      style={{
        gridTemplateColumns: `${BOARD_NAME_COLUMN_PX}px repeat(${columns.length}, minmax(${scrollable ? BOARD_COLUMN_MIN_PX : 0}px, 1fr))`,
        gridTemplateRows: `repeat(${Math.max(1, laneCount)}, minmax(${laneHeight}px, auto))`,
      }}
    >
      <div
        role="rowheader"
        className={cn('sticky left-0 flex min-w-0 flex-col justify-center border-b border-r border-calendar-grid-strong bg-calendar-gutter px-3 py-1', CALENDAR_LAYER_CLASS.sticky)}
        style={{ gridColumn: 1, gridRow: '1 / -1' }}
      >
        {row ? (
          <button
            type="button"
            className="min-w-0 truncate text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            title="Nur diese Zeile anzeigen"
            onClick={() => isolate(row.employeeRecordId)}
          >
            {row.displayName}
          </button>
        ) : (
          <span className="truncate text-sm font-medium">Ohne Zuweisung</span>
        )}
        {row && !compact && (
          <span className="truncate text-[11px] text-muted-foreground">
            {row.role ? getRoleLabel(row.role) : 'Ohne App-Zugang'}
          </span>
        )}
      </div>
      {columns.map((column, columnIndex) => {
        const key = row ? boardDayKey(row.employeeRecordId, column.date) : '';
        const employed = !row || ((!row.entryDate || column.date >= row.entryDate) && (!row.exitDate || column.date <= row.exitDate));
        return (
          <BoardCell
            key={column.date}
            column={column}
            columnIndex={columnIndex}
            rowIndex={rowIndex}
            row={row}
            day={row ? days.get(key) : undefined}
            plannedMinutes={row ? planned.get(key) ?? 0 : 0}
            actual={row?.userId && actual ? actual.get(`${row.userId}:${column.date}`) : undefined}
            compact={compact}
            actions={actions}
            employed={employed}
          />
        );
      })}
      {lanes.map(({ item, lane, column, span }) => {
        const style = { gridColumn: `${column + 2} / span ${span}`, gridRow: lane + 1 } as const;
        if (item.kind === 'absence') {
          return (
            <div key={item.key} className="min-w-0 p-0.5" style={style}>
              <BarSegment tone={item.pending ? 'absence-pending' : 'absence'} edge="single" label={item.label} startDate={item.startDate} className="h-full min-h-5" />
            </div>
          );
        }
        const { job } = item;
        const state = dispatchStateFor(dispatch, job.occurrenceId, row?.employeeRecordId ?? null);
        const note = isNoteEntry(job);
        const chips = note || job.entryKind === 'internal' ? [] : [dispatchChip(state), ...readinessChips(materialDemandJobIds.has(job.jobId ?? ''))];
        const linked = hoveredOccurrenceId !== null && hoveredOccurrenceId === job.occurrenceId && (job.assignedEmployeeRecordIds?.length ?? 0) > 1;
        // The engine refuses a locked drag and shows the reason, so the card stays a drag source in read-only mode.
        const draggable = actions.isManager;
        const allDay = !job.plannedTime;
        return (
          <div key={item.key} data-board-item-date={item.startDate} className="relative min-w-0 p-0.5" style={style}>
            <CalendarCard
              job={job}
              size="board"
              compact={compact}
              chips={chips}
              linked={linked}
              draggable={draggable}
              className="h-full w-full"
              {...(row ? { 'data-employee-record-id': row.employeeRecordId } : {})}
              onHoverLink={onHoverLink}
              onOpen={(element) => actions.onOpenCard(job, element, row)}
              onPointerDown={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                startDrag(event, {
                  payload: { kind: 'occurrence', job, sourceEmployeeRecordId: row?.employeeRecordId ?? null, sourceUserId: row?.userId ?? null, sourceDate: item.startDate },
                  ghost: { label: job.title, secondary: job.plannedTime ? `${job.plannedTime} · ${job.clientName ?? ''}`.trim() : job.clientName ?? undefined, width: Math.min(rect.width, 240), height: rect.height },
                  pointerOffset: { x: Math.min(event.clientX - rect.left, 240), y: event.clientY - rect.top },
                });
              }}
            >
              {draggable && allDay && job.occurrenceId && (
                <>
                  <span
                    role="presentation"
                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-calendar-planning-strong/30"
                    onPointerDown={(event) => { event.stopPropagation(); startDrag(event, { payload: { kind: 'barEdge', job, edge: 'start', sourceEmployeeRecordId: row?.employeeRecordId ?? null }, ghost: { label: 'Beginn ändern', width: 120, height: 24 }, pointerOffset: { x: 60, y: 12 } }); }}
                  />
                  <span
                    role="presentation"
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-calendar-planning-strong/30"
                    onPointerDown={(event) => { event.stopPropagation(); startDrag(event, { payload: { kind: 'barEdge', job, edge: 'end', sourceEmployeeRecordId: row?.employeeRecordId ?? null }, ghost: { label: 'Ende ändern', width: 120, height: 24 }, pointerOffset: { x: 60, y: 12 } }); }}
                  />
                </>
              )}
            </CalendarCard>
          </div>
        );
      })}
    </div>
  );
});

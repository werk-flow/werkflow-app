'use client';

import { isStartedOccurrence } from '@/lib/calendar/board';
import { DAY_MIN_ITEM_WIDTH } from '@/lib/calendar/day-layout';
import { canManageBlock } from '@/lib/calendar/day-row-status';
import type { DayRow, DayRowItem } from '@/lib/calendar/day-rows';
import { formatMinutesOfDay } from '@/lib/calendar/drag-math';
import { createSessionFromCalendarBlock } from '@/lib/time-tracking/calendar-blocks';
import type { InteractiveCalendarSession } from '@/lib/time-tracking/types';
import type { DragSession } from '../drag-engine/drag-engine';
import { useBoardAbsences } from '../board-absences-context';
import { CalendarCard, unavailableAssigneeWarnings } from '../surface/calendar-card';
import { useClock } from '../surface/use-now-tick';
import { TimeBlock } from './time-block';
import type { DayTimelineProps } from './day-timeline-row';

type DayLaneItemProps = DayTimelineProps & {
  row: DayRow;
  item: DayRowItem;
  laneTop: string;
  laneHeight: string;
};

/** The pointer offset of an edge drag: the time edge on the timeline, not the pointer's spot on the card. */
function resizePointerOffset(
  event: React.PointerEvent<HTMLElement>,
  minutes: number,
  hourWidth: number,
): { x: number; y: number } {
  const timeline = event.currentTarget.closest<HTMLElement>('[data-day-timeline]');
  if (!timeline) throw new Error('A calendar resize needs its timeline.');
  return { x: event.clientX - timeline.getBoundingClientRect().left - (minutes / 60) * hourWidth, y: 12 };
}

type BlockItem = Extract<DayRowItem, { kind: 'block' }>;
type JobItem = Extract<DayRowItem, { kind: 'job' }>;

/** The drag of a recorded block's body: a move of the whole block. */
function blockMoveSession(
  event: React.PointerEvent<HTMLButtonElement>,
  item: BlockItem,
  session: InteractiveCalendarSession,
  dateIso: string,
): DragSession {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    payload: {
      kind: 'timeBlock',
      session,
      sourceUserId: item.block.startEntry.userId,
      sourceDate: dateIso,
      durationMinutes: item.endMinutes - item.startMinutes,
    },
    ghost: {
      label: `Arbeitszeit ${formatMinutesOfDay(item.startMinutes)}–${formatMinutesOfDay(item.endMinutes)}`,
      width: Math.min(rect.width, 240),
      height: rect.height,
    },
    pointerOffset: {
      x: Math.min(event.clientX - rect.left, 240),
      y: event.clientY - rect.top,
    },
  };
}

/** The drag of a recorded block's edge: its start or end on the same row. */
function blockEdgeSession(
  event: React.PointerEvent<HTMLSpanElement>,
  {
    item,
    session,
    edge,
    rowKey,
    hourWidth,
  }: {
    item: BlockItem;
    session: InteractiveCalendarSession;
    edge: 'start' | 'end';
    rowKey: string;
    hourWidth: number;
  },
): DragSession {
  return {
    payload: {
      kind: 'resizeBlock',
      session,
      edge,
      sourceUserId: item.block.startEntry.userId,
      sourceRowKey: rowKey,
    },
    ghost: {
      label: edge === 'start' ? 'Beginn ändern' : 'Ende ändern',
      width: 120,
      height: 24,
    },
    pointerOffset: resizePointerOffset(
      event,
      edge === 'start' ? item.startMinutes : item.endMinutes,
      hourWidth,
    ),
  };
}

/** The drag of a visit's card: a move in time or to another person. */
function visitDragSession(
  event: React.PointerEvent<HTMLButtonElement>,
  { row, item, dateIso }: Pick<DayLaneItemProps, 'row' | 'dateIso'> & { item: JobItem },
): DragSession {
  const { model } = row;
  const { job } = item;
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    payload: {
      kind: 'occurrence',
      job,
      sourceEmployeeRecordId: model.row?.employeeRecordId ?? null,
      sourceUserId: model.userId,
      sourceDate: dateIso,
    },
    ghost: {
      label: job.title,
      secondary: `${formatMinutesOfDay(item.startMinutes)} · ${job.clientName ?? ''}`.trim(),
      width: Math.min(rect.width, 240),
      height: rect.height,
    },
    pointerOffset: {
      x: Math.min(event.clientX - rect.left, 240),
      y: event.clientY - rect.top,
    },
  };
}

const VISIT_EDGE_HANDLES = {
  start: {
    hitClassName: 'absolute inset-y-0 -left-2 w-6 cursor-ew-resize',
    markClassName:
      'absolute inset-y-0 left-2 w-2 bg-calendar-planning-strong opacity-0 transition-opacity group-hover/card:opacity-60',
    ghostLabel: 'Beginn ändern',
  },
  end: {
    hitClassName: 'absolute inset-y-0 -right-2 w-6 cursor-ew-resize',
    markClassName:
      'absolute inset-y-0 right-2 w-2 bg-calendar-planning-strong opacity-0 transition-opacity group-hover/card:opacity-60',
    ghostLabel: 'Ende ändern',
  },
} as const;

/** A movable visit's edge: its own drag, which changes the time instead of moving the card. */
function visitEdgeHandle(
  edge: keyof typeof VISIT_EDGE_HANDLES,
  {
    row,
    item,
    hourWidth,
    startDrag,
  }: Pick<DayLaneItemProps, 'row' | 'hourWidth' | 'startDrag'> & {
    item: JobItem;
  },
): React.JSX.Element {
  const { hitClassName, markClassName, ghostLabel } = VISIT_EDGE_HANDLES[edge];
  return (
    <span
      role="presentation"
      className={hitClassName}
      onPointerDown={(event) => {
        event.stopPropagation();
        startDrag(event, {
          payload: {
            kind: 'resizeJob',
            job: item.job,
            edge,
            sourceRowKey: row.model.key,
          },
          ghost: { label: ghostLabel, width: 120, height: 24 },
          pointerOffset: resizePointerOffset(
            event,
            edge === 'start' ? item.startMinutes : item.endMinutes,
            hourWidth,
          ),
        });
      }}
    >
      <span className={markClassName} />
    </span>
  );
}

/** One item in a person's lanes: a recorded block or a planned visit. */
export function DayLaneItem(props: DayLaneItemProps): React.JSX.Element {
  return props.item.kind === 'block' ? (
    <DayLaneBlock {...props} item={props.item} />
  ) : (
    <DayLaneJob {...props} item={props.item} />
  );
}

/** A recorded block: opens its session, moves and resizes as a correction proposal for those who may manage it. */
function DayLaneBlock({
  row,
  item,
  laneTop,
  laneHeight,
  dateIso,
  hourWidth,
  actions,
  startDrag,
  currentUserRole,
  currentUserId,
  changeRequestMap,
  onSessionClick,
  organizationSettings,
}: DayLaneItemProps & { item: BlockItem }): React.JSX.Element {
  const { model, role } = row;
  const manage = canManageBlock(item.block, role, { ...actions, currentUserRole, currentUserId });
  const clock = useClock();
  return (
    <TimeBlock
      block={item.block}
      segments={item.segments}
      startMinutes={item.startMinutes}
      endMinutes={item.endMinutes}
      hourWidth={hourWidth}
      laneTop={laneTop}
      laneHeight={laneHeight}
      changeRequestMap={changeRequestMap}
      showName={actions.isManager ? model.name : null}
      canManage={manage}
      onOpen={(block) =>
        onSessionClick(createSessionFromCalendarBlock(block, new Date(clock()), organizationSettings))
      }
      onPointerDownMove={(event, block) => {
        if (block.isOpen) return;
        const session = createSessionFromCalendarBlock(block, new Date(clock()), organizationSettings);
        startDrag(event, blockMoveSession(event, item, session, dateIso));
      }}
      onPointerDownEdge={(event, block, edge) => {
        const session = createSessionFromCalendarBlock(block, new Date(clock()), organizationSettings);
        startDrag(event, blockEdgeSession(event, { item, session, edge, rowKey: model.key, hourWidth }));
      }}
    />
  );
}

/** A planned visit: the card with its drag source and, when movable, the two edge handles. */
function DayLaneJob({
  row,
  item,
  laneTop,
  laneHeight,
  dateIso,
  hourWidth,
  draggable,
  nowTick,
  actions,
  startDrag,
}: DayLaneItemProps & { item: JobItem }): React.JSX.Element {
  const { model } = row;
  const { job } = item;
  const locked = isStartedOccurrence(job, nowTick);
  const { people } = useBoardAbsences();
  const warnings = unavailableAssigneeWarnings(job, people);
  const width = Math.max(DAY_MIN_ITEM_WIDTH, ((item.endMinutes - item.startMinutes) / 60) * hourWidth);
  return (
    <div
      className="absolute"
      style={{
        left: (item.startMinutes / 60) * hourWidth,
        width,
        top: laneTop,
        height: laneHeight,
      }}
    >
      <CalendarCard
        job={job}
        size="day"
        chips={warnings.chips}
        alert={warnings.alert}
        draggable={draggable}
        locked={locked}
        className="h-full w-full"
        {...(model.row ? { 'data-employee-record-id': model.row.employeeRecordId } : {})}
        onOpen={(element) => actions.onOpenCard(job, element, model.row)}
        onPointerDown={(event) => startDrag(event, visitDragSession(event, { row, item, dateIso }))}
      >
        {draggable && !locked && (
          <>
            {visitEdgeHandle('start', { row, item, hourWidth, startDrag })}
            {visitEdgeHandle('end', { row, item, hourWidth, startDrag })}
          </>
        )}
      </CalendarCard>
    </div>
  );
}

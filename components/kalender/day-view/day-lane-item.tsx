'use client';

import { isStartedOccurrence } from '@/lib/calendar/board';
import { DAY_MIN_ITEM_WIDTH } from '@/lib/calendar/day-layout';
import { canManageBlock } from '@/lib/calendar/day-row-status';
import { formatMinutesOfDay } from '@/lib/calendar/drag-math';
import { createSessionFromCalendarBlock } from '@/lib/time-tracking/calendar-blocks';
import { UNASSIGNED_USER } from '../board/types';
import { CalendarCard } from '../surface/calendar-card';
import { useClock } from '../surface/use-now-tick';
import { TimeBlock } from './time-block';
import type { DayTimelineProps } from './day-timeline-row';
import type { DayRow, DayRowItem } from './use-day-rows';

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
}: DayLaneItemProps & { item: Extract<DayRowItem, { kind: 'block' }> }): React.JSX.Element {
  const { model, role } = row;
  const manage = canManageBlock(item.block, currentUserRole, currentUserId, role);
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
        const rect = event.currentTarget.getBoundingClientRect();
        startDrag(event, {
          payload: {
            kind: 'timeBlock',
            session,
            sourceUserId: model.userId,
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
        });
      }}
      onPointerDownEdge={(event, block, edge) => {
        const session = createSessionFromCalendarBlock(block, new Date(clock()), organizationSettings);
        startDrag(event, {
          payload: { kind: 'resizeBlock', session, edge, sourceUserId: model.userId },
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
        });
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
}: DayLaneItemProps & { item: Extract<DayRowItem, { kind: 'job' }> }): React.JSX.Element {
  const { model } = row;
  const { job } = item;
  const locked = isStartedOccurrence(job, nowTick);
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
        draggable={draggable}
        locked={locked}
        className="h-full w-full"
        {...(model.row ? { 'data-employee-record-id': model.row.employeeRecordId } : {})}
        onOpen={(element) => actions.onOpenCard(job, element, model.row)}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          startDrag(event, {
            payload: {
              kind: 'occurrence',
              job,
              sourceEmployeeRecordId: model.row?.employeeRecordId ?? null,
              sourceUserId: model.userId === UNASSIGNED_USER ? null : model.userId,
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
          });
        }}
      >
        {draggable && !locked && (
          <>
            <span
              role="presentation"
              className="absolute inset-y-0 -left-2 w-6 cursor-ew-resize"
              onPointerDown={(event) => {
                event.stopPropagation();
                startDrag(event, {
                  payload: {
                    kind: 'resizeJob',
                    job,
                    edge: 'start',
                    sourceUserId: model.userId === UNASSIGNED_USER ? null : model.userId,
                  },
                  ghost: { label: 'Beginn ändern', width: 120, height: 24 },
                  pointerOffset: resizePointerOffset(event, item.startMinutes, hourWidth),
                });
              }}
            >
              <span className="absolute inset-y-0 left-2 w-2 bg-calendar-planning-strong opacity-0 transition-opacity group-hover/card:opacity-60" />
            </span>
            <span
              role="presentation"
              className="absolute inset-y-0 -right-2 w-6 cursor-ew-resize"
              onPointerDown={(event) => {
                event.stopPropagation();
                startDrag(event, {
                  payload: {
                    kind: 'resizeJob',
                    job,
                    edge: 'end',
                    sourceUserId: model.userId === UNASSIGNED_USER ? null : model.userId,
                  },
                  ghost: { label: 'Ende ändern', width: 120, height: 24 },
                  pointerOffset: resizePointerOffset(event, item.endMinutes, hourWidth),
                });
              }}
            >
              <span className="absolute inset-y-0 right-2 w-2 bg-calendar-planning-strong opacity-0 transition-opacity group-hover/card:opacity-60" />
            </span>
          </>
        )}
      </CalendarCard>
    </div>
  );
}

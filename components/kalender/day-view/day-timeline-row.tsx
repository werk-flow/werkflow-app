'use client';

import { Plus } from 'lucide-react';
import { PlainButton } from '@/components/ui/plain-button';
import { isStartedOccurrence } from '@/lib/calendar/board';
import { DAY_LANE_HEIGHT, DAY_NAME_COLUMN_PX, DAY_TRAY_HEIGHT, travelGaps } from '@/lib/calendar/day-layout';
import { dayRowLabel, isDayRowOff } from '@/lib/calendar/day-row-status';
import { formatRefusalDate } from '@/lib/calendar/messages';
import type { OrgRole } from '@/lib/members/actions';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { EntryChangeRequestMap, InteractiveCalendarSession } from '@/lib/time-tracking/types';
import { cn } from '@/lib/utils';
import { UNASSIGNED_USER, type CalendarSurfaceActions } from '../board/types';
import type { useCalendarDrag } from '../drag-engine/drag-engine';
import { CalendarCard } from '../surface/calendar-card';
import { CALENDAR_LAYER_CLASS } from '../surface/layers';
import { DayLaneItem } from './day-lane-item';
import type { useDayCreateDrag } from './use-day-create-drag';
import type { DayRow } from './use-day-rows';

/** What every row of the day timeline shares: the axis, the caller's rights and the gesture entry points. */
export type DayTimelineProps = {
  dateIso: string;
  hourWidth: number;
  timelineWidth: number;
  canCreate: boolean;
  draggable: boolean;
  nowTick: number;
  actions: CalendarSurfaceActions;
  startDrag: ReturnType<typeof useCalendarDrag>['startDrag'];
  createDrag: ReturnType<typeof useDayCreateDrag>;
  currentUserRole: OrgRole;
  currentUserId: string;
  changeRequestMap: EntryChangeRequestMap;
  onSessionClick: (session: InteractiveCalendarSession) => void;
  organizationSettings: OrganizationTimeTrackingSettings;
};

/**
 * One person's row against the hour axis: the sticky name with its plan
 * button and day note, the timeline with the create overlay, the untimed
 * tray, the travel gaps between visits and the items in their lanes.
 */
export function DayTimelineRow(
  props: DayTimelineProps & { row: DayRow; highlighted: boolean },
): React.JSX.Element {
  const { row, highlighted, dateIso, hourWidth, timelineWidth, canCreate, actions, createDrag } = props;
  const { model, boardDay, lanes, laneCount, untimed } = row;
  const trayHeight = untimed.length > 0 ? DAY_TRAY_HEIGHT : 0;
  const height = trayHeight + laneCount * DAY_LANE_HEIGHT;
  const off = isDayRowOff(boardDay);
  const label = dayRowLabel(boardDay);
  const gaps = travelGaps(lanes.filter(({ item }) => item.kind === 'job').map(({ item }) => item));
  return (
    <div
      role="row"
      data-day-row={model.userId}
      aria-label={model.name}
      className={cn('group/row flex flex-1', highlighted && 'animate-row-highlight')}
      style={{ minHeight: height, maxHeight: Math.max(height, DAY_LANE_HEIGHT * 3) }}
    >
      <div
        role="rowheader"
        className={cn(
          'sticky left-0 flex shrink-0 flex-col justify-center gap-0.5 border-b border-r border-calendar-grid-strong bg-calendar-gutter px-3 py-1',
          CALENDAR_LAYER_CLASS.sticky,
        )}
        style={{ width: DAY_NAME_COLUMN_PX }}
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate text-sm font-medium">{model.name}</span>
          {canCreate && model.userId !== UNASSIGNED_USER && (
            <PlainButton
              type="button"
              className="ml-auto rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100"
              aria-label={`Termin am ${formatRefusalDate(dateIso)} für ${model.name} planen`}
              onClick={() => actions.onAddEntry({ date: dateIso, userId: model.userId })}
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </PlainButton>
          )}
        </span>
        {label && <span className="truncate text-[11px] text-muted-foreground">{label}</span>}
      </div>
      <div
        role="gridcell"
        data-day-timeline=""
        aria-label={`${model.name}, ${formatRefusalDate(dateIso)}${label ? `: ${label}` : ''}`}
        className={cn(
          'calendar-hour-grid relative shrink-0 border-b border-calendar-grid',
          off ? 'bg-calendar-cell-off' : 'bg-background',
          canCreate && 'cursor-crosshair',
        )}
        style={
          {
            width: timelineWidth,
            '--calendar-hour-width': `${hourWidth}px`,
            '--calendar-subline-width': `${hourWidth / (hourWidth >= 220 ? 4 : 2)}px`,
          } as React.CSSProperties
        }
        onPointerDown={(event) => createDrag.handleCreatePointerDown(event, model.userId)}
        onPointerMove={createDrag.handleCreatePointerMove}
        onPointerUp={createDrag.handleCreatePointerUp}
        onPointerCancel={createDrag.handleCreatePointerCancel}
      >
        <div
          hidden
          data-day-create-overlay=""
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-1 bottom-1 rounded-md border border-dashed border-calendar-planning-strong bg-calendar-drop-valid px-1 text-[11px] tabular-nums text-calendar-planning-foreground',
            CALENDAR_LAYER_CLASS.overlay,
          )}
        />
        {untimed.length > 0 && <DayUntimedTray {...props} />}
        {gaps.map(
          (gap) =>
            ((gap.endMinutes - gap.startMinutes) / 60) * hourWidth > 36 && (
              <span
                key={gap.startMinutes}
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0.5 truncate text-center text-[10px] tabular-nums text-muted-foreground"
                style={{
                  left: (gap.startMinutes / 60) * hourWidth,
                  width: ((gap.endMinutes - gap.startMinutes) / 60) * hourWidth,
                }}
              >
                {gap.endMinutes - gap.startMinutes} min
              </span>
            ),
        )}
        {lanes.map(({ item, lane }) => (
          <DayLaneItem
            key={item.key}
            {...props}
            item={item}
            laneTop={`calc(${trayHeight}px + (100% - ${trayHeight}px) * ${lane / laneCount} + 3px)`}
            laneHeight={`calc((100% - ${trayHeight}px) / ${laneCount} - 6px)`}
          />
        ))}
      </div>
    </div>
  );
}

/** The visits without a time, as compact cards at the top of the row that drag onto the axis. */
function DayUntimedTray({
  row,
  dateIso,
  draggable,
  nowTick,
  actions,
  startDrag,
}: DayTimelineProps & { row: DayRow }): React.JSX.Element {
  const { model, untimed } = row;
  return (
    // The tray sticks beside the sticky name column, not under it: the day
    // opens scrolled to the working hours, and at left 0 the name column
    // covered all but the last letters of an all-day visit.
    <div
      className="sticky flex h-8 max-w-full items-center gap-1 overflow-x-hidden px-1"
      style={{ left: DAY_NAME_COLUMN_PX, width: 'min(100%, 100vw)' }}
      aria-label="Ohne Uhrzeit"
    >
      {untimed.map((job) => (
        <CalendarCard
          key={job.id}
          job={job}
          size="day"
          compact
          draggable={draggable}
          locked={isStartedOccurrence(job, nowTick)}
          className="h-6 max-w-56 shrink-0"
          onOpen={(element) => actions.onOpenCard(job, element, model.row)}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            startDrag(event, {
              payload: { kind: 'untimed', job, sourceDate: dateIso },
              ghost: {
                label: job.title,
                secondary: job.clientName ?? undefined,
                width: Math.min(rect.width, 240),
                height: rect.height,
              },
              pointerOffset: {
                x: Math.min(event.clientX - rect.left, 240),
                y: event.clientY - rect.top,
              },
            });
          }}
        />
      ))}
    </div>
  );
}

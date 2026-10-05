'use client';

import { useMemo, useRef } from 'react';
import { cn, toLocalDateString } from '@/lib/utils';
import type { CalendarBoardContext } from '@/lib/calendar/board';
import { DAY_NAME_COLUMN_PX, minutesIntoDay } from '@/lib/calendar/day-layout';
import type { CalendarJob } from '@/lib/jobs/types';
import type { OrgRole } from '@/lib/members/actions';
import type { JobParkingContext } from '@/lib/parking/types';
import { getHolidayContextDays, type OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { EntryChangeRequestMap, InteractiveCalendarSession, TimeEntry } from '@/lib/time-tracking/types';
import type { CalendarMember } from '../members';
import type { CalendarSurfaceActions } from '../board/types';
import { useCalendarDrag, useDragSurface } from '../drag-engine/drag-engine';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';
import { CALENDAR_LAYER_CLASS } from '../surface/layers';
import { NowIndicator } from '../surface/now-indicator';
import { useClock, useNowTick } from '../surface/use-now-tick';
import { DayTimelineRow, type DayTimelineProps } from './day-timeline-row';
import { DayViewList } from './day-view-list';
import { TimelineHeader } from './timeline-header';
import { useDayCreateDrag } from './use-day-create-drag';
import { useDayRows } from './use-day-rows';
import { useDaySurface } from './use-day-surface';
import { useTimelineZoom } from './use-timeline-zoom';

export type DayViewProps = {
  date: Date;
  todayIso: string;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  entries: TimeEntry[];
  jobs: CalendarJob[];
  members: CalendarMember[];
  board: CalendarBoardContext;
  holidays: OrganizationHolidayCalendar;
  organizationSettings: OrganizationTimeTrackingSettings;
  currentUserId: string;
  currentUserRole: OrgRole;
  changeRequestMap: EntryChangeRequestMap;
  mutations: CalendarMutations;
  actions: CalendarSurfaceActions;
  parkingContexts: ReadonlyMap<string, JobParkingContext> | null;
  onParkedContextMissing: () => void;
  onSessionClick: (session: InteractiveCalendarSession) => void;
  highlightMemberId: string | null;
  verticalScroller: () => HTMLElement | null;
  phone?: boolean;
};

/**
 * The day view (P1-24a, package C): people rows against the hour axis in
 * the same scroller as the page, rows growing with their lanes, recorded
 * blocks and planned visits side by side, an untimed tray per person, the
 * now line, drag-to-create on empty time, and every gesture through the
 * shared engine, pre-checks and the optimistic owner.
 */
export function DayView(props: DayViewProps): React.JSX.Element {
  const {
    date,
    todayIso,
    zoom,
    onZoomChange,
    entries,
    jobs,
    members,
    board,
    holidays,
    organizationSettings,
    currentUserId,
    currentUserRole,
    changeRequestMap,
    mutations,
    actions,
    parkingContexts,
    onParkedContextMissing,
    onSessionClick,
    highlightMemberId,
    verticalScroller,
    phone = false,
  } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const { startDrag } = useCalendarDrag();
  const dateIso = toLocalDateString(date);
  const dayStart = useMemo(() => new Date(date.getFullYear(), date.getMonth(), date.getDate()), [date]);
  const isToday = dateIso === todayIso;
  const nowTick = useNowTick(isToday);
  const clock = useClock();
  const hourWidth = useTimelineZoom({
    zoom,
    onZoomChange,
    dateKey: dateIso,
    scroller: verticalScroller,
    enabled: !phone,
  });
  const timelineWidth = 24 * hourWidth;

  const { days, rows } = useDayRows({
    board,
    members,
    jobs,
    entries,
    dateIso,
    dayStart,
    nowTick,
    organizationSettings,
    hourWidth,
    isManager: actions.isManager,
  });

  const rowModels = useMemo(() => rows.map((row) => row.model), [rows]);
  const surface = useDaySurface({
    rootRef,
    highlightRef,
    horizontalScroller: verticalScroller,
    verticalScroller,
    hourWidth,
    dateIso,
    dayStart,
    rows: rowModels,
    days,
    mutations,
    parkingContexts,
    onParkedContextMissing,
    onPark: actions.onPark,
    nowMs: clock,
  });
  useDragSurface(surface);

  const headerLabel = useMemo(() => {
    const year = Number(dateIso.slice(0, 4));
    const holiday = getHolidayContextDays(holidays, year, year).find((day) => day.date === dateIso);
    const closure = holidays.closureDays.find((day) => day.closureDate === dateIso);
    return holiday?.name ?? (closure ? (closure.label ?? 'Betriebsruhe') : null);
  }, [dateIso, holidays]);

  const canCreate = actions.isManager;
  const createDrag = useDayCreateDrag({ canCreate, hourWidth, dateIso, actions });

  const nowMinutes = isToday ? minutesIntoDay(new Date(nowTick), dayStart) : null;

  if (phone) {
    return (
      <DayViewList
        dateIso={dateIso}
        headerLabel={headerLabel}
        rows={rows}
        nowTick={nowTick}
        actions={actions}
        organizationSettings={organizationSettings}
        changeRequestMap={changeRequestMap}
        onSessionClick={onSessionClick}
      />
    );
  }

  const timeline: DayTimelineProps = {
    dateIso,
    hourWidth,
    timelineWidth,
    canCreate,
    draggable: actions.isManager,
    nowTick,
    actions,
    startDrag,
    createDrag,
    currentUserRole,
    currentUserId,
    changeRequestMap,
    onSessionClick,
    organizationSettings,
  };
  return (
    <div
      ref={rootRef}
      role="grid"
      aria-label="Tageskalender"
      data-day-view={dateIso}
      className="relative flex min-h-full flex-col"
      style={{ width: DAY_NAME_COLUMN_PX + timelineWidth }}
    >
      <TimelineHeader hourWidth={hourWidth} label={headerLabel} />
      <div role="rowgroup" className="relative flex flex-1 flex-col">
        {rows.map((row) => (
          <DayTimelineRow
            key={row.model.userId}
            {...timeline}
            row={row}
            highlighted={highlightMemberId === row.model.userId}
          />
        ))}
        {rows.length === 0 && (
          <p className="px-4 py-8 text-sm text-muted-foreground">Keine Mitarbeiter für diese Auswahl.</p>
        )}
        {nowMinutes !== null && (
          <NowIndicator orientation="vertical" offset={DAY_NAME_COLUMN_PX + (nowMinutes / 60) * hourWidth} />
        )}
      </div>
      <div
        ref={highlightRef}
        hidden
        aria-hidden="true"
        data-day-highlight=""
        data-state="valid"
        className={cn(
          'pointer-events-none absolute left-0 top-0 rounded-md ring-2 ring-inset will-change-transform data-[state=valid]:bg-calendar-drop-valid data-[state=valid]:ring-success data-[state=refused]:bg-calendar-drop-refused data-[state=refused]:ring-destructive',
          CALENDAR_LAYER_CLASS.overlay,
        )}
      />
    </div>
  );
}

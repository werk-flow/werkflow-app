'use client';

import { useMemo, useRef, useState } from 'react';
import { cn, toLocalDateString } from '@/lib/utils';
import { WEEKDAY_SHORT } from '@/lib/calendar/board-layout';
import { canManageBlock } from '@/lib/calendar/day-row-status';
import type { OrgRole } from '@/lib/roles';
import { monthCellItemsByDate, type MonthCellItem } from '@/lib/calendar/month-cell-items';
import { monthGridRange, monthWeeks } from '@/lib/calendar/month-layout';
import type { CalendarJob } from '@/lib/jobs/types';
import type { JobParkingContext } from '@/lib/parking/types';
import { getHolidayContextDays, type OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import type { SicknessCalendarEntry } from '@/lib/sickness/actions';
import { calculateCalendarWorkBlocks } from '@/lib/time-tracking/calendar-blocks';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { InteractiveCalendarSession, TimeEntry } from '@/lib/time-tracking/types';
import type { VacationCalendarEntry } from '@/lib/vacation/calendar-actions';
import { memberDisplayName, type CalendarMember } from '../members';
import type { CalendarSurfaceActions } from '../board/types';
import { useCalendarDrag, useDragSurface } from '../drag-engine/drag-engine';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';
import { CALENDAR_LAYER_CLASS } from '../surface/layers';
import { useClock, useNowTick } from '../surface/use-now-tick';
import { MonthCellEntry } from './month-cell-entry';
import { MonthWeek } from './month-week';
import { useMonthKeyboard } from './use-month-keyboard';
import { useMonthSurface } from './use-month-surface';

export type MonthViewProps = {
  date: Date;
  todayIso: string;
  jobs: CalendarJob[];
  entries: TimeEntry[];
  members: CalendarMember[];
  vacation: VacationCalendarEntry[];
  sickness: SicknessCalendarEntry[];
  holidays: OrganizationHolidayCalendar;
  organizationSettings: OrganizationTimeTrackingSettings;
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  mutations: CalendarMutations;
  actions: CalendarSurfaceActions;
  parkingContexts: ReadonlyMap<string, JobParkingContext> | null;
  onParkedContextMissing: () => void;
  onOpenDay: (date: Date) => void;
  onSessionClick: (session: InteractiveCalendarSession) => void;
  verticalScroller: () => HTMLElement | null;
};

/** Holiday and closure labels by date, a year either side so the grid's edge weeks carry theirs. */
function monthDayLabels(holidays: OrganizationHolidayCalendar, anchorIso: string): Map<string, string> {
  const map = new Map<string, string>();
  const year = Number(anchorIso.slice(0, 4));
  for (const holiday of getHolidayContextDays(holidays, year - 1, year + 1))
    map.set(holiday.date, holiday.name);
  for (const closure of holidays.closureDays) map.set(closure.closureDate, closure.label ?? 'Betriebsruhe');
  return map;
}

function workBlocksByUser(entries: TimeEntry[]) {
  const byUser = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const list = byUser.get(entry.userId) ?? [];
    list.push(entry);
    byUser.set(entry.userId, list);
  }
  return new Map(
    [...byUser].map(([userId, userEntries]) => [userId, calculateCalendarWorkBlocks(userEntries)]),
  );
}

/** The month's clock, grid, items and drag surface, in the order the view renders them. */
function useMonthViewState(props: MonthViewProps) {
  const { date, todayIso, jobs, entries, members, holidays, mutations, actions } = props;
  const { parkingContexts, onParkedContextMissing, onOpenDay, verticalScroller } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const { startDrag } = useCalendarDrag();
  const [openMore, setOpenMore] = useState<string | null>(null);
  const nowTick = useNowTick();
  const clock = useClock();
  const anchorIso = toLocalDateString(date);
  const weeks = useMemo(() => monthWeeks(anchorIso, todayIso), [anchorIso, todayIso]);
  const range = useMemo(() => monthGridRange(weeks), [weeks]);

  const labels = useMemo(() => monthDayLabels(holidays, anchorIso), [anchorIso, holidays]);

  const nameByUser = useMemo(
    () => new Map(members.map((member) => [member.user_id, memberDisplayName(member)])),
    [members],
  );
  const blocksByUser = useMemo(() => workBlocksByUser(entries), [entries]);
  const { itemsByDate, blocksByUserDate } = useMemo(
    () =>
      monthCellItemsByDate({
        jobs,
        blocksByUser,
        nameByUser,
        nowTick,
        range: { from: range.from, to: range.to },
      }),
    [blocksByUser, jobs, nameByUser, nowTick, range.from, range.to],
  );

  const surface = useMonthSurface({
    rootRef,
    highlightRef,
    verticalScroller,
    mutations,
    parkingContexts,
    onParkedContextMissing,
    onPark: actions.onPark,
    blocksByUserDate,
    closedPeriods: actions.closedPeriods,
    nowMs: clock,
  });
  useDragSurface(surface);
  const keyboard = useMonthKeyboard({ weeks, rootRef, onOpenDay });

  const roleByUser = useMemo(
    () => new Map(members.map((member) => [member.user_id, member.role])),
    [members],
  );
  return {
    rootRef,
    highlightRef,
    startDrag,
    openMore,
    setOpenMore,
    nowTick,
    anchorIso,
    labels,
    itemsByDate,
    keyboard,
    roleByUser,
  };
}

/**
 * The month view (P1-24a, package D): a CSS grid of the month's weeks that
 * grows with its content, absences and multi-day visits as bars per week,
 * visits and recorded blocks as one-line items, „+n mehr" in a popover,
 * past days dimmed, and date moves through the shared engine.
 */
export function MonthView(props: MonthViewProps): React.JSX.Element {
  const { jobs, vacation, sickness, organizationSettings, currentUserId, currentUserRole } = props;
  const { isAdminOrManager, actions, onOpenDay, onSessionClick } = props;
  const state = useMonthViewState(props);
  const { rootRef, highlightRef, startDrag, openMore, setOpenMore, nowTick } = state;
  const { anchorIso, labels, itemsByDate, keyboard, roleByUser } = state;

  const draggable = isAdminOrManager;
  const itemFor = (item: MonthCellItem, full: boolean): React.JSX.Element => (
    <MonthCellEntry
      key={item.key}
      item={item}
      full={full}
      draggable={draggable}
      canManage={
        item.kind === 'block' &&
        canManageBlock(item.block, roleByUser.get(item.block.userId), {
          ...actions,
          currentUserRole,
          currentUserId,
        })
      }
      isAdminOrManager={isAdminOrManager}
      nowTick={nowTick}
      organizationSettings={organizationSettings}
      actions={actions}
      startDrag={startDrag}
      onSessionClick={onSessionClick}
    />
  );

  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- APG grid with a roving tab stop: the day cells take tabIndex (use-month-keyboard.ts), the grid itself is no tab stop
    <div
      ref={rootRef}
      role="grid"
      aria-label="Monatskalender"
      data-month-view={anchorIso.slice(0, 7)}
      className="relative flex min-h-full min-w-[640px] flex-col"
      onFocus={keyboard.onFocus}
      onKeyDown={keyboard.onKeyDown}
    >
      <MonthWeekdayHeader />
      <div role="rowgroup" className="grid flex-1 auto-rows-fr">
        {keyboard.weeks.map((week) => (
          <MonthWeek
            key={week[0]?.date}
            week={week}
            labels={labels}
            vacation={vacation}
            sickness={sickness}
            jobs={jobs}
            itemsByDate={itemsByDate}
            itemFor={itemFor}
            openMore={openMore}
            onOpenMore={setOpenMore}
            onOpenDay={onOpenDay}
            canAdd={isAdminOrManager}
            onAdd={(dateIso) => actions.onAddEntry({ date: dateIso })}
            onOpenCard={(job, element) => actions.onOpenCard(job, element, null)}
          />
        ))}
      </div>
      <div
        ref={highlightRef}
        hidden
        aria-hidden="true"
        data-month-highlight=""
        data-state="valid"
        className={cn(
          'pointer-events-none absolute left-0 top-0 rounded-sm ring-2 ring-inset will-change-transform data-[state=valid]:bg-calendar-drop-valid data-[state=valid]:ring-success data-[state=refused]:bg-calendar-drop-refused data-[state=refused]:ring-destructive',
          CALENDAR_LAYER_CLASS.overlay,
        )}
      />
    </div>
  );
}

/** The sticky weekday names above the grid, the weekend columns tinted. */
function MonthWeekdayHeader(): React.JSX.Element {
  return (
    <div
      role="row"
      className={cn(
        'sticky top-0 grid grid-cols-7 border-b border-calendar-grid-strong bg-background',
        CALENDAR_LAYER_CLASS.sticky,
      )}
    >
      {WEEKDAY_SHORT.map((weekday, index) => (
        <div
          key={weekday}
          role="columnheader"
          className={cn(
            'px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground',
            index >= 5 && 'bg-calendar-cell-off',
          )}
        >
          {weekday}
        </div>
      ))}
    </div>
  );
}

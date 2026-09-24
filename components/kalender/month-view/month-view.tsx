'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn, toLocalDateString } from '@/lib/utils';
import { WEEKDAY_SHORT, packLanes, type BoardColumn, type BoardSpanItem } from '@/lib/calendar/board-layout';
import { absenceItems } from '@/lib/calendar/board-model';
import { MONTH_MAX_VISIBLE_ITEMS, monthGridRange, monthRowTemplate, monthWeeks, type MonthCell } from '@/lib/calendar/month-layout';
import { formatRefusalDate } from '@/lib/calendar/messages';
import type { CalendarJob } from '@/lib/jobs/types';
import type { JobParkingContext } from '@/lib/parking/types';
import { getHolidayContextDays, type OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import type { SicknessCalendarEntry } from '@/lib/sickness/actions';
import { calculateCalendarWorkBlocks, createSessionFromCalendarBlock, type CalendarWorkBlock } from '@/lib/time-tracking/calendar-blocks';
import { formatDuration } from '@/lib/time-tracking/helpers';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { InteractiveCalendarSession, TimeEntry } from '@/lib/time-tracking/types';
import type { VacationCalendarEntry } from '@/lib/vacation/actions';
import { memberDisplayName, type CalendarMember } from '../members';
import type { CalendarSurfaceActions } from '../board/types';
import { useCalendarDrag, useDragSurface } from '../drag-engine/drag-engine';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';
import { BarSegment } from '../surface/bar-segment';
import { CalendarCard } from '../surface/calendar-card';
import { CALENDAR_LAYER_CLASS } from '../surface/layers';
import { useNowTick } from '../surface/use-now-tick';
import { minutesIntoDay } from '@/lib/calendar/day-layout';
import { formatMinutesOfDay } from '@/lib/calendar/drag-math';
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
  isAdminOrManager: boolean;
  mutations: CalendarMutations;
  actions: CalendarSurfaceActions;
  parkingContexts: ReadonlyMap<string, JobParkingContext> | null;
  onParkedContextMissing: () => void;
  onOpenDay: (date: Date) => void;
  onSessionClick: (session: InteractiveCalendarSession) => void;
  verticalScroller: () => HTMLElement | null;
};

type MonthBar = BoardSpanItem & ({ kind: 'absence'; label: string; tone: 'absence' | 'absence-pending' } | { kind: 'job'; job: CalendarJob });

type CellItem =
  | { kind: 'job'; key: string; job: CalendarJob }
  | { kind: 'block'; key: string; block: CalendarWorkBlock; userId: string; name: string; startMinutes: number; endMinutes: number; dateIso: string };

/**
 * The month view (P1-24a, package D): a CSS grid of the month's weeks that
 * grows with its content, absences and multi-day visits as bars per week,
 * visits and recorded blocks as one-line items, „+n mehr" in a popover,
 * past days dimmed, and date moves through the shared engine.
 */
export function MonthView(props: MonthViewProps): React.JSX.Element {
  const { date, todayIso, jobs, entries, members, vacation, sickness, holidays, organizationSettings, isAdminOrManager, mutations, actions, parkingContexts, onParkedContextMissing, onOpenDay, onSessionClick, verticalScroller } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const { startDrag, setLocked } = useCalendarDrag();
  const [openMore, setOpenMore] = useState<string | null>(null);
  const nowTick = useNowTick();
  const anchorIso = toLocalDateString(date);
  const weeks = useMemo(() => monthWeeks(anchorIso, todayIso), [anchorIso, todayIso]);
  const range = useMemo(() => monthGridRange(weeks), [weeks]);

  useEffect(() => {
    setLocked(actions.readOnly, '„Nur ansehen" ist aktiv. Schalte es in der Kopfzeile aus, um zu planen.');
    return () => setLocked(false, '');
  }, [actions.readOnly, setLocked]);

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    const year = Number(anchorIso.slice(0, 4));
    for (const holiday of getHolidayContextDays(holidays, year - 1, year + 1)) map.set(holiday.date, holiday.name);
    for (const closure of holidays.closureDays) map.set(closure.closureDate, closure.label ?? 'Betriebsruhe');
    return map;
  }, [anchorIso, holidays]);

  const nameByUser = useMemo(() => new Map(members.map((member) => [member.user_id, memberDisplayName(member)])), [members]);
  const blocksByUser = useMemo(() => {
    const byUser = new Map<string, TimeEntry[]>();
    for (const entry of entries) {
      const list = byUser.get(entry.userId) ?? [];
      list.push(entry);
      byUser.set(entry.userId, list);
    }
    return new Map([...byUser].map(([userId, userEntries]) => [userId, calculateCalendarWorkBlocks(userEntries)]));
  }, [entries]);
  const { itemsByDate, blocksByUserDate } = useMemo(() => {
    const byDate = new Map<string, CellItem[]>();
    const byUserDate = new Map<string, Array<{ id: string; startMs: number; endMs: number }>>();
    const push = (dateIso: string, item: CellItem) => { const list = byDate.get(dateIso) ?? []; list.push(item); byDate.set(dateIso, list); };
    for (const job of jobs) {
      // Multi-day all-day visits become week bars below; single days list as items.
      if (job.plannedDate && job.plannedDate >= range.from && job.plannedDate <= range.to && (!job.endDateExclusive || job.endDateExclusive <= job.plannedDate || job.endDateExclusive === job.plannedDate || !isMultiDay(job))) push(job.plannedDate, { kind: 'job', key: job.id, job });
    }
    for (const [userId, blocks] of blocksByUser) {
      for (const block of blocks) {
        const start = new Date(block.start);
        const dateIso = toLocalDateString(start);
        if (dateIso < range.from || dateIso > range.to) continue;
        const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endMs = block.end ? new Date(block.end).getTime() : nowTick;
        push(dateIso, { kind: 'block', key: block.id, block, userId, name: nameByUser.get(userId) ?? 'Mitarbeiter', startMinutes: minutesIntoDay(start, dayStart), endMinutes: minutesIntoDay(new Date(endMs), dayStart), dateIso });
        const list = byUserDate.get(`${userId}:${dateIso}`) ?? [];
        list.push({ id: block.id, startMs: start.getTime(), endMs });
        byUserDate.set(`${userId}:${dateIso}`, list);
      }
    }
    for (const list of byDate.values()) {
      list.sort((a, b) => (a.kind === 'job' ? (a.job.plannedTime ?? '') : formatMinutesOfDay(a.startMinutes)).localeCompare(b.kind === 'job' ? (b.job.plannedTime ?? '') : formatMinutesOfDay(b.startMinutes)));
    }
    return { itemsByDate: byDate, blocksByUserDate: byUserDate };
  }, [blocksByUser, jobs, nameByUser, nowTick, range.from, range.to]);

  const surface = useMonthSurface({ rootRef, highlightRef, verticalScroller, readOnly: actions.readOnly, mutations, parkingContexts, onParkedContextMissing, onPark: actions.onPark, blocksByUserDate, nowMs: () => Date.now() });
  useDragSurface(surface);

  const draggable = isAdminOrManager;
  const itemFor = (item: CellItem, full: boolean): React.JSX.Element => {
    if (item.kind === 'job') {
      const { job } = item;
      const sourceUserId = job.assignedUserIds[0] ?? null;
      return (
        <CalendarCard
          key={item.key}
          job={job}
          size="month"
          draggable={draggable}
          className={cn('w-full', full ? 'h-7' : 'h-6')}
          onOpen={(element) => actions.onOpenCard(job, element, null)}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            startDrag(event, { payload: { kind: 'occurrence', job, sourceEmployeeRecordId: job.assignedEmployeeRecordIds?.[0] ?? null, sourceUserId, sourceDate: job.plannedDate ?? '' }, ghost: { label: job.title, secondary: job.plannedTime ?? undefined, width: Math.min(rect.width, 200), height: rect.height }, pointerOffset: { x: Math.min(event.clientX - rect.left, 200), y: event.clientY - rect.top } });
          }}
        />
      );
    }
    const pending = item.block.isPending || item.block.sourceEntries.some((entry) => entry.status === 'pending' || entry.status === 'pending_delete');
    const label = `${isAdminOrManager ? `${item.name} ` : 'Arbeitszeit '}${formatMinutesOfDay(item.startMinutes)}–${item.block.isOpen ? 'jetzt' : formatMinutesOfDay(item.endMinutes)}`;
    return (
      <button
        key={item.key}
        type="button"
        data-time-block={item.block.id}
        className={cn('flex h-6 w-full min-w-0 items-center gap-1 rounded-md border px-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', pending ? 'border-warning/60 bg-warning-soft text-warning-soft-foreground' : 'border-calendar-actual-border bg-calendar-actual text-calendar-actual-foreground', draggable && !item.block.isOpen && 'cursor-grab active:cursor-grabbing')}
        aria-label={`${label}, ${formatDuration(item.endMinutes - item.startMinutes)}`}
        onClick={() => onSessionClick(createSessionFromCalendarBlock(item.block, new Date(), organizationSettings))}
        onPointerDown={(event) => {
          if (!draggable || item.block.isOpen) return;
          const rect = event.currentTarget.getBoundingClientRect();
          startDrag(event, { payload: { kind: 'timeBlock', session: createSessionFromCalendarBlock(item.block, new Date(), organizationSettings), sourceUserId: item.userId, sourceDate: item.dateIso, durationMinutes: item.endMinutes - item.startMinutes }, ghost: { label, width: Math.min(rect.width, 200), height: rect.height }, pointerOffset: { x: Math.min(event.clientX - rect.left, 200), y: event.clientY - rect.top } });
        }}
      >
        <Clock className="size-3 shrink-0 opacity-70" aria-hidden="true" />
        <span className="truncate tabular-nums">{label} · {formatDuration(item.endMinutes - item.startMinutes)}</span>
      </button>
    );
  };

  return (
    <div ref={rootRef} role="grid" aria-label="Monatskalender" aria-readonly={actions.readOnly || undefined} data-month-view={anchorIso.slice(0, 7)} className="relative min-w-[640px]">
      <div role="row" className={cn('sticky top-0 grid grid-cols-7 border-b border-calendar-grid-strong bg-background', CALENDAR_LAYER_CLASS.sticky)}>
        {WEEKDAY_SHORT.map((weekday, index) => (
          <div key={weekday} role="columnheader" className={cn('px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground', index >= 5 && 'bg-calendar-cell-off')}>{weekday}</div>
        ))}
      </div>
      <div role="rowgroup">
        {weeks.map((week) => (
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
            canAdd={isAdminOrManager && !actions.readOnly}
            onAdd={(dateIso) => actions.onAddEntry({ date: dateIso, kind: 'termin' })}
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
        className={cn('pointer-events-none absolute left-0 top-0 rounded-sm ring-2 ring-inset will-change-transform data-[state=valid]:bg-calendar-drop-valid data-[state=valid]:ring-success data-[state=refused]:bg-calendar-drop-refused data-[state=refused]:ring-destructive', CALENDAR_LAYER_CLASS.overlay)}
      />
    </div>
  );
}

function isMultiDay(job: CalendarJob): boolean {
  return Boolean(job.plannedDate && job.endDateExclusive && job.endDateExclusive > addDays(job.plannedDate, 1));
}

function addDays(dateIso: string, days: number): string {
  const time = Date.parse(`${dateIso}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

function MonthWeek(props: {
  week: MonthCell[];
  labels: ReadonlyMap<string, string>;
  vacation: VacationCalendarEntry[];
  sickness: SicknessCalendarEntry[];
  jobs: CalendarJob[];
  itemsByDate: ReadonlyMap<string, CellItem[]>;
  itemFor: (item: CellItem, full: boolean) => React.JSX.Element;
  openMore: string | null;
  onOpenMore: (dateIso: string | null) => void;
  onOpenDay: (date: Date) => void;
  canAdd: boolean;
  onAdd: (dateIso: string) => void;
  onOpenCard: (job: CalendarJob, element: HTMLElement) => void;
}): React.JSX.Element {
  const { week, labels, vacation, sickness, jobs, itemsByDate, itemFor, openMore, onOpenMore, onOpenDay, canAdd, onAdd, onOpenCard } = props;
  const columns = useMemo<BoardColumn[]>(() => week.map((cell) => ({ date: cell.date, weekday: cell.weekday, isToday: cell.isToday, isWeekend: cell.isWeekend })), [week]);
  const bars = useMemo(() => {
    const items: MonthBar[] = [
      ...absenceItems({ vacation, sickness, employeeRecordId: null }).map((absence): MonthBar => ({ kind: 'absence', key: absence.key, startDate: absence.startDate, endDateExclusive: absence.endDateExclusive, sortMinutes: absence.sortMinutes, label: absence.label, tone: absence.pending ? 'absence-pending' : 'absence' })),
      ...jobs.filter(isMultiDay).flatMap((job): MonthBar[] => (job.plannedDate ? [{ kind: 'job', key: `job:${job.id}`, startDate: job.plannedDate, endDateExclusive: job.endDateExclusive ?? job.plannedDate, sortMinutes: 0, job }] : [])),
    ];
    return packLanes(items, columns);
  }, [columns, jobs, sickness, vacation]);
  return (
    <div role="row" className="grid grid-cols-7 border-b border-calendar-grid" style={{ gridTemplateRows: monthRowTemplate(bars.laneCount) }}>
      {week.map((cell, index) => {
        const label = labels.get(cell.date);
        const items = itemsByDate.get(cell.date) ?? [];
        const visible = items.slice(0, MONTH_MAX_VISIBLE_ITEMS);
        const hidden = items.length - visible.length;
        const cellDate = new Date(`${cell.date}T12:00:00`);
        return (
          <div key={cell.date} className="contents">
            <div
              role="gridcell"
              data-month-cell={cell.date}
              data-in-month={cell.inMonth ? 'true' : 'false'}
              aria-label={`${formatRefusalDate(cell.date)}${label ? `, ${label}` : ''}${items.length ? `, ${items.length} Einträge` : ''}`}
              className={cn('min-w-0 border-r border-calendar-grid', (cell.isWeekend || label) && 'bg-calendar-cell-off', cell.isToday && 'bg-calendar-today', cell.isPast && 'opacity-80')}
              style={{ gridColumn: index + 1, gridRow: '1 / -1' }}
              onDoubleClick={() => onOpenDay(cellDate)}
            />
            <div className={cn('group/cell relative z-[1] flex min-w-0 items-start gap-1 px-1.5 pt-1', !cell.inMonth && 'text-muted-foreground')} style={{ gridColumn: index + 1, gridRow: 1 }}>
              <button type="button" data-month-day-number={cell.date} className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-sm tabular-nums hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', cell.isToday && 'bg-calendar-planning-strong font-semibold text-calendar-planning-strong-foreground hover:bg-calendar-planning-strong')} aria-label={`${formatRefusalDate(cell.date)} in der Tagesansicht öffnen`} onClick={() => onOpenDay(cellDate)}>
                {Number(cell.date.slice(8, 10))}
              </button>
              {label && <span data-calendar-holiday="" className="pointer-events-none min-w-0 truncate pt-1 text-[11px] text-calendar-holiday-foreground" title={label}>{label}</span>}
              {canAdd && (
                <button type="button" className="ml-auto rounded-md px-1 text-xs text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/cell:opacity-100" aria-label={`Termin am ${formatRefusalDate(cell.date)} planen`} onClick={() => onAdd(cell.date)}>+</button>
              )}
            </div>
            <div data-month-day={cell.date} className="relative z-[1] flex min-w-0 flex-col gap-0.5 px-1 pb-1" style={{ gridColumn: index + 1, gridRow: -2 }}>
              {visible.map((item) => itemFor(item, false))}
              {hidden > 0 && (
                <Popover open={openMore === cell.date} onOpenChange={(open) => onOpenMore(open ? cell.date : null)}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 justify-start px-1.5 text-xs text-muted-foreground">+{hidden} mehr</Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 space-y-1 p-2" data-month-day-popover={cell.date}>
                    <p className="px-1 pb-1 text-sm font-medium">{formatRefusalDate(cell.date)}</p>
                    {items.map((item) => itemFor(item, true))}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        );
      })}
      {bars.lanes.map(({ item, lane, column, span }) => (
        <div key={item.key} className="relative z-[1] min-w-0 px-0.5" style={{ gridColumn: `${column + 1} / span ${span}`, gridRow: lane + 2 }}>
          {item.kind === 'job' ? (
            <CalendarCard job={item.job} size="month" className="h-5 w-full" onOpen={(element) => onOpenCard(item.job, element)} />
          ) : (
            <BarSegment tone={item.tone} edge="single" label={item.label} title={item.label} startDate={item.startDate} className="h-5" />
          )}
        </div>
      ))}
    </div>
  );
}

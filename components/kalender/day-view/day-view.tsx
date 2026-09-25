'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Plus } from 'lucide-react';
import { cn, toLocalDateString } from '@/lib/utils';
import { boardDayKey, indexBoardDays, type CalendarBoardContext, type CalendarBoardDay, type CalendarBoardRow } from '@/lib/calendar/board';
import { groupBoardRows } from '@/lib/calendar/board-model';
import { DAY_LANE_HEIGHT, DAY_NAME_COLUMN_PX, DAY_TRAY_HEIGHT, DEFAULT_VISIT_MINUTES, MIN_ITEM_MINUTES, minutesIntoDay, packTimeLanes, travelGaps, type TimedItem, jobStartMinutes } from '@/lib/calendar/day-layout';
import { formatMinutesOfDay, snapMinutes } from '@/lib/calendar/drag-math';
import { formatRefusalDate } from '@/lib/calendar/messages';
import type { CalendarJob } from '@/lib/jobs/types';
import type { OrgRole } from '@/lib/members/actions';
import type { JobParkingContext } from '@/lib/parking/types';
import { getHolidayContextDays, type OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import { calculateCalendarWorkBlocks, createSessionFromCalendarBlock, getCalendarBlockDisplaySegments, type CalendarWorkBlock } from '@/lib/time-tracking/calendar-blocks';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { EntryChangeRequestMap, InteractiveCalendarSession, TimeEntry } from '@/lib/time-tracking/types';
import { memberDisplayName, type CalendarMember } from '../members';
import { UNASSIGNED_USER, type CalendarSurfaceActions } from '../board/types';
import { useCalendarDrag, useDragSurface } from '../drag-engine/drag-engine';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';
import { CalendarCard } from '../surface/calendar-card';
import { CALENDAR_LAYER_CLASS } from '../surface/layers';
import { NowIndicator } from '../surface/now-indicator';
import { useNowTick } from '../surface/use-now-tick';
import { TimeBlock, type TimeBlockSegment } from './time-block';
import { TimelineHeader } from './timeline-header';
import { useDaySurface, type DayRowModel } from './use-day-surface';
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
};

type RowItem =
  | (TimedItem & { kind: 'block'; block: CalendarWorkBlock; segments: TimeBlockSegment[] })
  | (TimedItem & { kind: 'job'; job: CalendarJob });


/** Who may move or resize a recorded block: admins everything, Büro their own and employees' blocks, employees nothing. */
function canManageBlock(block: CalendarWorkBlock, currentUserRole: OrgRole, currentUserId: string, entryUserRole: string | undefined): boolean {
  if (block.sourceEntries.some((entry) => entry.status === 'pending_delete')) return false;
  if (currentUserRole === 'admin') return true;
  if (currentUserRole === 'buero') return entryUserRole === 'employee' || block.userId === currentUserId;
  return false;
}

/**
 * The day view (P1-24a, package C): people rows against the hour axis in
 * the same scroller as the page, rows growing with their lanes, recorded
 * blocks and planned visits side by side, an untimed tray per person, the
 * now line, drag-to-create on empty time, and every gesture through the
 * shared engine, pre-checks and the optimistic owner.
 */
export function DayView(props: DayViewProps): React.JSX.Element {
  const { date, todayIso, zoom, onZoomChange, entries, jobs, members, board, holidays, organizationSettings, currentUserId, currentUserRole, changeRequestMap, mutations, actions, parkingContexts, onParkedContextMissing, onSessionClick, highlightMemberId, verticalScroller } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const { startDrag, setLocked } = useCalendarDrag();
  const dateIso = toLocalDateString(date);
  const dayStart = useMemo(() => new Date(date.getFullYear(), date.getMonth(), date.getDate()), [date]);
  const isToday = dateIso === todayIso;
  const nowTick = useNowTick(isToday);
  const hourWidth = useTimelineZoom({ zoom, onZoomChange, dateKey: dateIso, scroller: verticalScroller });
  const timelineWidth = 24 * hourWidth;

  useEffect(() => {
    setLocked(actions.readOnly, '„Nur ansehen" ist aktiv. Schalte es in der Kopfzeile aus, um zu planen.');
    return () => setLocked(false, '');
  }, [actions.readOnly, setLocked]);

  const days = useMemo(() => indexBoardDays(board.days), [board.days]);
  const boardRowByUser = useMemo(() => new Map(board.rows.flatMap((row) => (row.userId ? [[row.userId, row] as const] : []))), [board.rows]);
  // The board's order (teams, then names); a member without a board row on this date keeps the membership order at the end.
  const orderedMembers = useMemo(() => {
    const order = new Map(groupBoardRows({ rows: board.rows, includeUnassigned: false, memberUserIds: null, teamIds: [] }).flatMap((group) => group.rows).flatMap((row, index) => (row.kind === 'person' && row.row.userId ? [[row.row.userId, index] as const] : [])));
    return [...members].sort((left, right) => (order.get(left.user_id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.user_id) ?? Number.MAX_SAFE_INTEGER));
  }, [board.rows, members]);
  const roleByUser = useMemo(() => new Map(members.map((member) => [member.user_id, member.role])), [members]);

  const dayJobs = useMemo(() => jobs.filter((job) => job.plannedDate && job.plannedDate <= dateIso && dateIso < (job.endDateExclusive ?? `${job.plannedDate}~`)), [jobs, dateIso]);
  const dayEntries = useMemo(() => entries.filter((entry) => toLocalDateString(new Date(entry.timestamp)) === dateIso), [entries, dateIso]);

  const rows = useMemo(() => {
    const now = new Date(nowTick);
    const list: Array<{ model: DayRowModel; boardDay: CalendarBoardDay | undefined; role: string | undefined; items: RowItem[]; untimed: CalendarJob[]; laneCount: number; lanes: ReturnType<typeof packTimeLanes<RowItem>>['lanes'] }> = [];
    const buildRow = (userId: string, name: string, row: CalendarBoardRow | null, rowJobs: CalendarJob[], rowEntries: TimeEntry[]) => {
      const blocks = calculateCalendarWorkBlocks(rowEntries);
      const items: RowItem[] = [];
      for (const block of blocks) {
        const start = minutesIntoDay(new Date(block.start), dayStart);
        const end = block.end ? minutesIntoDay(new Date(block.end), dayStart) : Math.max(start + MIN_ITEM_MINUTES, minutesIntoDay(now, dayStart));
        const segments = getCalendarBlockDisplaySegments(block, now, organizationSettings).map((segment) => ({
          id: segment.id,
          type: segment.type,
          startMinutes: minutesIntoDay(new Date(segment.start), dayStart),
          endMinutes: segment.end ? minutesIntoDay(new Date(segment.end), dayStart) : end,
        }));
        items.push({ kind: 'block', key: block.id, block, segments, startMinutes: start, endMinutes: Math.max(end, start + MIN_ITEM_MINUTES) });
      }
      const untimed: CalendarJob[] = [];
      for (const job of rowJobs) {
        if (!job.plannedTime || job.plannedDate !== dateIso) { untimed.push(job); continue; }
        const start = jobStartMinutes(job);
        items.push({ kind: 'job', key: job.id, job, startMinutes: start, endMinutes: Math.min(24 * 60, start + (job.estimatedDurationMinutes ?? DEFAULT_VISIT_MINUTES)) });
      }
      const packed = packTimeLanes(items);
      list.push({
        model: { userId, name, row, blocks: blocks.map((block) => ({ id: block.id, startMs: new Date(block.start).getTime(), endMs: block.end ? new Date(block.end).getTime() : now.getTime() })) },
        boardDay: row ? days.get(boardDayKey(row.employeeRecordId, dateIso)) : undefined,
        role: roleByUser.get(userId),
        items,
        untimed,
        laneCount: Math.max(1, packed.laneCount),
        lanes: packed.lanes,
      });
    };
    if (actions.isManager) {
      const unassigned = dayJobs.filter((job) => job.assignedUserIds.length === 0);
      if (unassigned.length > 0) buildRow(UNASSIGNED_USER, 'Ohne Zuweisung', null, unassigned, []);
    }
    for (const member of orderedMembers) {
      buildRow(member.user_id, memberDisplayName(member), boardRowByUser.get(member.user_id) ?? null, dayJobs.filter((job) => job.assignedUserIds.includes(member.user_id)), dayEntries.filter((entry) => entry.userId === member.user_id));
    }
    return list;
  }, [actions.isManager, boardRowByUser, dayEntries, dayJobs, dayStart, days, dateIso, orderedMembers, nowTick, organizationSettings, roleByUser]);

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
    readOnly: actions.readOnly,
    mutations,
    parkingContexts,
    onParkedContextMissing,
    onPark: actions.onPark,
    nowMs: () => Date.now(),
  });
  useDragSurface(surface);

  const headerLabel = useMemo(() => {
    const year = Number(dateIso.slice(0, 4));
    const holiday = getHolidayContextDays(holidays, year, year).find((day) => day.date === dateIso);
    const closure = holidays.closureDays.find((day) => day.closureDate === dateIso);
    return holiday?.name ?? (closure ? closure.label ?? 'Betriebsruhe' : null);
  }, [dateIso, holidays]);

  // Drag-to-create on empty time: DOM-only tracking, the dialog opens on release.
  const createRef = useRef<{ userId: string; startMinutes: number; endMinutes: number; overlay: HTMLElement; pointerId: number } | null>(null);
  const canCreate = actions.isManager && !actions.readOnly;
  const handleCreatePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>, userId: string) => {
    if (!canCreate || event.button !== 0 || event.pointerType === 'touch') return;
    if ((event.target as HTMLElement).closest('[data-calendar-card], [data-time-block], button')) return;
    const timeline = event.currentTarget;
    const overlay = timeline.querySelector<HTMLElement>('[data-day-create-overlay]');
    if (!overlay) return;
    const rect = timeline.getBoundingClientRect();
    const minutes = snapMinutes(((event.clientX - rect.left) / hourWidth) * 60, 15);
    createRef.current = { userId, startMinutes: minutes, endMinutes: minutes, overlay, pointerId: event.pointerId };
    timeline.setPointerCapture(event.pointerId);
    overlay.hidden = false;
    overlay.style.left = `${(minutes / 60) * hourWidth}px`;
    overlay.style.width = '0px';
    event.preventDefault();
  }, [canCreate, hourWidth]);
  const handleCreatePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const create = createRef.current;
    if (!create || event.pointerId !== create.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    create.endMinutes = Math.max(0, Math.min(24 * 60, snapMinutes(((event.clientX - rect.left) / hourWidth) * 60, event.shiftKey ? 5 : 15)));
    const start = Math.min(create.startMinutes, create.endMinutes);
    const end = Math.max(create.startMinutes, create.endMinutes);
    create.overlay.style.left = `${(start / 60) * hourWidth}px`;
    create.overlay.style.width = `${((end - start) / 60) * hourWidth}px`;
    create.overlay.textContent = end > start ? `${formatMinutesOfDay(start)}–${formatMinutesOfDay(end)}` : '';
  }, [hourWidth]);
  const handleCreatePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const create = createRef.current;
    if (!create || event.pointerId !== create.pointerId) return;
    createRef.current = null;
    create.overlay.hidden = true;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const start = Math.min(create.startMinutes, create.endMinutes);
    const end = Math.max(create.startMinutes, create.endMinutes);
    if (end - start < MIN_ITEM_MINUTES) return;
    actions.onAddEntry({ date: dateIso, time: formatMinutesOfDay(start), endTime: formatMinutesOfDay(end), userId: create.userId === UNASSIGNED_USER ? undefined : create.userId, kind: 'termin' });
  }, [actions, dateIso]);

  const nowMinutes = isToday ? minutesIntoDay(new Date(nowTick), dayStart) : null;
  const draggable = actions.isManager;
  const rowLabel = (boardDay: CalendarBoardDay | undefined): string | null => {
    if (!boardDay) return null;
    if (boardDay.absence) return boardDay.absence.type === 'vacation' ? (boardDay.absence.portion === 'half_day' ? 'Urlaub (halber Tag)' : 'Urlaub') : 'Krank';
    if (boardDay.reason === 'holiday' || boardDay.reason === 'closure') return boardDay.label ?? (boardDay.reason === 'holiday' ? 'Feiertag' : 'Betriebsruhe');
    if (boardDay.reason === 'no_work_day' || boardDay.targetMinutes === 0) return 'Kein Arbeitstag';
    return null;
  };

  return (
    <div ref={rootRef} role="grid" aria-label="Tageskalender" aria-readonly={actions.readOnly || undefined} data-day-view={dateIso} className="relative" style={{ width: DAY_NAME_COLUMN_PX + timelineWidth }}>
      <TimelineHeader hourWidth={hourWidth} label={headerLabel} />
      <div role="rowgroup" className="relative">
        {rows.map(({ model, boardDay, role, lanes, laneCount, untimed }) => {
          const trayHeight = untimed.length > 0 ? DAY_TRAY_HEIGHT : 0;
          const height = trayHeight + laneCount * DAY_LANE_HEIGHT;
          const off = Boolean(boardDay && (boardDay.absence?.portion === 'full' || boardDay.reason !== 'working' || boardDay.targetMinutes === 0));
          const label = rowLabel(boardDay);
          const gaps = travelGaps(lanes.filter(({ item }) => item.kind === 'job').map(({ item }) => item));
          const highlighted = highlightMemberId === model.userId;
          return (
            <div key={model.userId} role="row" data-day-row={model.userId} aria-label={model.name} className={cn('group/row flex', highlighted && 'animate-row-highlight')} style={{ height }}>
              <div role="rowheader" className={cn('sticky left-0 flex shrink-0 flex-col justify-center gap-0.5 border-b border-r border-calendar-grid-strong bg-calendar-gutter px-3 py-1', CALENDAR_LAYER_CLASS.sticky)} style={{ width: DAY_NAME_COLUMN_PX }}>
                <span className="flex min-w-0 items-center gap-1">
                  <span className="min-w-0 truncate text-sm font-medium">{model.name}</span>
                  {canCreate && model.userId !== UNASSIGNED_USER && (
                    <button type="button" className="ml-auto rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100" aria-label={`Termin am ${formatRefusalDate(dateIso)} für ${model.name} planen`} onClick={() => actions.onAddEntry({ date: dateIso, userId: model.userId, kind: 'termin' })}>
                      <Plus className="size-3.5" aria-hidden="true" />
                    </button>
                  )}
                </span>
                {label && <span className="truncate text-[11px] text-muted-foreground">{label}</span>}
              </div>
              <div
                role="gridcell"
                data-day-timeline=""
                aria-label={`${model.name}, ${formatRefusalDate(dateIso)}${label ? `: ${label}` : ''}`}
                className={cn('calendar-hour-grid relative shrink-0 border-b border-calendar-grid', off ? 'bg-calendar-cell-off' : 'bg-background', canCreate && 'cursor-crosshair')}
                style={{ width: timelineWidth, '--calendar-hour-width': `${hourWidth}px`, '--calendar-subline-width': `${hourWidth / (hourWidth >= 220 ? 4 : 2)}px` } as React.CSSProperties}
                onPointerDown={(event) => handleCreatePointerDown(event, model.userId)}
                onPointerMove={handleCreatePointerMove}
                onPointerUp={handleCreatePointerUp}
                onPointerCancel={handleCreatePointerUp}
              >
                <div hidden data-day-create-overlay="" aria-hidden="true" className={cn('pointer-events-none absolute top-1 bottom-1 rounded-md border border-dashed border-calendar-planning-strong bg-calendar-drop-valid px-1 text-[11px] tabular-nums text-calendar-planning-foreground', CALENDAR_LAYER_CLASS.overlay)} />
                {untimed.length > 0 && (
                  <div className="sticky left-0 flex h-8 max-w-full items-center gap-1 overflow-x-hidden px-1" style={{ width: 'min(100%, 100vw)' }} aria-label="Ohne Uhrzeit">
                    {untimed.map((job) => (
                      <CalendarCard
                        key={job.id}
                        job={job}
                        size="day"
                        compact
                        draggable={draggable}
                        className="h-6 max-w-56 shrink-0"
                        onOpen={(element) => actions.onOpenCard(job, element, model.row)}
                        onPointerDown={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          startDrag(event, { payload: { kind: 'untimed', job, sourceDate: dateIso }, ghost: { label: job.title, secondary: job.clientName ?? undefined, width: Math.min(rect.width, 240), height: rect.height }, pointerOffset: { x: Math.min(event.clientX - rect.left, 240), y: event.clientY - rect.top } });
                        }}
                      />
                    ))}
                  </div>
                )}
                {gaps.map((gap) => ((gap.endMinutes - gap.startMinutes) / 60) * hourWidth > 36 && (
                  <span key={gap.startMinutes} aria-hidden="true" className="pointer-events-none absolute bottom-0.5 truncate text-center text-[10px] tabular-nums text-muted-foreground" style={{ left: (gap.startMinutes / 60) * hourWidth, width: ((gap.endMinutes - gap.startMinutes) / 60) * hourWidth }}>
                    {gap.endMinutes - gap.startMinutes} min
                  </span>
                ))}
                {lanes.map(({ item, lane }) => {
                  const laneTop = trayHeight + lane * DAY_LANE_HEIGHT;
                  if (item.kind === 'block') {
                    const manage = draggable !== undefined && canManageBlock(item.block, currentUserRole, currentUserId, role) && !actions.readOnly;
                    return (
                      <TimeBlock
                        key={item.key}
                        block={item.block}
                        segments={item.segments}
                        startMinutes={item.startMinutes}
                        endMinutes={item.endMinutes}
                        hourWidth={hourWidth}
                        laneTop={laneTop}
                        laneHeight={DAY_LANE_HEIGHT}
                        changeRequestMap={changeRequestMap}
                        showName={actions.isManager ? model.name : null}
                        canManage={manage}
                        onOpen={(block) => onSessionClick(createSessionFromCalendarBlock(block, new Date(), organizationSettings))}
                        onPointerDownMove={(event, block) => {
                          if (block.isOpen) return;
                          const session = createSessionFromCalendarBlock(block, new Date(), organizationSettings);
                          const rect = event.currentTarget.getBoundingClientRect();
                          startDrag(event, { payload: { kind: 'timeBlock', session, sourceUserId: model.userId, sourceDate: dateIso, durationMinutes: item.endMinutes - item.startMinutes }, ghost: { label: `Arbeitszeit ${formatMinutesOfDay(item.startMinutes)}–${formatMinutesOfDay(item.endMinutes)}`, width: Math.min(rect.width, 240), height: rect.height }, pointerOffset: { x: Math.min(event.clientX - rect.left, 240), y: event.clientY - rect.top } });
                        }}
                        onPointerDownEdge={(event, block, edge) => {
                          const session = createSessionFromCalendarBlock(block, new Date(), organizationSettings);
                          startDrag(event, { payload: { kind: 'resizeBlock', session, edge, sourceUserId: model.userId }, ghost: { label: edge === 'start' ? 'Beginn ändern' : 'Ende ändern', width: 120, height: 24 }, pointerOffset: { x: 60, y: 12 } });
                        }}
                      />
                    );
                  }
                  const { job } = item;
                  const width = Math.max(24, ((item.endMinutes - item.startMinutes) / 60) * hourWidth);
                  return (
                    <div key={item.key} className="absolute" style={{ left: (item.startMinutes / 60) * hourWidth, width, top: laneTop + 3, height: DAY_LANE_HEIGHT - 6 }}>
                      <CalendarCard
                        job={job}
                        size="day"
                        compact={width < 110}
                        draggable={draggable}
                        className="h-full w-full"
                        {...(model.row ? { 'data-employee-record-id': model.row.employeeRecordId } : {})}
                        onOpen={(element) => actions.onOpenCard(job, element, model.row)}
                        onPointerDown={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          startDrag(event, { payload: { kind: 'occurrence', job, sourceEmployeeRecordId: model.row?.employeeRecordId ?? null, sourceUserId: model.userId === UNASSIGNED_USER ? null : model.userId, sourceDate: dateIso }, ghost: { label: job.title, secondary: `${formatMinutesOfDay(item.startMinutes)} · ${job.clientName ?? ''}`.trim(), width: Math.min(rect.width, 240), height: rect.height }, pointerOffset: { x: Math.min(event.clientX - rect.left, 240), y: event.clientY - rect.top } });
                        }}
                      >
                        {draggable && (
                          <>
                            <span role="presentation" className="absolute inset-y-0 -left-2 w-6 cursor-ew-resize" onPointerDown={(event) => { event.stopPropagation(); startDrag(event, { payload: { kind: 'resizeJob', job, edge: 'start', sourceUserId: model.userId === UNASSIGNED_USER ? null : model.userId }, ghost: { label: 'Beginn ändern', width: 120, height: 24 }, pointerOffset: { x: 60, y: 12 } }); }}>
                              <span className="absolute inset-y-0 left-2 w-2 bg-calendar-planning-strong opacity-0 transition-opacity group-hover/card:opacity-60" />
                            </span>
                            <span role="presentation" className="absolute inset-y-0 -right-2 w-6 cursor-ew-resize" onPointerDown={(event) => { event.stopPropagation(); startDrag(event, { payload: { kind: 'resizeJob', job, edge: 'end', sourceUserId: model.userId === UNASSIGNED_USER ? null : model.userId }, ghost: { label: 'Ende ändern', width: 120, height: 24 }, pointerOffset: { x: 60, y: 12 } }); }}>
                              <span className="absolute inset-y-0 right-2 w-2 bg-calendar-planning-strong opacity-0 transition-opacity group-hover/card:opacity-60" />
                            </span>
                          </>
                        )}
                      </CalendarCard>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="px-4 py-8 text-sm text-muted-foreground">Keine Mitarbeiter für diese Auswahl.</p>}
        {nowMinutes !== null && <NowIndicator orientation="vertical" offset={DAY_NAME_COLUMN_PX + (nowMinutes / 60) * hourWidth} />}
      </div>
      <div
        ref={highlightRef}
        hidden
        aria-hidden="true"
        data-day-highlight=""
        data-state="valid"
        className={cn('pointer-events-none absolute left-0 top-0 rounded-md ring-2 ring-inset will-change-transform data-[state=valid]:bg-calendar-drop-valid data-[state=valid]:ring-success data-[state=refused]:bg-calendar-drop-refused data-[state=refused]:ring-destructive', CALENDAR_LAYER_CLASS.overlay)}
      />
    </div>
  );
}

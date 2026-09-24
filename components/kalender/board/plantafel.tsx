'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { boardDayKey, indexBoardDays, indexBoardDispatch, plannedMinutesByEmployeeDate, deriveCapacityState, type CalendarBoardContext } from '@/lib/calendar/board';
import { boardColumns, WEEKDAY_SHORT, type BoardColumn } from '@/lib/calendar/board-layout';
import { actualMinutesByUserDate, dispatchStateMatches, groupBoardRows, matchesBoardSearch, rowOwnsJob, type BoardRowModel, type BoardTeamGroup } from '@/lib/calendar/board-model';
import { formatRefusalDate } from '@/lib/calendar/messages';
import type { CalendarPreferences } from '@/lib/calendar/preferences';
import type { CalendarJob } from '@/lib/jobs/types';
import { getHolidayContextDays, type OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import type { SicknessCalendarEntry } from '@/lib/sickness/actions';
import type { TimeEntry } from '@/lib/time-tracking/types';
import type { VacationCalendarEntry } from '@/lib/vacation/actions';
import type { JobParkingContext } from '@/lib/parking/types';
import { useCalendarDrag, useDragSurface } from '../drag-engine/drag-engine';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';
import { isNoteEntry } from '@/lib/calendar/board';
import { CalendarCard, dispatchChip, readinessChips } from '../surface/calendar-card';
import { CALENDAR_LAYER_CLASS } from '../surface/layers';
import { NowIndicator } from '../surface/now-indicator';
import { useNowTick } from '../surface/use-now-tick';
import { BoardRow } from './board-row';
import { BOARD_COLUMN_MIN_PX, BOARD_NAME_COLUMN_PX, type CalendarSurfaceActions } from './types';
import { useBoardSurface } from './use-board-surface';

export type PlantafelProps = {
  anchorIso: string;
  todayIso: string;
  preferences: CalendarPreferences;
  showActualTime: boolean;
  board: CalendarBoardContext;
  jobs: CalendarJob[];
  entries: TimeEntry[];
  vacation: VacationCalendarEntry[];
  sickness: SicknessCalendarEntry[];
  holidays: OrganizationHolidayCalendar;
  mutations: CalendarMutations;
  parkingContexts: ReadonlyMap<string, JobParkingContext> | null;
  onParkedContextMissing: () => void;
  actions: CalendarSurfaceActions;
  verticalScroller: () => HTMLElement | null;
  onIsolateRow: (employeeRecordId: string) => void;
  /** Phone width: the employee's own row renders as a list, never a cropped grid. */
  phone: boolean;
};

/**
 * The Plantafel (P1-24a, criteria 1 to 22): people rows against day
 * columns over one to six weeks, one CSS grid per row, capacity per cell,
 * absences and holidays as bars, cards with the dispatch chip, and every
 * drop through the shared engine and the optimistic owner.
 */
export function Plantafel(props: PlantafelProps): React.JSX.Element {
  const { anchorIso, todayIso, preferences, showActualTime, board, jobs, entries, vacation, sickness, holidays, mutations, parkingContexts, onParkedContextMissing, actions, verticalScroller, onIsolateRow, phone } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const { startDrag, setLocked } = useCalendarDrag();
  const [collapsedTeams, setCollapsedTeams] = useState<ReadonlySet<string>>(() => new Set());
  const [hoveredOccurrenceId, setHoveredOccurrenceId] = useState<string | null>(null);
  const nowTick = useNowTick();

  // Before paint: the lock must hold the moment the toggle shows as pressed, not a frame later.
  useLayoutEffect(() => {
    setLocked(actions.readOnly, '„Nur ansehen" ist aktiv. Schalte es in der Kopfzeile aus, um zu planen.');
    return () => setLocked(false, '');
  }, [actions.readOnly, setLocked]);

  const columns = useMemo(
    () => boardColumns({ anchorIso, horizonWeeks: preferences.horizonWeeks, hideWeekends: preferences.hideWeekends, todayIso }),
    [anchorIso, preferences.hideWeekends, preferences.horizonWeeks, todayIso],
  );
  const days = useMemo(() => indexBoardDays(board.days), [board.days]);
  const dispatch = useMemo(() => indexBoardDispatch(board.dispatch), [board.dispatch]);
  const materialDemandJobIds = useMemo(() => new Set(board.materialDemandJobIds), [board.materialDemandJobIds]);
  const recordIdByUserId = useMemo(() => new Map(board.rows.flatMap((row) => (row.userId ? [[row.userId, row.employeeRecordId] as const] : []))), [board.rows]);
  const planned = useMemo(
    () => plannedMinutesByEmployeeDate(jobs, (record, date) => days.get(boardDayKey(record, date))?.targetMinutes ?? 480, recordIdByUserId),
    [days, jobs, recordIdByUserId],
  );
  const actual = useMemo(() => (showActualTime ? actualMinutesByUserDate(entries, new Date(nowTick)) : null), [entries, nowTick, showActualTime]);

  const visibleJobs = useMemo(
    () => (preferences.showJobs ? jobs.filter((job) => matchesBoardSearch(job, preferences.search)) : []),
    [jobs, preferences.search, preferences.showJobs],
  );

  const groups = useMemo<BoardTeamGroup[]>(() => {
    const grouped = groupBoardRows({ rows: board.rows, includeUnassigned: actions.isManager, memberUserIds: preferences.memberUserIds, teamIds: preferences.teamIds });
    if (!preferences.onlyConflicts && preferences.dispatchStates.length === 0) return grouped;
    // „Nur Konflikte" keeps rows with an overbooked day or a challenge; a dispatch filter keeps rows with a matching card.
    return grouped
      .map((group) => ({
        ...group,
        rows: group.rows.filter((model) => {
          const rowJobs = visibleJobs.filter((job) => rowOwnsJob(model, job));
          const recordId = model.kind === 'person' ? model.row.employeeRecordId : null;
          const matchesDispatch = preferences.dispatchStates.length === 0 || rowJobs.some((job) => dispatchStateMatches(dispatch.get(`${job.occurrenceId}:${recordId}`) ?? 'nicht_gesendet', preferences.dispatchStates));
          if (!matchesDispatch) return false;
          if (!preferences.onlyConflicts) return true;
          if (!recordId) return false;
          const overbooked = columns.some((column) => { const day = days.get(boardDayKey(recordId, column.date)); return day ? deriveCapacityState(day, planned.get(boardDayKey(recordId, column.date)) ?? 0) === 'overbooked' : false; });
          const challenged = rowJobs.some((job) => dispatch.get(`${job.occurrenceId}:${recordId}`) === 'rueckfrage');
          return overbooked || challenged;
        }),
      }))
      .filter((group) => group.rows.length > 0);
  }, [actions.isManager, board.rows, columns, days, dispatch, planned, preferences.dispatchStates, preferences.memberUserIds, preferences.onlyConflicts, preferences.teamIds, visibleJobs]);

  const rowModels = useMemo<BoardRowModel[]>(
    () => groups.flatMap((group) => (collapsedTeams.has(group.key) ? [] : group.rows)),
    [collapsedTeams, groups],
  );
  const jobsByRow = useMemo(() => {
    const map = new Map<string, CalendarJob[]>();
    for (const model of rowModels) {
      const rowJobs = visibleJobs.filter((job) => rowOwnsJob(model, job) && (preferences.dispatchStates.length === 0 || dispatchStateMatches(dispatch.get(`${job.occurrenceId}:${model.kind === 'person' ? model.row.employeeRecordId : null}`) ?? 'nicht_gesendet', preferences.dispatchStates)));
      map.set(model.key, rowJobs);
    }
    return map;
  }, [dispatch, preferences.dispatchStates, rowModels, visibleJobs]);

  const focusCard = useCallback((occurrenceId: string, employeeRecordId: string | null) => {
    requestAnimationFrame(() => {
      const selector = `[data-calendar-card][data-occurrence-id="${occurrenceId}"]${employeeRecordId ? `[data-employee-record-id="${employeeRecordId}"]` : ''}`;
      rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
    });
  }, []);

  const surface = useBoardSurface({ rootRef, highlightRef, verticalScroller, columns, rowModels, days, readOnly: actions.readOnly, mutations, parkingContexts, onPark: actions.onPark, onParkedContextMissing, focusCard });
  useDragSurface(surface);

  const scrollable = preferences.horizonWeeks > 1;
  const compact = preferences.density === 'compact';
  const headerLabels = useMemo(() => {
    const labels = new Map<string, string>();
    const year = Number(anchorIso.slice(0, 4));
    for (const holiday of getHolidayContextDays(holidays, year - 1, year + 1)) labels.set(holiday.date, holiday.name);
    for (const closure of holidays.closureDays) labels.set(closure.closureDate, closure.label ?? 'Betriebsruhe');
    return labels;
  }, [anchorIso, holidays]);

  // Arrow keys move between cells; Tab reaches the cards.
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>('[data-board-cell]');
    if (!cell || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const rowIndex = Number(cell.dataset.rowIndex);
    const columnIndex = Number(cell.dataset.columnIndex);
    const next = event.key === 'ArrowLeft' ? [rowIndex, columnIndex - 1] : event.key === 'ArrowRight' ? [rowIndex, columnIndex + 1] : event.key === 'ArrowUp' ? [rowIndex - 1, columnIndex] : [rowIndex + 1, columnIndex];
    const element = rootRef.current?.querySelector<HTMLElement>(`[data-board-cell][data-row-index="${next[0]}"][data-column-index="${next[1]}"]`);
    if (element) { event.preventDefault(); element.focus(); }
  }, []);

  const todayIndex = columns.findIndex((column) => column.isToday);
  const nowOffset = useMemo(() => {
    if (todayIndex < 0) return null;
    const now = new Date(nowTick);
    return (now.getHours() * 60 + now.getMinutes()) / (24 * 60);
  }, [nowTick, todayIndex]);

  if (phone) {
    return <PhoneBoard columns={columns} rowModels={rowModels} jobsByRow={jobsByRow} dispatch={dispatch} materialDemandJobIds={materialDemandJobIds} actions={actions} headerLabels={headerLabels} />;
  }

  let rowCounter = 0;
  return (
    <div
      ref={rootRef}
      role="grid"
      aria-label="Plantafel"
      aria-readonly={actions.readOnly || undefined}
      data-plantafel=""
      data-density={preferences.density}
      className="relative min-w-0"
      onKeyDown={handleKeyDown}
    >
      <div className="min-w-0">
        <div className="relative" style={{ minWidth: scrollable ? BOARD_NAME_COLUMN_PX + columns.length * BOARD_COLUMN_MIN_PX : undefined }}>
          <BoardHeader columns={columns} scrollable={scrollable} labels={headerLabels} nowOffset={nowOffset} todayIndex={todayIndex} />
          <div role="rowgroup">
            {groups.map((group) => {
              const collapsed = collapsedTeams.has(group.key);
              const showHeader = group.key !== 'unassigned';
              return (
                <div key={group.key} data-board-team={group.key}>
                  {showHeader && (
                    <div role="row" className="grid" style={{ gridTemplateColumns: `${BOARD_NAME_COLUMN_PX}px 1fr` }}>
                      <button
                        type="button"
                        role="rowheader"
                        aria-expanded={!collapsed}
                        className={cn('sticky left-0 flex h-7 items-center gap-1 border-b border-r border-calendar-grid-strong bg-calendar-gutter px-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', CALENDAR_LAYER_CLASS.sticky)}
                        onClick={() => setCollapsedTeams((previous) => { const next = new Set(previous); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })}
                      >
                        {collapsed ? <ChevronRight className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
                        <span className="truncate">{group.name}</span>
                        <span className="ml-auto tabular-nums">{group.rows.length}</span>
                      </button>
                      <div className="border-b border-calendar-grid bg-calendar-gutter" aria-hidden="true" />
                    </div>
                  )}
                  {!collapsed && group.rows.map((model) => {
                    const rowIndex = rowCounter;
                    rowCounter += 1;
                    return (
                      <BoardRow
                        key={model.key}
                        model={model}
                        rowIndex={rowIndex}
                        columns={columns}
                        jobs={jobsByRow.get(model.key) ?? []}
                        vacation={vacation}
                        sickness={sickness}
                        days={days}
                        planned={planned}
                        actual={actual}
                        dispatch={dispatch}
                        materialDemandJobIds={materialDemandJobIds}
                        compact={compact}
                        scrollable={scrollable}
                        actions={actions}
                        startDrag={startDrag}
                        hoveredOccurrenceId={hoveredOccurrenceId}
                        onHoverLink={setHoveredOccurrenceId}
                        isolate={onIsolateRow}
                      />
                    );
                  })}
                </div>
              );
            })}
            {rowModels.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Keine Zeilen für diese Auswahl. Prüfe Filter und Suche.</p>
            )}
          </div>
          <div
            ref={highlightRef}
            hidden
            aria-hidden="true"
            data-board-highlight=""
            data-state="valid"
            className={cn('pointer-events-none absolute left-0 top-0 rounded-sm ring-2 ring-inset will-change-transform data-[state=valid]:bg-calendar-drop-valid data-[state=valid]:ring-success data-[state=refused]:bg-calendar-drop-refused data-[state=refused]:ring-destructive', CALENDAR_LAYER_CLASS.overlay)}
          />
        </div>
      </div>
    </div>
  );
}

function BoardHeader({ columns, scrollable, labels, nowOffset, todayIndex }: { columns: BoardColumn[]; scrollable: boolean; labels: ReadonlyMap<string, string>; nowOffset: number | null; todayIndex: number }): React.JSX.Element {
  return (
    <div
      role="row"
      className={cn('sticky top-0 grid bg-background', CALENDAR_LAYER_CLASS.sticky)}
      style={{ gridTemplateColumns: `${BOARD_NAME_COLUMN_PX}px repeat(${columns.length}, minmax(${scrollable ? BOARD_COLUMN_MIN_PX : 0}px, 1fr))` }}
    >
      <div role="columnheader" className={cn('sticky left-0 flex items-end border-b border-r border-calendar-grid-strong bg-calendar-gutter px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground', CALENDAR_LAYER_CLASS.sticky)}>
        Mitarbeiter
      </div>
      {columns.map((column, index) => {
        const label = labels.get(column.date);
        return (
          <div
            key={column.date}
            role="columnheader"
            data-board-column={column.date}
            className={cn('relative flex min-w-0 flex-col items-center justify-end gap-0.5 border-b border-r border-calendar-grid px-1 pb-1 pt-1.5', (column.isWeekend || label) && 'bg-calendar-cell-off', column.isToday && 'bg-calendar-today')}
            title={label ?? undefined}
          >
            <span className="text-[11px] uppercase text-muted-foreground">{WEEKDAY_SHORT[column.weekday]}</span>
            <span className={cn('flex size-6 items-center justify-center rounded-full text-sm tabular-nums', column.isToday ? 'bg-calendar-planning-strong font-semibold text-calendar-planning-strong-foreground' : 'font-medium')}>
              {Number(column.date.slice(8, 10))}
            </span>
            {label && <span className="max-w-full truncate text-[11px] text-calendar-holiday-foreground" aria-label={`${formatRefusalDate(column.date)}: ${label}`}>{label}</span>}
            {column.isToday && nowOffset !== null && index === todayIndex && (
              <NowIndicator orientation="vertical" offset={nowOffset * 100} unit="%" className="top-auto bottom-0 h-2" />
            )}
          </div>
        );
      })}
    </div>
  );
}


function PhoneBoard({ columns, rowModels, jobsByRow, dispatch, materialDemandJobIds, actions, headerLabels }: {
  columns: BoardColumn[];
  rowModels: BoardRowModel[];
  jobsByRow: ReadonlyMap<string, CalendarJob[]>;
  dispatch: ReadonlyMap<string, 'ausstehend' | 'bestaetigt' | 'uebernommen' | 'rueckfrage' | 'nicht_moeglich'>;
  materialDemandJobIds: ReadonlySet<string>;
  actions: CalendarSurfaceActions;
  headerLabels: ReadonlyMap<string, string>;
}): React.JSX.Element {
  const model = rowModels[0];
  const rowJobs = model ? jobsByRow.get(model.key) ?? [] : [];
  const recordId = model?.kind === 'person' ? model.row.employeeRecordId : null;
  return (
    <div data-plantafel="" data-layout="list" className="divide-y" aria-label="Woche">
      {columns.map((column) => {
        const dayJobs = rowJobs.filter((job) => job.plannedDate && column.date >= job.plannedDate && column.date < (job.endDateExclusive ?? `${job.plannedDate}!`));
        const label = headerLabels.get(column.date);
        return (
          <section key={column.date} className={cn('space-y-1.5 px-4 py-2', column.isToday && 'bg-calendar-today')} aria-label={`${WEEKDAY_SHORT[column.weekday]} ${formatRefusalDate(column.date)}`}>
            <h3 className="flex items-baseline gap-2 text-sm">
              <span className={cn('font-medium', column.isToday && 'text-calendar-planning-strong')}>{WEEKDAY_SHORT[column.weekday]} {formatRefusalDate(column.date)}</span>
              {label && <span className="text-[11px] text-muted-foreground">{label}</span>}
            </h3>
            {dayJobs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Keine Termine</p>
            ) : dayJobs.map((job) => (
              <CalendarCard
                key={job.id}
                job={job}
                size="board"
                chips={isNoteEntry(job) || job.entryKind === 'internal' ? [] : [dispatchChip(dispatch.get(`${job.occurrenceId}:${recordId}`) ?? 'nicht_gesendet'), ...readinessChips(materialDemandJobIds.has(job.jobId ?? ''))]}
                className="min-h-11 w-full"
                onOpen={(element) => actions.onOpenCard(job, element, model?.kind === 'person' ? model.row : null)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import type { CalendarBoardContext } from '@/lib/calendar/board';
import { boardArrowTarget } from '@/lib/calendar/board-row-filters';
import type { CalendarPreferences } from '@/lib/calendar/preferences';
import type { CalendarJob } from '@/lib/jobs/types';
import type { OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import type { SicknessCalendarEntry } from '@/lib/sickness/actions';
import type { TimeEntry } from '@/lib/time-tracking/types';
import type { VacationCalendarEntry } from '@/lib/vacation/actions';
import type { JobParkingContext } from '@/lib/parking/types';
import { useCalendarDrag, useDragSurface } from '../drag-engine/drag-engine';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';
import { CALENDAR_LAYER_CLASS } from '../surface/layers';
import { useClock, useNowTick } from '../surface/use-now-tick';
import { BoardHeader, useBoardHeaderLabels } from './board-header';
import { BoardRow } from './board-row';
import { BoardTeamHeader } from './board-team-header';
import { PhoneBoard } from './phone-board';
import { BOARD_COLUMN_MIN_PX, BOARD_NAME_COLUMN_PX, type CalendarSurfaceActions } from './types';
import { useBoardSurface } from './use-board-surface';
import { usePlantafelModel } from './use-plantafel-model';

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
  /** Phone width: every visible row renders as one day list (names per card when there is more than one row), never a cropped grid. */
  phone: boolean;
};

/**
 * One stable handler that calls the latest row isolation. The calendar passes
 * a new function on every render, such as the one an opened card causes, and
 * a new handler would render every memoized row again.
 */
function useStableIsolate(
  onIsolateRow: (employeeRecordId: string) => void,
): (employeeRecordId: string) => void {
  const latest = useRef(onIsolateRow);
  useLayoutEffect(() => {
    latest.current = onIsolateRow;
  });
  return useCallback((employeeRecordId: string) => latest.current(employeeRecordId), []);
}

/**
 * The Plantafel (P1-24a, criteria 1 to 22): people rows against day
 * columns over one to six weeks, one CSS grid per row, capacity per cell,
 * absences and holidays as bars, cards with the dispatch chip, and every
 * drop through the shared engine and the optimistic owner.
 */
export function Plantafel(props: PlantafelProps): React.JSX.Element {
  const {
    anchorIso,
    todayIso,
    preferences,
    showActualTime,
    board,
    jobs,
    entries,
    vacation,
    sickness,
    holidays,
    mutations,
    parkingContexts,
    onParkedContextMissing,
    actions,
    verticalScroller,
    onIsolateRow,
    phone,
  } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const { startDrag } = useCalendarDrag();
  const [collapsedTeams, setCollapsedTeams] = useState<ReadonlySet<string>>(() => new Set());
  const [hoveredOccurrenceId, setHoveredOccurrenceId] = useState<string | null>(null);
  const nowTick = useNowTick();
  const clock = useClock();
  const isolateRow = useStableIsolate(onIsolateRow);

  const { columns, days, dispatch, materialDemandJobIds, planned, actual, groups, rowModels, jobsByRow } =
    usePlantafelModel({
      anchorIso,
      todayIso,
      preferences,
      showActualTime,
      board,
      jobs,
      entries,
      nowTick,
      isManager: actions.isManager,
      collapsedTeams,
    });

  const focusCard = useCallback((occurrenceId: string, employeeRecordId: string | null) => {
    requestAnimationFrame(() => {
      const selector = `[data-calendar-card][data-occurrence-id="${occurrenceId}"]${employeeRecordId ? `[data-employee-record-id="${employeeRecordId}"]` : ''}`;
      // eslint-disable-next-line no-restricted-syntax -- focus return to a moved card on the board, not a validation path
      rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
    });
  }, []);

  const surface = useBoardSurface({
    rootRef,
    highlightRef,
    verticalScroller,
    columns,
    rowModels,
    days,
    nowMs: clock,
    mutations,
    parkingContexts,
    onPark: actions.onPark,
    onParkedContextMissing,
    focusCard,
  });
  useDragSurface(surface);

  const scrollable = preferences.horizonWeeks > 1;
  const compact = preferences.density === 'compact';
  const headerLabels = useBoardHeaderLabels(anchorIso, holidays);

  // Arrow keys move between cells; Tab reaches the cards.
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>('[data-board-cell]');
    if (!cell) return;
    const next = boardArrowTarget(event.key, Number(cell.dataset.rowIndex), Number(cell.dataset.columnIndex));
    if (!next) return;
    const element = rootRef.current?.querySelector<HTMLElement>(
      `[data-board-cell][data-row-index="${next[0]}"][data-column-index="${next[1]}"]`,
    );
    if (element) {
      event.preventDefault();
      element.focus();
    }
  }, []);

  if (phone) {
    return (
      <PhoneBoard
        columns={columns}
        rowModels={rowModels}
        jobsByRow={jobsByRow}
        vacation={vacation}
        sickness={sickness}
        dispatch={dispatch}
        materialDemandJobIds={materialDemandJobIds}
        actions={actions}
        headerLabels={headerLabels}
      />
    );
  }

  let rowCounter = 0;
  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- APG grid with roving focus: the cells take tabIndex (board-cell.tsx), the grid itself is no tab stop
    <div
      ref={rootRef}
      role="grid"
      aria-label="Plantafel"
      data-plantafel=""
      data-density={preferences.density}
      className="relative min-w-0"
      onKeyDown={handleKeyDown}
    >
      <div className="min-w-0">
        <div
          className="relative"
          style={{
            minWidth: scrollable ? BOARD_NAME_COLUMN_PX + columns.length * BOARD_COLUMN_MIN_PX : undefined,
          }}
        >
          <BoardHeader columns={columns} scrollable={scrollable} labels={headerLabels} />
          <div role="rowgroup">
            {groups.map((group) => {
              const collapsed = collapsedTeams.has(group.key);
              const showHeader = group.key !== 'unassigned';
              return (
                <div key={group.key} data-board-team={group.key}>
                  {showHeader && (
                    <BoardTeamHeader
                      group={group}
                      collapsed={collapsed}
                      setCollapsedTeams={setCollapsedTeams}
                    />
                  )}
                  {!collapsed &&
                    group.rows.map((model) => {
                      const rowIndex = rowCounter;
                      rowCounter += 1;
                      return (
                        <BoardRow
                          key={model.key}
                          model={model}
                          nowMs={nowTick}
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
                          isolate={isolateRow}
                        />
                      );
                    })}
                </div>
              );
            })}
            {rowModels.length === 0 && (
              <EmptyState title="Keine Zeilen für diese Auswahl" description="Prüfe Filter und Suche." />
            )}
          </div>
          <div
            ref={highlightRef}
            hidden
            aria-hidden="true"
            data-board-highlight=""
            data-state="valid"
            className={cn(
              'pointer-events-none absolute left-0 top-0 rounded-sm ring-2 ring-inset will-change-transform data-[state=valid]:bg-calendar-drop-valid data-[state=valid]:ring-success data-[state=refused]:bg-calendar-drop-refused data-[state=refused]:ring-destructive',
              CALENDAR_LAYER_CLASS.overlay,
            )}
          />
        </div>
      </div>
    </div>
  );
}

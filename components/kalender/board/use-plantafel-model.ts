'use client';

import { useMemo } from 'react';
import {
  boardDayKey,
  indexBoardDays,
  indexBoardDispatch,
  plannedMinutesByEmployeeDate,
  type CalendarBoardContext,
  type CalendarBoardDay,
} from '@/lib/calendar/board';
import { boardColumns, type BoardColumn } from '@/lib/calendar/board-layout';
import type { DispatchRecipientDerivedState } from '@/lib/dispatch/types';
import {
  actualMinutesByUserDate,
  groupBoardRows,
  matchesBoardSearch,
  plannedWorkDays,
  type BoardRowModel,
  type BoardTeamGroup,
} from '@/lib/calendar/board-model';
import { boardJobsByRow, filterBoardGroups } from '@/lib/calendar/board-row-filters';
import type { CalendarPreferences } from '@/lib/calendar/preferences';
import type { CalendarJob } from '@/lib/jobs/types';
import { DEFAULT_DAILY_TARGET_MINUTES } from '@/lib/personnel/targets';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { useBoardAbsences } from '../board-absences-context';

type PlantafelModelInput = {
  anchorIso: string;
  todayIso: string;
  preferences: CalendarPreferences;
  showActualTime: boolean;
  board: CalendarBoardContext;
  jobs: CalendarJob[];
  entries: TimeEntry[];
  /** The minute tick that refreshes the actual-time totals. */
  nowTick: number;
  isManager: boolean;
  collapsedTeams: ReadonlySet<string>;
};

/** The lookups of the board context, each memoized on its own source. */
function useBoardIndexes(board: CalendarBoardContext) {
  const days = useMemo(() => indexBoardDays(board.days), [board.days]);
  const dispatch = useMemo(() => indexBoardDispatch(board.dispatch), [board.dispatch]);
  const materialDemandJobIds = useMemo(
    () => new Set(board.materialDemandJobIds),
    [board.materialDemandJobIds],
  );
  const recordIdByUserId = useMemo(
    () =>
      new Map(board.rows.flatMap((row) => (row.userId ? [[row.userId, row.employeeRecordId] as const] : []))),
    [board.rows],
  );
  return { days, dispatch, materialDemandJobIds, recordIdByUserId };
}

/** Planned minutes and work per person-day from the window's visits, and recorded minutes while the toggle is on. */
function useBoardMinutes(input: {
  jobs: CalendarJob[];
  entries: TimeEntry[];
  days: ReadonlyMap<string, CalendarBoardDay>;
  recordIdByUserId: ReadonlyMap<string, string>;
  showActualTime: boolean;
  nowTick: number;
}) {
  const { jobs, entries, days, recordIdByUserId, showActualTime, nowTick } = input;
  const planned = useMemo(
    () =>
      plannedMinutesByEmployeeDate(
        jobs,
        (record, date) => days.get(boardDayKey(record, date))?.targetMinutes ?? DEFAULT_DAILY_TARGET_MINUTES,
        recordIdByUserId,
      ),
    [days, jobs, recordIdByUserId],
  );
  const actual = useMemo(
    () => (showActualTime ? actualMinutesByUserDate(entries, new Date(nowTick)) : null),
    [entries, nowTick, showActualTime],
  );
  const workDays = useMemo(() => plannedWorkDays(jobs, recordIdByUserId), [jobs, recordIdByUserId]);
  return { planned, actual, workDays };
}

type BoardRowCardsInput = Pick<
  PlantafelModelInput,
  'preferences' | 'board' | 'jobs' | 'isManager' | 'collapsedTeams'
> & {
  columns: BoardColumn[];
  days: ReadonlyMap<string, CalendarBoardDay>;
  planned: ReadonlyMap<string, number>;
  workDays: ReadonlySet<string>;
  dispatch: ReadonlyMap<string, DispatchRecipientDerivedState>;
};

/** The search-filtered cards, the filtered team groups, the visible rows and each row's cards. */
function useBoardRowCards(input: BoardRowCardsInput) {
  const { preferences, board, jobs, isManager, collapsedTeams, columns, days, planned, workDays, dispatch } =
    input;
  const { people } = useBoardAbsences();
  const visibleJobs = useMemo(
    () => (preferences.showJobs ? jobs.filter((job) => matchesBoardSearch(job, preferences.search)) : []),
    [jobs, preferences.search, preferences.showJobs],
  );

  // „Nur Konflikte" keeps rows with an overbooked day, a challenge or a visit missing its person; a dispatch filter keeps rows with a matching card.
  const groups = useMemo<BoardTeamGroup[]>(
    () =>
      filterBoardGroups({
        groups: groupBoardRows({
          rows: board.rows,
          includeUnassigned: isManager,
          memberUserIds: preferences.memberUserIds,
          teamIds: preferences.teamIds,
        }),
        visibleJobs,
        columns,
        days,
        planned,
        workDays,
        dispatch,
        dispatchStates: preferences.dispatchStates,
        onlyConflicts: preferences.onlyConflicts,
        people,
      }),
    [
      isManager,
      people,
      board.rows,
      columns,
      days,
      dispatch,
      planned,
      workDays,
      preferences.dispatchStates,
      preferences.memberUserIds,
      preferences.onlyConflicts,
      preferences.teamIds,
      visibleJobs,
    ],
  );

  const rowModels = useMemo<BoardRowModel[]>(
    () => groups.flatMap((group) => (collapsedTeams.has(group.key) ? [] : group.rows)),
    [collapsedTeams, groups],
  );
  const jobsByRow = useMemo(
    () =>
      boardJobsByRow({
        rowModels,
        visibleJobs,
        dispatch,
        dispatchStates: preferences.dispatchStates,
        people,
      }),
    [dispatch, people, preferences.dispatchStates, rowModels, visibleJobs],
  );
  return { visibleJobs, groups, rowModels, jobsByRow };
}

/**
 * The Plantafel's derived data (P1-24a): columns, the day and dispatch
 * indexes, planned and actual minutes, the filtered team groups, the visible
 * rows and each row's cards. Every value is memoized on its own inputs, so a
 * row only re-renders when something it shows changes.
 */
export function usePlantafelModel(input: PlantafelModelInput) {
  const { anchorIso, todayIso, preferences, showActualTime, board, jobs, entries, nowTick, isManager } =
    input;
  const { collapsedTeams } = input;
  const columns = useMemo(
    () =>
      boardColumns({
        anchorIso,
        horizonWeeks: preferences.horizonWeeks,
        hideWeekends: preferences.hideWeekends,
        todayIso,
      }),
    [anchorIso, preferences.hideWeekends, preferences.horizonWeeks, todayIso],
  );
  const { days, dispatch, materialDemandJobIds, recordIdByUserId } = useBoardIndexes(board);
  const { planned, actual, workDays } = useBoardMinutes({
    jobs,
    entries,
    days,
    recordIdByUserId,
    showActualTime,
    nowTick,
  });

  const { groups, rowModels, jobsByRow } = useBoardRowCards({
    preferences,
    board,
    jobs,
    isManager,
    collapsedTeams,
    columns,
    days,
    planned,
    workDays,
    dispatch,
  });

  return {
    columns,
    days,
    dispatch,
    materialDemandJobIds,
    planned,
    workDays,
    actual,
    groups,
    rowModels,
    jobsByRow,
  };
}

export type PlantafelModel = ReturnType<typeof usePlantafelModel>;

'use client';

import { useMemo } from 'react';
import {
  boardDayKey,
  indexBoardDays,
  indexBoardDispatch,
  plannedMinutesByEmployeeDate,
  type CalendarBoardContext,
} from '@/lib/calendar/board';
import { boardColumns } from '@/lib/calendar/board-layout';
import {
  actualMinutesByUserDate,
  groupBoardRows,
  matchesBoardSearch,
  type BoardRowModel,
  type BoardTeamGroup,
} from '@/lib/calendar/board-model';
import { boardJobsByRow, filterBoardGroups } from '@/lib/calendar/board-row-filters';
import type { CalendarPreferences } from '@/lib/calendar/preferences';
import type { CalendarJob } from '@/lib/jobs/types';
import type { TimeEntry } from '@/lib/time-tracking/types';

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
  const planned = useMemo(
    () =>
      plannedMinutesByEmployeeDate(
        jobs,
        (record, date) => days.get(boardDayKey(record, date))?.targetMinutes ?? 480,
        recordIdByUserId,
      ),
    [days, jobs, recordIdByUserId],
  );
  const actual = useMemo(
    () => (showActualTime ? actualMinutesByUserDate(entries, new Date(nowTick)) : null),
    [entries, nowTick, showActualTime],
  );

  const visibleJobs = useMemo(
    () => (preferences.showJobs ? jobs.filter((job) => matchesBoardSearch(job, preferences.search)) : []),
    [jobs, preferences.search, preferences.showJobs],
  );

  // „Nur Konflikte" keeps rows with an overbooked day or a challenge; a dispatch filter keeps rows with a matching card.
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
        dispatch,
        dispatchStates: preferences.dispatchStates,
        onlyConflicts: preferences.onlyConflicts,
      }),
    [
      isManager,
      board.rows,
      columns,
      days,
      dispatch,
      planned,
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
    () => boardJobsByRow({ rowModels, visibleJobs, dispatch, dispatchStates: preferences.dispatchStates }),
    [dispatch, preferences.dispatchStates, rowModels, visibleJobs],
  );

  return { columns, days, dispatch, materialDemandJobIds, planned, actual, groups, rowModels, jobsByRow };
}

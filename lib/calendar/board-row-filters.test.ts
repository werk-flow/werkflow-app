import { describe, expect, test } from 'bun:test';
import type { CalendarBoardDay, CalendarBoardRow } from './board';
import type { BoardRowModel, BoardTeamGroup } from './board-model';
import { boardArrowTarget, boardJobsByRow, filterBoardGroups } from './board-row-filters';
import type { DispatchRecipientDerivedState } from '@/lib/dispatch/types';
import type { CalendarJob } from '@/lib/jobs/types';

const person = (employeeRecordId: string): BoardRowModel => {
  const row: CalendarBoardRow = {
    employeeRecordId,
    userId: `user-${employeeRecordId}`,
    displayName: employeeRecordId,
    role: 'employee',
    hasLogin: true,
    teamId: null,
    teamName: null,
    entryDate: null,
    exitDate: null,
  };
  return { key: employeeRecordId, kind: 'person', row };
};
const unassigned: BoardRowModel = { key: 'unassigned', kind: 'unassigned', row: null };

const job = (occurrenceId: string, assignedEmployeeRecordIds: string[]): CalendarJob => ({
  id: occurrenceId,
  occurrenceId,
  title: 'Wartung Heizung',
  jobNumber: 'AUF-1',
  status: 'nicht_bearbeitet',
  executionState: null,
  priority: 'mittel',
  plannedDate: '2026-10-05',
  plannedTime: '09:00',
  estimatedDurationMinutes: 60,
  plannedWorkingMinutes: null,
  location: 'Berlin',
  clientName: 'Müller GmbH',
  clientAddress: null,
  projectName: null,
  projectNumber: null,
  assignedUserIds: [],
  assignedEmployeeRecordIds,
});

const day = (employeeRecordId: string, date: string, targetMinutes: number): CalendarBoardDay => ({
  employeeRecordId,
  date,
  targetMinutes,
  baseTargetMinutes: targetMinutes,
  reason: 'working',
  label: null,
  absence: null,
  pendingVacation: false,
});

const groups: BoardTeamGroup[] = [
  { key: 'team', name: 'Team', rows: [person('a'), person('b')] },
  { key: 'unassigned', name: 'Ohne Zuweisung', rows: [unassigned] },
];
const jobs = [job('o1', ['a']), job('o2', ['b']), job('o3', [])];
const columns = [{ date: '2026-10-05' }];
const noDays = new Map<string, CalendarBoardDay>();
const noPlanned = new Map<string, number>();

function dispatchIndex(entries: Array<[string, DispatchRecipientDerivedState]>) {
  return new Map(entries);
}

describe('board group filters', () => {
  test('returns the same groups when no filter is active', () => {
    const result = filterBoardGroups({
      groups,
      visibleJobs: jobs,
      columns,
      days: noDays,
      planned: noPlanned,
      dispatch: dispatchIndex([]),
      dispatchStates: [],
      onlyConflicts: false,
    });
    expect(result).toBe(groups);
  });

  test('keeps rows with a card in a selected dispatch state and reads a missing state as not sent', () => {
    const result = filterBoardGroups({
      groups,
      visibleJobs: jobs,
      columns,
      days: noDays,
      planned: noPlanned,
      dispatch: dispatchIndex([['o1:a', 'bestaetigt']]),
      dispatchStates: ['nicht_gesendet'],
      onlyConflicts: false,
    });
    expect(result.map((group) => group.rows.map((row) => row.key))).toEqual([['b'], ['unassigned']]);
  });

  test('„Nur Konflikte" keeps overbooked or challenged person rows and drops empty groups', () => {
    const result = filterBoardGroups({
      groups,
      visibleJobs: jobs,
      columns,
      days: new Map([['a:2026-10-05', day('a', '2026-10-05', 60)]]),
      planned: new Map([['a:2026-10-05', 240]]),
      dispatch: dispatchIndex([['o2:b', 'rueckfrage']]),
      dispatchStates: [],
      onlyConflicts: true,
    });
    expect(result.map((group) => group.rows.map((row) => row.key))).toEqual([['a', 'b']]);
  });
});

describe('board jobs by row', () => {
  test('gives each row its own cards, narrowed to the selected dispatch states', () => {
    const rows = [person('a'), person('b'), unassigned];
    const all = boardJobsByRow({
      rowModels: rows,
      visibleJobs: jobs,
      dispatch: dispatchIndex([]),
      dispatchStates: [],
    });
    expect([...all].map(([key, rowJobs]) => [key, rowJobs.map((entry) => entry.id)])).toEqual([
      ['a', ['o1']],
      ['b', ['o2']],
      ['unassigned', ['o3']],
    ]);
    const confirmed = boardJobsByRow({
      rowModels: rows,
      visibleJobs: jobs,
      dispatch: dispatchIndex([['o1:a', 'bestaetigt']]),
      dispatchStates: ['bestaetigt'],
    });
    expect(confirmed.get('a')?.map((entry) => entry.id)).toEqual(['o1']);
    expect(confirmed.get('b')).toEqual([]);
  });
});

describe('board arrow navigation', () => {
  test('moves one cell per arrow key and ignores other keys', () => {
    expect(boardArrowTarget('ArrowLeft', 2, 3)).toEqual([2, 2]);
    expect(boardArrowTarget('ArrowRight', 2, 3)).toEqual([2, 4]);
    expect(boardArrowTarget('ArrowUp', 2, 3)).toEqual([1, 3]);
    expect(boardArrowTarget('ArrowDown', 2, 3)).toEqual([3, 3]);
    expect(boardArrowTarget('Enter', 2, 3)).toBeNull();
  });
});

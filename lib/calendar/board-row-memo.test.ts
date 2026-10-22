import { describe, expect, test } from 'bun:test';

import { memoPropsEqual } from '@/lib/ui/memo-equality';
import type { CalendarJob } from '@/lib/jobs/types';
import type { CalendarBoardDay, CalendarBoardRow } from './board';
import type { BoardColumn } from './board-layout';
import type { BoardRowModel } from './board-model';
import { BOARD_ROW_CONTENT_CHECKS, type BoardRowContent } from './board-row-memo';

// Tier 2 for the Plantafel row memo (performance.md, "Improve a flow"): a
// row renders again whenever anything it shows changes, and only then. The
// board rebuilds its models, row lists and indexes for every row on each
// change, so each check must tell this row's change from another row's.

type RowProps = BoardRowContent & { compact: boolean; onOpen: () => void };

const sameRow = memoPropsEqual<RowProps>(BOARD_ROW_CONTENT_CHECKS);

const boardRow = (employeeRecordId: string): CalendarBoardRow => ({
  employeeRecordId,
  userId: `user-${employeeRecordId}`,
  displayName: employeeRecordId,
  role: 'employee',
  hasLogin: true,
  teamId: null,
  teamName: null,
  entryDate: null,
  exitDate: null,
});

const columns: BoardColumn[] = [
  { date: '2026-10-05', weekday: 0, isWeekend: false, isToday: false },
  { date: '2026-10-06', weekday: 1, isWeekend: false, isToday: true },
];

const card = (occurrenceId: string, plannedTime = '09:00'): CalendarJob => ({
  id: occurrenceId,
  occurrenceId,
  jobId: `job-${occurrenceId}`,
  title: 'Wartung Heizung',
  jobNumber: 'AUF-1',
  status: 'nicht_bearbeitet',
  executionState: null,
  priority: 'mittel',
  plannedDate: '2026-10-05',
  plannedTime,
  estimatedDurationMinutes: 60,
  plannedWorkingMinutes: null,
  location: 'Berlin',
  clientName: 'Müller GmbH',
  clientAddress: null,
  projectName: null,
  projectNumber: null,
  assignedUserIds: [],
  assignedEmployeeRecordIds: ['a', 'b'],
});

const day = (employeeRecordId: string, date: string): CalendarBoardDay => ({
  employeeRecordId,
  date,
  targetMinutes: 480,
  baseTargetMinutes: 480,
  reason: 'working',
  label: null,
  absence: null,
  pendingVacation: false,
});

const rowA = boardRow('a');
const jobs = [card('o1'), card('o2', '15:00')];
const beforeStart = Date.parse('2026-10-05T06:00:00Z');

function rowProps(): RowProps {
  return {
    model: { key: 'a', kind: 'person', row: rowA },
    columns,
    jobs,
    days: new Map(columns.map((column) => [`a:${column.date}`, day('a', column.date)])),
    planned: new Map([['a:2026-10-05', 120]]),
    actual: new Map([['user-a:2026-10-05', { minutes: 30, pending: false }]]),
    dispatch: new Map([['o1:a', 'ausstehend']]),
    materialDemandJobIds: new Set(['job-o1']),
    nowMs: beforeStart,
    hoveredOccurrenceId: null,
    compact: false,
    onOpen: () => undefined,
  };
}

/** The same row as the board rebuilds it after another row's change: new containers, the same shown values. */
function rebuilt(props: RowProps): RowProps {
  return {
    ...props,
    model: { key: 'a', kind: 'person', row: rowA },
    jobs: [...props.jobs],
    days: new Map([...props.days, ['b:2026-10-05', day('b', '2026-10-05')]]),
    planned: new Map([...props.planned, ['b:2026-10-05', 60]]),
    actual: new Map([...(props.actual ?? [])].map(([key, value]) => [key, { ...value }] as const)),
    dispatch: new Map([...props.dispatch, ['o9:b', 'bestaetigt']]),
    materialDemandJobIds: new Set([...props.materialDemandJobIds, 'job-o9']),
    hoveredOccurrenceId: 'o9',
  };
}

describe('a Plantafel row', () => {
  const previous = rowProps();

  test('keeps its render when only other rows changed', () => {
    expect(sameRow(previous, rebuilt(previous))).toBe(true);
  });

  test.each<[string, (props: RowProps) => RowProps]>([
    ['its person', (props) => ({ ...props, model: { key: 'a', kind: 'person', row: { ...rowA } } })],
    ['a card', (props) => ({ ...props, jobs: [card('o1'), props.jobs[1] ?? card('o2')] })],
    ['a card added', (props) => ({ ...props, jobs: [...props.jobs, card('o3')] })],
    [
      'its person-day',
      (props) => ({ ...props, days: new Map([...props.days, ['a:2026-10-06', day('a', '2026-10-06')]]) }),
    ],
    ['its planned minutes', (props) => ({ ...props, planned: new Map([['a:2026-10-05', 180]]) })],
    [
      'its recorded minutes',
      (props) => ({ ...props, actual: new Map([['user-a:2026-10-05', { minutes: 45, pending: false }]]) }),
    ],
    ['the recorded-time toggle', (props) => ({ ...props, actual: null })],
    ['a card dispatch state', (props) => ({ ...props, dispatch: new Map([['o1:a', 'bestaetigt']]) })],
    ['a card material flag', (props) => ({ ...props, materialDemandJobIds: new Set<string>() })],
    ['a card starting', (props) => ({ ...props, nowMs: Date.parse('2026-10-05T08:00:00Z') })],
    ['the hover on its card', (props) => ({ ...props, hoveredOccurrenceId: 'o1' })],
    ['a prop without a content check', (props) => ({ ...props, onOpen: () => undefined })],
  ])('renders again when %s changes', (_, change) => {
    expect(sameRow(previous, change(previous))).toBe(false);
  });

  test('keeps its render while the clock passes no card start', () => {
    expect(sameRow(previous, { ...previous, nowMs: beforeStart + 60_000 })).toBe(true);
  });

  test('the unassigned row shows no person-days', () => {
    const unassigned: BoardRowModel = { key: 'unassigned', kind: 'unassigned', row: null };
    const props = { ...previous, model: unassigned };
    expect(sameRow(props, { ...props, days: new Map(), planned: new Map(), actual: null })).toBe(true);
  });
});

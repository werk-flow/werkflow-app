import { describe, expect, test } from 'bun:test';
import type { CalendarBoardRow } from './board';
import {
  dayRowFor,
  dayRowKey,
  deriveDayRows,
  UNASSIGNED_DAY_ROW_KEY,
  type DayRowMember,
  type DayRowsInput,
} from './day-rows';
import type { CalendarJob } from '@/lib/jobs/types';
import { getDefaultTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { TimeEntry } from '@/lib/time-tracking/types';

// The day view keys its rows by employee record like the board (P1-24a), so a
// visit planned for a personnel record without a login lands in that
// person's row, not under „Ohne Zuweisung".

const DATE = '2026-09-15';

const boardRow = (overrides: Partial<CalendarBoardRow>): CalendarBoardRow => ({
  employeeRecordId: 'r',
  userId: 'u',
  displayName: 'Person',
  role: 'employee',
  hasLogin: true,
  teamId: null,
  teamName: null,
  entryDate: null,
  exitDate: null,
  ...overrides,
});
const visit = (overrides: Partial<CalendarJob>): CalendarJob => ({
  id: 'o',
  occurrenceId: 'o',
  title: 'Wartung Heizung',
  jobNumber: 'AUF-1',
  status: 'nicht_bearbeitet',
  executionState: null,
  priority: 'mittel',
  plannedDate: DATE,
  plannedTime: '09:00',
  estimatedDurationMinutes: 60,
  plannedWorkingMinutes: null,
  location: 'Berlin',
  clientName: 'Müller GmbH',
  clientAddress: null,
  projectName: null,
  projectNumber: null,
  assignedUserIds: [],
  assignedEmployeeRecordIds: [],
  ...overrides,
});
const entry = (overrides: Partial<TimeEntry>): TimeEntry => ({
  id: 'e',
  userId: 'u-sven',
  organizationId: 'org',
  entryType: 'clock_in',
  timestamp: `${DATE}T10:00:00.000Z`,
  isManual: false,
  jobId: null,
  status: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: `${DATE}T10:00:00.000Z`,
  updatedAt: `${DATE}T10:00:00.000Z`,
  ...overrides,
});

const sven = boardRow({ employeeRecordId: 'r-sven', userId: 'u-sven', displayName: 'Sven Neumann' });
const kai = boardRow({
  employeeRecordId: 'r-kai',
  userId: null,
  displayName: 'Kai Ohnezugang',
  role: null,
  hasLogin: false,
});
const svenLogin: DayRowMember = { userId: 'u-sven', name: 'Sven Neumann', role: 'employee' };
const kaiVisit = visit({ id: 'o-kai', occurrenceId: 'o-kai', assignedEmployeeRecordIds: ['r-kai'] });
const openVisit = visit({ id: 'o-open', occurrenceId: 'o-open' });

function input(overrides: Partial<DayRowsInput>): DayRowsInput {
  return {
    boardRows: [sven, kai],
    days: new Map(),
    members: [svenLogin],
    jobs: [kaiVisit],
    entries: [],
    dateIso: DATE,
    dayStart: new Date(2026, 8, 15),
    now: new Date(2026, 8, 15, 18),
    organizationSettings: getDefaultTimeTrackingSettings('org'),
    hourWidth: 80,
    isManager: true,
    ...overrides,
  };
}

type RowVisits = { name: string; visitIds: string[] };

/** The name of the one row that holds the visit; the shared assertion of both derivations below. */
function rowNameHolding(rows: readonly RowVisits[], visitId: string): string | undefined {
  const holders = rows.filter((row) => row.visitIds.includes(visitId));
  expect(holders).toHaveLength(1);
  return holders[0]?.name;
}

function visitsByRow(dayInput: DayRowsInput): RowVisits[] {
  return deriveDayRows(dayInput).map((row) => ({
    name: row.model.name,
    visitIds: [
      ...row.untimed.map((job) => job.id),
      ...row.items.flatMap((item) => (item.kind === 'job' ? [item.job.id] : [])),
    ],
  }));
}

/**
 * Planted defect: the derivation before records got their own rows built
 * rows from logins keyed by user id and sent every visit without a user id
 * to „Ohne Zuweisung".
 */
function memberKeyedVisitsByRow(dayInput: DayRowsInput): RowVisits[] {
  const unassigned = dayInput.jobs.filter((job) => job.assignedUserIds.length === 0);
  return [
    ...(unassigned.length > 0 ? [{ name: 'Ohne Zuweisung', visitIds: unassigned.map((job) => job.id) }] : []),
    ...dayInput.members.map((member) => ({
      name: member.name,
      visitIds: dayInput.jobs
        .filter((job) => job.assignedUserIds.includes(member.userId))
        .map((job) => job.id),
    })),
  ];
}

describe('day rows', () => {
  test('a visit for a record without a login lists in that record’s row, not under „Ohne Zuweisung“', () => {
    expect(rowNameHolding(visitsByRow(input({})), 'o-kai')).toBe('Kai Ohnezugang');
    const rows = deriveDayRows(input({}));
    expect(rows.map((row) => row.model.key)).toEqual(['r-kai', 'r-sven']);
    expect(rows[0]?.model.userId).toBeNull();
  });

  test('planted defect: the member-keyed derivation puts that visit under „Ohne Zuweisung“', () => {
    expect(rowNameHolding(memberKeyedVisitsByRow(input({})), 'o-kai')).toBe('Ohne Zuweisung');
  });

  test('recorded time comes from the login, and a login without a board row keeps its own row last', () => {
    const late: DayRowMember = { userId: 'u-lea', name: 'Lea Spät', role: 'buero' };
    const rows = deriveDayRows(
      input({
        members: [late, svenLogin],
        jobs: [visit({ id: 'o-lea', occurrenceId: 'o-lea', assignedUserIds: ['u-lea'] })],
        entries: [
          entry({ id: 'in' }),
          entry({ id: 'out', entryType: 'clock_out', timestamp: `${DATE}T12:00:00.000Z` }),
        ],
      }),
    );
    expect(rows.map((row) => [row.model.key, row.role])).toEqual([
      ['r-kai', undefined],
      ['r-sven', 'employee'],
      ['member:u-lea', 'buero'],
    ]);
    expect(rows[1]?.items.map((item) => item.kind)).toEqual(['block']);
    expect(rows[2]?.items.map((item) => item.key)).toEqual(['o-lea']);
  });

  test('a manager sees „Ohne Zuweisung“ first; the member scope keeps rows without a login', () => {
    expect(deriveDayRows(input({ jobs: [openVisit] })).map((row) => row.model.key)).toEqual([
      UNASSIGNED_DAY_ROW_KEY,
      'r-kai',
      'r-sven',
    ]);
    const scoped = deriveDayRows(input({ jobs: [openVisit], isManager: false, members: [] }));
    expect(scoped.map((row) => row.model.key)).toEqual(['r-kai']);
  });

  test('a drop target resolves its row by record, then by login, then to „Ohne Zuweisung“', () => {
    const models = deriveDayRows(input({ jobs: [openVisit] })).map((row) => row.model);
    expect(dayRowFor(models, dayRowKey({ employeeRecordId: 'r-kai', userId: null }))?.name).toBe(
      'Kai Ohnezugang',
    );
    expect(dayRowKey({ employeeRecordId: null, userId: 'u-lea' })).toBe('member:u-lea');
    expect(dayRowFor(models, dayRowKey({ employeeRecordId: null, userId: null }))?.name).toBe(
      'Ohne Zuweisung',
    );
  });
});

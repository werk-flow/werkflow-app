import { describe, expect, test } from 'bun:test';
import { boardCellCapacity, type CalendarBoardDay, type CalendarBoardRow } from './board';
import { boardJobsByRow, filterBoardGroups } from './board-row-filters';
import {
  absenceItems,
  actualMinutesByUserDate,
  groupBoardRows,
  indexBoardPeople,
  matchesBoardSearch,
  occurrenceSpan,
  plannedWorkDays,
  reassignmentChanges,
  rowOwnsJob,
  unavailableAssignees,
  type BoardPeople,
  type BoardRowModel,
} from './board-model';
import type { CalendarJob } from '@/lib/jobs/types';
import type { TimeEntry } from '@/lib/time-tracking/types';

const row = (overrides: Partial<CalendarBoardRow>): CalendarBoardRow => ({
  employeeRecordId: 'r',
  userId: 'u',
  displayName: 'Person',
  role: 'employee',
  hasLogin: true,
  teamId: null,
  teamName: null,
  entryDate: null,
  exitDate: null,
  accessEndDate: null,
  ...overrides,
});
const NO_PEOPLE: BoardPeople = new Map();
const job = (overrides: Partial<CalendarJob>): CalendarJob => ({
  id: 'o',
  occurrenceId: 'o',
  title: 'Wartung Heizung',
  jobNumber: 'AUF-1',
  status: 'nicht_bearbeitet',
  executionState: null,
  priority: 'mittel',
  plannedDate: '2026-09-15',
  plannedTime: '09:00',
  estimatedDurationMinutes: 60,
  plannedWorkingMinutes: null,
  location: 'Berlin',
  clientName: 'Müller GmbH',
  clientAddress: null,
  projectName: null,
  projectNumber: null,
  assignedUserIds: ['u1'],
  assignedEmployeeRecordIds: ['r1'],
  ...overrides,
});

describe('board rows', () => {
  test('groups by team name, appends people without a team, and honours the member and team filters', () => {
    const rows = [
      row({
        employeeRecordId: 'r1',
        userId: 'u1',
        displayName: 'Sven Neumann',
        teamId: 't-heizung',
        teamName: 'Heizung',
      }),
      row({
        employeeRecordId: 'r2',
        userId: 'u2',
        displayName: 'Anna Berg',
        teamId: 't-sanitaer',
        teamName: 'Sanitär',
      }),
      row({ employeeRecordId: 'r3', userId: null, displayName: 'Ohne Login', teamId: null }),
      row({
        employeeRecordId: 'r4',
        userId: 'u4',
        displayName: 'Mia Sommer',
        teamId: 't-heizung',
        teamName: 'Heizung',
      }),
    ];
    const groups = groupBoardRows({ rows, includeUnassigned: true, memberUserIds: null, teamIds: [] });
    expect(groups.map((group) => [group.name, group.rows.map((entry) => entry.key)])).toEqual([
      ['Ohne Zuweisung', ['unassigned']],
      ['Heizung', ['r4', 'r1']],
      ['Sanitär', ['r2']],
      ['Ohne Team', ['r3']],
    ]);
    expect(
      groupBoardRows({ rows, includeUnassigned: false, memberUserIds: ['u2'], teamIds: [] }).flatMap(
        (group) => group.rows.map((entry) => entry.key),
      ),
    ).toEqual(['r2', 'r3']);
    expect(
      groupBoardRows({ rows, includeUnassigned: false, memberUserIds: null, teamIds: ['t-heizung'] }).flatMap(
        (group) => group.rows.map((entry) => entry.key),
      ),
    ).toEqual(['r4', 'r1']);
  });

  test('a card belongs to its assignees, legacy jobs by user id, and unassigned cards to the top row', () => {
    const person = { key: 'r1', kind: 'person' as const, row: row({ employeeRecordId: 'r1', userId: 'u1' }) };
    expect(rowOwnsJob(person, job({}), NO_PEOPLE)).toBe(true);
    expect(rowOwnsJob(person, job({ assignedEmployeeRecordIds: ['r2'] }), NO_PEOPLE)).toBe(false);
    expect(
      rowOwnsJob(
        person,
        job({ occurrenceId: undefined, assignedEmployeeRecordIds: undefined, assignedUserIds: ['u1'] }),
        NO_PEOPLE,
      ),
    ).toBe(true);
    expect(
      rowOwnsJob(
        { key: 'unassigned', kind: 'unassigned', row: null },
        job({ assignedEmployeeRecordIds: [], assignedUserIds: [] }),
        NO_PEOPLE,
      ),
    ).toBe(true);
    expect(rowOwnsJob({ key: 'unassigned', kind: 'unassigned', row: null }, job({}), NO_PEOPLE)).toBe(false);
  });
});

describe('board items', () => {
  test('search matches title, customer, number, place and project without case', () => {
    expect(matchesBoardSearch(job({}), 'müller')).toBe(true);
    expect(matchesBoardSearch(job({}), 'auf-1')).toBe(true);
    expect(matchesBoardSearch(job({}), 'Kessel')).toBe(false);
    expect(matchesBoardSearch(job({}), '  ')).toBe(true);
  });

  test('spans follow Berlin dates for timed occurrences and exclusive ends for all-day ones', () => {
    expect(
      occurrenceSpan(job({ startAt: '2026-09-15T07:00:00.000Z', endAt: '2026-09-15T08:00:00.000Z' })),
    ).toEqual({ key: 'o', startDate: '2026-09-15', endDateExclusive: '2026-09-16', sortMinutes: 540 });
    expect(
      occurrenceSpan(
        job({ startAt: '2026-09-15T20:00:00.000Z', endAt: '2026-09-16T01:00:00.000Z', plannedTime: '22:00' }),
      ),
    ).toEqual({ key: 'o', startDate: '2026-09-15', endDateExclusive: '2026-09-17', sortMinutes: 1320 });
    expect(
      occurrenceSpan(
        job({
          plannedTime: null,
          startAt: null,
          endAt: null,
          timeKind: 'all_day',
          plannedDate: '2026-09-16',
          endDateExclusive: '2026-09-19',
        }),
      ),
    ).toEqual({ key: 'o', startDate: '2026-09-16', endDateExclusive: '2026-09-19', sortMinutes: -1 });
    expect(occurrenceSpan(job({ plannedDate: null }))).toBeNull();
  });

  test('absences become bars for the row with their labels', () => {
    const items = absenceItems({
      vacation: [
        {
          id: 'v1',
          employeeRecordId: 'r1',
          personName: 'Sven',
          startDate: '2026-09-14',
          endDate: '2026-09-16',
          dayPortion: 'full',
          status: 'pending',
        },
      ],
      sickness: [
        {
          id: 's1',
          employeeRecordId: 'r1',
          personName: 'Sven',
          startDate: '2026-09-18',
          endDate: '2026-09-18',
          dayPortion: 'half_day',
          openEnded: true,
        },
        {
          id: 's2',
          employeeRecordId: 'r2',
          personName: 'Anna',
          startDate: '2026-09-18',
          endDate: '2026-09-18',
          dayPortion: 'full',
          openEnded: false,
        },
      ],
      employeeRecordId: 'r1',
    });
    expect(items.map((item) => [item.label, item.startDate, item.endDateExclusive, item.pending])).toEqual([
      ['Urlaub – Sven (angefragt)', '2026-09-14', '2026-09-17', true],
      ['Abwesend – Sven (halber Tag) (bis auf Weiteres)', '2026-09-18', '2026-09-19', false],
    ]);
  });

  test('actual minutes sum the work blocks per person and local date and carry the provisional flag', () => {
    const entry = (overrides: Partial<TimeEntry>): TimeEntry => ({
      id: 'e',
      userId: 'u1',
      organizationId: 'org',
      entryType: 'clock_in',
      timestamp: '2026-09-15T06:00:00.000Z',
      isManual: false,
      jobId: null,
      status: 'approved',
      reviewedBy: null,
      reviewedAt: null,
      createdAt: '2026-09-15T06:00:00.000Z',
      updatedAt: '2026-09-15T06:00:00.000Z',
      ...overrides,
    });
    const totals = actualMinutesByUserDate([
      entry({ id: 'in', timestamp: '2026-09-15T06:00:00.000Z' }),
      entry({ id: 'out', entryType: 'clock_out', timestamp: '2026-09-15T10:30:00.000Z', status: 'pending' }),
    ]);
    expect(totals.get('u1:2026-09-15')).toEqual({ minutes: 270, pending: true });
  });
});

describe('reassignment', () => {
  test('replaces the source person, adds one from the unassigned row, removes one dropped there, and reports no change', () => {
    const two = job({ assignedUserIds: ['u1', 'u2'], assignedEmployeeRecordIds: ['r1', 'r2'] });
    expect(
      reassignmentChanges({
        job: two,
        sourceEmployeeRecordId: 'r1',
        sourceUserId: 'u1',
        target: { employeeRecordId: 'r3', userId: 'u3', date: '2026-09-15' },
        people: NO_PEOPLE,
      }),
    ).toEqual({ assignedUserIds: ['u3', 'u2'], assignedEmployeeRecordIds: ['r3', 'r2'] });
    expect(
      reassignmentChanges({
        job: job({ assignedUserIds: [], assignedEmployeeRecordIds: [] }),
        sourceEmployeeRecordId: null,
        sourceUserId: null,
        target: { employeeRecordId: 'r3', userId: 'u3', date: '2026-09-16' },
        people: NO_PEOPLE,
      }),
    ).toEqual({ plannedDate: '2026-09-16', assignedUserIds: ['u3'], assignedEmployeeRecordIds: ['r3'] });
    expect(
      reassignmentChanges({
        job: two,
        sourceEmployeeRecordId: 'r2',
        sourceUserId: 'u2',
        target: { employeeRecordId: null, userId: null, date: '2026-09-15' },
        people: NO_PEOPLE,
      }),
    ).toEqual({ assignedUserIds: ['u1'], assignedEmployeeRecordIds: ['r1'] });
    expect(
      reassignmentChanges({
        job: two,
        sourceEmployeeRecordId: 'r1',
        sourceUserId: 'u1',
        target: { employeeRecordId: 'r1', userId: 'u1', date: '2026-09-15' },
        people: NO_PEOPLE,
      }),
    ).toBeNull();
    // Legacy jobs without an occurrence carry user ids only.
    expect(
      reassignmentChanges({
        job: job({ occurrenceId: undefined, assignedEmployeeRecordIds: undefined, assignedUserIds: ['u1'] }),
        sourceEmployeeRecordId: 'r1',
        sourceUserId: 'u1',
        target: { employeeRecordId: 'r2', userId: 'u2', date: '2026-09-15' },
        people: NO_PEOPLE,
      }),
    ).toEqual({ assignedUserIds: ['u2'] });
  });
});

// werk-flow/werkflow-planning#62: Erik left on 29.10.2026. The board of the week after his exit has
// no row for him, so his visits used to vanish; a shared one showed only under Anna.
describe('a person outside their employment or app access on the visit date', () => {
  const anna = row({ employeeRecordId: 'r-anna', userId: 'u-anna', displayName: 'Anna Berg' });
  const erik = {
    employeeRecordId: 'r-erik',
    userId: 'u-erik',
    displayName: 'Erik Lindner',
    entryDate: '2020-04-01',
    exitDate: '2026-10-29',
    accessEndDate: '2026-10-30',
  };
  const unassigned: BoardRowModel = { key: 'unassigned', kind: 'unassigned', row: null };
  const annaRow: BoardRowModel = { key: 'r-anna', kind: 'person', row: anna };
  // The week after the exit: Erik has no row and arrives as an assignee without one.
  const afterExit = indexBoardPeople([anna], [erik]);
  const solo = job({
    id: 'o-114',
    occurrenceId: 'o-114',
    plannedDate: '2026-11-04',
    assignedEmployeeRecordIds: ['r-erik'],
    assignedUserIds: ['u-erik'],
  });
  const shared = job({
    id: 'o-113',
    occurrenceId: 'o-113',
    plannedDate: '2026-11-03',
    assignedEmployeeRecordIds: ['r-erik', 'r-anna'],
    assignedUserIds: ['u-erik', 'u-anna'],
  });
  const cardsByRow = (people: BoardPeople, rowModels: BoardRowModel[], jobs: CalendarJob[]) =>
    boardJobsByRow({ rowModels, visibleJobs: jobs, dispatch: new Map(), dispatchStates: [], people });

  test('a solo visit after the exit shows in „Ohne Zuweisung“ and names the leaver', () => {
    const cards = cardsByRow(afterExit, [unassigned, annaRow], [solo]);
    expect(cards.get('unassigned')?.map((card) => card.id)).toEqual(['o-114']);
    expect(cards.get('r-anna')).toEqual([]);
    expect(unavailableAssignees(solo, afterExit)).toEqual([
      { employeeRecordId: 'r-erik', name: 'Erik Lindner', reason: 'after_exit' },
    ]);
  });

  test('a shared visit after the exit stays under the remaining worker and names the leaver there', () => {
    const cards = cardsByRow(afterExit, [unassigned, annaRow], [shared]);
    expect(cards.get('r-anna')?.map((card) => card.id)).toEqual(['o-113']);
    expect(cards.get('unassigned')).toEqual([]);
    expect(unavailableAssignees(shared, afterExit).map((person) => person.name)).toEqual(['Erik Lindner']);
  });

  test('in the exit week a visit on a hatched day stays in the leaver’s row, warned, and needs a person', () => {
    const erikRow = row({ ...erik, role: null, hasLogin: false });
    const exitWeek = indexBoardPeople([anna, erikRow], []);
    const onHatchedDay = job({ ...solo, id: 'o-109', occurrenceId: 'o-109', plannedDate: '2026-10-30' });
    const cards = cardsByRow(
      exitWeek,
      [unassigned, { key: 'r-erik', kind: 'person', row: erikRow }],
      [onHatchedDay],
    );
    expect(cards.get('r-erik')?.map((card) => card.id)).toEqual(['o-109']);
    expect(cards.get('unassigned')?.map((card) => card.id)).toEqual(['o-109']);
    expect(unavailableAssignees(onHatchedDay, exitWeek).map((person) => person.reason)).toEqual([
      'after_exit',
    ]);
    // The exit date itself is still a working day.
    expect(unavailableAssignees({ ...onHatchedDay, plannedDate: '2026-10-29' }, exitWeek)).toEqual([]);
  });

  test('a span reaching past the exit, an ended access and a later entry each count; history does not', () => {
    const crossing = job({
      ...solo,
      plannedTime: null,
      plannedDate: '2026-10-28',
      endDateExclusive: '2026-10-31',
    });
    expect(unavailableAssignees(crossing, afterExit).map((person) => person.reason)).toEqual(['after_exit']);
    const accessOnly = indexBoardPeople([{ ...anna, accessEndDate: '2026-11-04' }], []);
    const annaVisit = job({ plannedDate: '2026-11-04', assignedEmployeeRecordIds: ['r-anna'] });
    expect(unavailableAssignees(annaVisit, accessOnly).map((person) => person.reason)).toEqual([
      'access_ended',
    ]);
    expect(unavailableAssignees({ ...annaVisit, plannedDate: '2026-11-03' }, accessOnly)).toEqual([]);
    const starter = indexBoardPeople(
      [],
      [{ ...erik, entryDate: '2026-12-01', exitDate: null, accessEndDate: null }],
    );
    expect(unavailableAssignees(solo, starter).map((person) => person.reason)).toEqual(['before_entry']);
    expect(unavailableAssignees({ ...solo, occurrenceStatus: 'cancelled' }, afterExit)).toEqual([]);
    // A legacy job names its people by user id.
    const legacy = job({ ...solo, occurrenceId: undefined, assignedEmployeeRecordIds: undefined });
    expect(rowOwnsJob(unassigned, legacy, afterExit)).toBe(true);
  });

  test('„Nur Konflikte“ keeps the rows that hold a visit missing its person', () => {
    const groups = [
      { key: 'unassigned', name: 'Ohne Zuweisung', rows: [unassigned] },
      { key: 'no-team', name: 'Ohne Team', rows: [annaRow] },
    ];
    const kept = filterBoardGroups({
      groups,
      visibleJobs: [solo, shared],
      columns: [{ date: '2026-11-03' }, { date: '2026-11-04' }],
      days: new Map(),
      planned: new Map(),
      workDays: new Set<string>(),
      dispatch: new Map(),
      dispatchStates: [],
      onlyConflicts: true,
      people: afterExit,
    });
    expect(kept.flatMap((group) => group.rows.map((model) => model.key))).toEqual(['unassigned', 'r-anna']);
  });

  test('„Nur Konflikte“ keeps a leaver’s row whose hatched day holds work a search hides', () => {
    const erikRow = row({ ...erik, role: null, hasLogin: false });
    const hatched: CalendarBoardDay = {
      employeeRecordId: 'r-erik',
      date: '2026-10-31',
      targetMinutes: 0,
      baseTargetMinutes: 0,
      reason: 'no_work_day',
      label: null,
      absence: null,
      pendingVacation: false,
    };
    const allDay = job({
      ...solo,
      plannedTime: null,
      plannedDate: '2026-10-31',
      endDateExclusive: '2026-11-01',
    });
    const kept = filterBoardGroups({
      groups: [
        { key: 'no-team', name: 'Ohne Team', rows: [{ key: 'r-erik', kind: 'person', row: erikRow }] },
      ],
      // The search hid the all-day card, and it plans zero minutes on a zero-target day.
      visibleJobs: [],
      columns: [{ date: '2026-10-31' }],
      days: new Map([['r-erik:2026-10-31', hatched]]),
      planned: new Map(),
      workDays: plannedWorkDays([allDay], new Map()),
      dispatch: new Map(),
      dispatchStates: [],
      onlyConflicts: true,
      people: indexBoardPeople([erikRow], []),
    });
    expect(kept.flatMap((group) => group.rows.map((model) => model.key))).toEqual(['r-erik']);
  });

  test('a card taken from „Ohne Zuweisung“ replaces the leaver with its new person', () => {
    expect(
      reassignmentChanges({
        job: solo,
        sourceEmployeeRecordId: null,
        sourceUserId: null,
        target: { employeeRecordId: 'r-anna', userId: 'u-anna', date: '2026-11-04' },
        people: afterExit,
      }),
    ).toEqual({ assignedUserIds: ['u-anna'], assignedEmployeeRecordIds: ['r-anna'] });
  });

  test('a hatched day with planned work rates as overbooked, and an ended access is hatched too', () => {
    const day: CalendarBoardDay = {
      employeeRecordId: 'r-erik',
      date: '2026-10-30',
      targetMinutes: 0,
      baseTargetMinutes: 0,
      reason: 'no_work_day',
      label: null,
      absence: null,
      pendingVacation: false,
    };
    expect(
      boardCellCapacity({
        day,
        plannedMinutes: 120,
        hasPlannedWork: true,
        unavailability: 'after_exit',
        isWeekend: false,
      }),
    ).toEqual({
      state: 'overbooked',
      off: true,
      description: 'Nicht beschäftigt, trotzdem 2 h geplant',
    });
    expect(
      boardCellCapacity({
        day,
        plannedMinutes: 0,
        hasPlannedWork: false,
        unavailability: 'after_exit',
        isWeekend: false,
      }),
    ).toEqual({
      state: 'off',
      off: true,
      description: 'Nicht beschäftigt',
    });
    const working = { ...day, targetMinutes: 480, baseTargetMinutes: 480, reason: 'working' as const };
    expect(
      boardCellCapacity({
        day: working,
        plannedMinutes: 120,
        hasPlannedWork: true,
        unavailability: 'access_ended',
        isWeekend: false,
      }),
    ).toMatchObject({ state: 'overbooked', description: 'App-Zugang beendet, trotzdem 2 h geplant' });
    expect(
      boardCellCapacity({
        day: working,
        plannedMinutes: 120,
        hasPlannedWork: true,
        unavailability: null,
        isWeekend: false,
      }).state,
    ).toBe('partial');
    // An all-day visit on a day after the exit plans zero minutes, because the day's target is zero.
    const allDay = job({ plannedTime: null, plannedDate: '2026-10-30', endDateExclusive: '2026-10-31' });
    // A search or dispatch filter that hides the card leaves the work: the days come from every visit.
    const hasPlannedWork = plannedWorkDays([allDay], new Map()).has('r1:2026-10-30');
    expect(
      boardCellCapacity({
        day,
        plannedMinutes: 0,
        hasPlannedWork,
        unavailability: 'after_exit',
        isWeekend: false,
      }),
    ).toEqual({ state: 'overbooked', off: true, description: 'Nicht beschäftigt, trotzdem eingeplant' });
    expect(plannedWorkDays([{ ...allDay, occurrenceStatus: 'cancelled' }], new Map()).size).toBe(0);
    const legacy = { ...allDay, occurrenceId: undefined, assignedEmployeeRecordIds: undefined };
    expect([...plannedWorkDays([legacy], new Map([['u1', 'r1']]))]).toEqual(['r1:2026-10-30']);
  });

  test('a card from „Ohne Zuweisung“ lets go of every person who cannot work it, two leavers included', () => {
    const second = { ...erik, employeeRecordId: 'r-ina', userId: 'u-ina', displayName: 'Ina Roth' };
    const twoLeavers = job({
      ...solo,
      assignedEmployeeRecordIds: ['r-erik', 'r-ina'],
      assignedUserIds: ['u-erik', 'u-ina'],
    });
    expect(
      reassignmentChanges({
        job: twoLeavers,
        sourceEmployeeRecordId: null,
        sourceUserId: null,
        target: { employeeRecordId: 'r-anna', userId: 'u-anna', date: '2026-11-04' },
        people: indexBoardPeople([anna], [erik, second]),
      }),
    ).toEqual({ assignedUserIds: ['u-anna'], assignedEmployeeRecordIds: ['r-anna'] });
  });
});

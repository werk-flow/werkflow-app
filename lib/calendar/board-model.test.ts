import { describe, expect, test } from 'bun:test';
import type { CalendarBoardRow } from './board';
import { absenceItems, actualMinutesByUserDate, groupBoardRows, matchesBoardSearch, occurrenceSpan, reassignmentChanges, rowOwnsJob } from './board-model';
import type { CalendarJob } from '@/lib/jobs/types';
import type { TimeEntry } from '@/lib/time-tracking/types';

const row = (overrides: Partial<CalendarBoardRow>): CalendarBoardRow => ({ employeeRecordId: 'r', userId: 'u', displayName: 'Person', role: 'employee', hasLogin: true, teamId: null, teamName: null, entryDate: null, exitDate: null, ...overrides });
const job = (overrides: Partial<CalendarJob>): CalendarJob => ({ id: 'o', occurrenceId: 'o', title: 'Wartung Heizung', jobNumber: 'AUF-1', status: 'nicht_bearbeitet', priority: 'mittel', plannedDate: '2026-09-15', plannedTime: '09:00', estimatedDurationMinutes: 60, plannedWorkingMinutes: null, location: 'Berlin', clientName: 'Müller GmbH', clientAddress: null, projectName: null, projectNumber: null, assignedUserIds: ['u1'], assignedEmployeeRecordIds: ['r1'], ...overrides });

describe('board rows', () => {
  test('groups by team name, appends people without a team, and honours the member and team filters', () => {
    const rows = [
      row({ employeeRecordId: 'r1', userId: 'u1', displayName: 'Sven Neumann', teamId: 't-heizung', teamName: 'Heizung' }),
      row({ employeeRecordId: 'r2', userId: 'u2', displayName: 'Anna Berg', teamId: 't-sanitaer', teamName: 'Sanitär' }),
      row({ employeeRecordId: 'r3', userId: null, displayName: 'Ohne Login', teamId: null }),
      row({ employeeRecordId: 'r4', userId: 'u4', displayName: 'Mia Sommer', teamId: 't-heizung', teamName: 'Heizung' }),
    ];
    const groups = groupBoardRows({ rows, includeUnassigned: true, memberUserIds: null, teamIds: [] });
    expect(groups.map((group) => [group.name, group.rows.map((entry) => entry.key)])).toEqual([
      ['Ohne Zuweisung', ['unassigned']],
      ['Heizung', ['r4', 'r1']],
      ['Sanitär', ['r2']],
      ['Ohne Team', ['r3']],
    ]);
    expect(groupBoardRows({ rows, includeUnassigned: false, memberUserIds: ['u2'], teamIds: [] }).flatMap((group) => group.rows.map((entry) => entry.key))).toEqual(['r2', 'r3']);
    expect(groupBoardRows({ rows, includeUnassigned: false, memberUserIds: null, teamIds: ['t-heizung'] }).flatMap((group) => group.rows.map((entry) => entry.key))).toEqual(['r4', 'r1']);
  });

  test('a card belongs to its assignees, legacy jobs by user id, and unassigned cards to the top row', () => {
    const person = { key: 'r1', kind: 'person' as const, row: row({ employeeRecordId: 'r1', userId: 'u1' }) };
    expect(rowOwnsJob(person, job({}))).toBe(true);
    expect(rowOwnsJob(person, job({ assignedEmployeeRecordIds: ['r2'] }))).toBe(false);
    expect(rowOwnsJob(person, job({ occurrenceId: undefined, assignedEmployeeRecordIds: undefined, assignedUserIds: ['u1'] }))).toBe(true);
    expect(rowOwnsJob({ key: 'unassigned', kind: 'unassigned', row: null }, job({ assignedEmployeeRecordIds: [], assignedUserIds: [] }))).toBe(true);
    expect(rowOwnsJob({ key: 'unassigned', kind: 'unassigned', row: null }, job({}))).toBe(false);
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
    expect(occurrenceSpan(job({ startAt: '2026-09-15T07:00:00.000Z', endAt: '2026-09-15T08:00:00.000Z' }))).toEqual({ key: 'o', startDate: '2026-09-15', endDateExclusive: '2026-09-16', sortMinutes: 540 });
    expect(occurrenceSpan(job({ startAt: '2026-09-15T20:00:00.000Z', endAt: '2026-09-16T01:00:00.000Z', plannedTime: '22:00' }))).toEqual({ key: 'o', startDate: '2026-09-15', endDateExclusive: '2026-09-17', sortMinutes: 1320 });
    expect(occurrenceSpan(job({ plannedTime: null, startAt: null, endAt: null, timeKind: 'all_day', plannedDate: '2026-09-16', endDateExclusive: '2026-09-19' }))).toEqual({ key: 'o', startDate: '2026-09-16', endDateExclusive: '2026-09-19', sortMinutes: -1 });
    expect(occurrenceSpan(job({ plannedDate: null }))).toBeNull();
  });

  test('absences become bars for the row with their labels', () => {
    const items = absenceItems({
      vacation: [{ id: 'v1', employeeRecordId: 'r1', personName: 'Sven', startDate: '2026-09-14', endDate: '2026-09-16', dayPortion: 'full', status: 'pending' }],
      sickness: [{ id: 's1', employeeRecordId: 'r1', personName: 'Sven', startDate: '2026-09-18', endDate: '2026-09-18', dayPortion: 'half_day', openEnded: true }, { id: 's2', employeeRecordId: 'r2', personName: 'Anna', startDate: '2026-09-18', endDate: '2026-09-18', dayPortion: 'full', openEnded: false }],
      employeeRecordId: 'r1',
    });
    expect(items.map((item) => [item.label, item.startDate, item.endDateExclusive, item.pending])).toEqual([
      ['Urlaub – Sven (angefragt)', '2026-09-14', '2026-09-17', true],
      ['Abwesend – Sven (halber Tag) (bis auf Weiteres)', '2026-09-18', '2026-09-19', false],
    ]);
  });

  test('actual minutes sum the work blocks per person and local date and carry the provisional flag', () => {
    const entry = (overrides: Partial<TimeEntry>): TimeEntry => ({ id: 'e', userId: 'u1', organizationId: 'org', entryType: 'clock_in', timestamp: '2026-09-15T06:00:00.000Z', isManual: false, jobId: null, status: 'approved', reviewedBy: null, reviewedAt: null, createdAt: '2026-09-15T06:00:00.000Z', updatedAt: '2026-09-15T06:00:00.000Z', ...overrides });
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
    expect(reassignmentChanges({ job: two, sourceEmployeeRecordId: 'r1', sourceUserId: 'u1', target: { employeeRecordId: 'r3', userId: 'u3', date: '2026-09-15' } }))
      .toEqual({ assignedUserIds: ['u3', 'u2'], assignedEmployeeRecordIds: ['r3', 'r2'] });
    expect(reassignmentChanges({ job: job({ assignedUserIds: [], assignedEmployeeRecordIds: [] }), sourceEmployeeRecordId: null, sourceUserId: null, target: { employeeRecordId: 'r3', userId: 'u3', date: '2026-09-16' } }))
      .toEqual({ plannedDate: '2026-09-16', assignedUserIds: ['u3'], assignedEmployeeRecordIds: ['r3'] });
    expect(reassignmentChanges({ job: two, sourceEmployeeRecordId: 'r2', sourceUserId: 'u2', target: { employeeRecordId: null, userId: null, date: '2026-09-15' } }))
      .toEqual({ assignedUserIds: ['u1'], assignedEmployeeRecordIds: ['r1'] });
    expect(reassignmentChanges({ job: two, sourceEmployeeRecordId: 'r1', sourceUserId: 'u1', target: { employeeRecordId: 'r1', userId: 'u1', date: '2026-09-15' } })).toBeNull();
    // Legacy jobs without an occurrence carry user ids only.
    expect(reassignmentChanges({ job: job({ occurrenceId: undefined, assignedEmployeeRecordIds: undefined, assignedUserIds: ['u1'] }), sourceEmployeeRecordId: 'r1', sourceUserId: 'u1', target: { employeeRecordId: 'r2', userId: 'u2', date: '2026-09-15' } }))
      .toEqual({ assignedUserIds: ['u2'] });
  });
});

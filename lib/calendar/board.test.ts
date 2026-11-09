import { describe, expect, test } from 'bun:test';
import type { CalendarJob } from '@/lib/jobs/types';
import {
  boardCellCapacity,
  absenceMark,
  boardDayKey,
  dispatchStateFor,
  indexBoardDispatch,
  plannedMinutesByEmployeeDate,
  type CalendarBoardDay,
} from './board';

function job(overrides: Partial<CalendarJob>): CalendarJob {
  return {
    id: 'o1',
    occurrenceId: 'o1',
    title: 'Wartung',
    jobNumber: null,
    status: 'nicht_bearbeitet',
    executionState: null,
    priority: 'mittel',
    plannedDate: '2026-09-15',
    plannedTime: '09:00',
    estimatedDurationMinutes: 120,
    plannedWorkingMinutes: null,
    location: null,
    clientName: null,
    clientAddress: null,
    projectName: null,
    projectNumber: null,
    assignedUserIds: [],
    assignedEmployeeRecordIds: ['r1'],
    timeKind: 'timed',
    startAt: '2026-09-15T07:00:00.000Z',
    endAt: '2026-09-15T09:00:00.000Z',
    occurrenceStatus: 'scheduled',
    ...overrides,
  };
}

function day(overrides: Partial<CalendarBoardDay>): CalendarBoardDay {
  return {
    employeeRecordId: 'r1',
    date: '2026-09-15',
    targetMinutes: 480,
    baseTargetMinutes: 480,
    reason: 'working',
    label: null,
    absence: null,
    pendingVacation: false,
    ...overrides,
  };
}

describe('planned minutes per person and Berlin date', () => {
  test('counts timed allocations per date, all-day occurrences by target, and skips inactive occurrences', () => {
    const minutes = plannedMinutesByEmployeeDate(
      [
        job({}),
        job({
          id: 'o2',
          occurrenceId: 'o2',
          startAt: '2026-09-15T21:00:00.000Z',
          endAt: '2026-09-15T23:00:00.000Z',
        }),
        job({
          id: 'o3',
          occurrenceId: 'o3',
          timeKind: 'all_day',
          plannedTime: null,
          startAt: null,
          endAt: null,
          plannedDate: '2026-09-16',
          endDateExclusive: '2026-09-18',
          assignedEmployeeRecordIds: ['r1', 'r2'],
        }),
        job({ id: 'o4', occurrenceId: 'o4', occurrenceStatus: 'cancelled' }),
        job({
          id: 'legacy',
          occurrenceId: undefined,
          startAt: null,
          endAt: null,
          timeKind: undefined,
          estimatedDurationMinutes: 60,
          plannedDate: '2026-09-19',
        }),
      ],
      (record, date) => (record === 'r2' && date === '2026-09-17' ? 240 : 480),
    );
    expect(minutes.get(boardDayKey('r1', '2026-09-15'))).toBe(120 + 60);
    expect(minutes.get(boardDayKey('r1', '2026-09-16'))).toBe(60 + 480);
    expect(minutes.get(boardDayKey('r1', '2026-09-17'))).toBe(480);
    expect(minutes.get(boardDayKey('r2', '2026-09-17'))).toBe(240);
    expect(minutes.get(boardDayKey('r1', '2026-09-18'))).toBeUndefined();
    expect(minutes.get(boardDayKey('r1', '2026-09-19'))).toBe(60);
  });

  test('a note carries no capacity', () => {
    const minutes = plannedMinutesByEmployeeDate(
      [
        job({
          id: 'n1',
          occurrenceId: 'n1',
          entryKind: 'internal',
          internalType: 'other',
          timeKind: 'all_day',
          plannedTime: null,
          startAt: null,
          endAt: null,
          plannedDate: '2026-09-16',
        }),
      ],
      () => 480,
    );
    expect(minutes.size).toBe(0);
  });

  test('a legacy job without record ids counts through its user ids', () => {
    const minutes = plannedMinutesByEmployeeDate(
      [
        job({
          id: 'legacy',
          occurrenceId: undefined,
          startAt: null,
          endAt: null,
          timeKind: undefined,
          estimatedDurationMinutes: 90,
          plannedDate: '2026-09-19',
          assignedUserIds: ['u1', 'u9'],
          assignedEmployeeRecordIds: undefined,
        }),
      ],
      () => 480,
      new Map([['u1', 'r1']]),
    );
    expect([...minutes.entries()]).toEqual([[boardDayKey('r1', '2026-09-19'), 90]]);
  });
});

/** A planned day's capacity state, read through the board cell's public rule. */
const capacityState = (planned: CalendarBoardDay, plannedMinutes: number) =>
  boardCellCapacity({
    day: planned,
    plannedMinutes,
    hasPlannedWork: plannedMinutes > 0,
    unavailability: null,
    isWeekend: false,
  }).state;

describe('capacity state', () => {
  test('derives the five states with a fifteen-minute tolerance around full', () => {
    expect(capacityState(day({ targetMinutes: 0, reason: 'holiday' }), 0)).toBe('off');
    expect(capacityState(day({}), 0)).toBe('free');
    expect(capacityState(day({}), 120)).toBe('partial');
    expect(capacityState(day({}), 470)).toBe('full');
    expect(capacityState(day({}), 495)).toBe('full');
    expect(capacityState(day({}), 496)).toBe('overbooked');
    expect(capacityState(day({ targetMinutes: 0, absence: { type: 'vacation', portion: 'full' } }), 30)).toBe(
      'overbooked',
    );
  });

  test('describes the cell for hover and assistive technology', () => {
    const sentence = (cell: CalendarBoardDay, plannedMinutes: number): string =>
      boardCellCapacity({
        day: cell,
        plannedMinutes,
        hasPlannedWork: plannedMinutes > 0,
        unavailability: null,
        isWeekend: false,
      }).description;
    expect(
      sentence(day({ targetMinutes: 0, reason: 'holiday', label: 'Tag der Deutschen Einheit' }), 0),
    ).toBe('Feiertag: Tag der Deutschen Einheit');
    expect(sentence(day({ targetMinutes: 0, absence: { type: 'sickness', portion: 'full' } }), 0)).toBe(
      'Abwesend',
    );
    expect(sentence(day({ pendingVacation: true }), 150)).toBe(
      'teilweise geplant: 2,5 h von 8 h geplant, Urlaub angefragt',
    );
  });
});

test('marks a person away on the day by absence kind and portion, a sickness without naming it', () => {
  expect(absenceMark(day({ targetMinutes: 0, absence: { type: 'vacation', portion: 'full' } }))).toBe(
    'Urlaub',
  );
  expect(absenceMark(day({ absence: { type: 'sickness', portion: 'half_day' } }))).toBe(
    'Abwesend (halber Tag)',
  );
  expect(absenceMark(day({ pendingVacation: true }))).toBe('Urlaub angefragt');
  expect(absenceMark(day({}))).toBeNull();
  // A day the calendar does not hold says nothing about the person.
  expect(absenceMark(undefined)).toBeNull();
});

test('dispatch state falls back to „nicht gesendet" for occurrences without a dispatch', () => {
  const index = indexBoardDispatch([{ occurrenceId: 'o1', employeeRecordId: 'r1', state: 'bestaetigt' }]);
  expect(dispatchStateFor(index, 'o1', 'r1')).toBe('bestaetigt');
  expect(dispatchStateFor(index, 'o1', 'r2')).toBe('nicht_gesendet');
  expect(dispatchStateFor(index, undefined, 'r1')).toBe('nicht_gesendet');
});

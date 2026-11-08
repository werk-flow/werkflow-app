import { expect, test } from 'bun:test';
import {
  ABSENCES_NOT_LOADED_HINT,
  absencesNotLoadedHint,
  absentAssignees,
  indexBoardAbsences,
  withAbsenceMarks,
} from './absence-marks';
import type { CalendarBoardDay, CalendarBoardRow } from './board';

function day(employeeRecordId: string, date: string, overrides: Partial<CalendarBoardDay>): CalendarBoardDay {
  return {
    employeeRecordId,
    date,
    targetMinutes: 480,
    baseTargetMinutes: 480,
    reason: 'working',
    label: null,
    absence: null,
    pendingVacation: false,
    ...overrides,
  };
}

function row(employeeRecordId: string, userId: string | null): CalendarBoardRow {
  return {
    employeeRecordId,
    userId,
    displayName: employeeRecordId,
    role: null,
    hasLogin: userId !== null,
    teamId: null,
    teamName: null,
    entryDate: null,
    exitDate: null,
  };
}

const sick = { targetMinutes: 0, absence: { type: 'sickness', portion: 'full' } } as const;
const absences = indexBoardAbsences(
  [
    day('r-sick', '2026-10-30', sick),
    day('r-sick', '2026-10-31', sick),
    day('r-here', '2026-10-30', {}),
    day('r-here', '2026-10-31', { targetMinutes: 0, absence: { type: 'vacation', portion: 'full' } }),
    day('r-nologin', '2026-10-30', { pendingVacation: true }),
  ],
  [row('r-sick', 'u-sick'), row('r-here', 'u-here'), row('r-nologin', null)],
);

test('a picker marks each person away on the chosen date and keeps the option’s own description', () => {
  const options = [
    { value: 'r-sick', label: 'Daniel', description: 'P-7' },
    { value: 'r-here', label: 'Lena' },
    { value: 'r-nologin', label: 'Ohne Login', description: 'Ohne App-Zugang' },
  ];
  expect(withAbsenceMarks(options, absences, '2026-10-30').map((option) => option.description)).toEqual([
    'Abwesend · P-7',
    undefined,
    'Urlaub angefragt · Ohne App-Zugang',
  ]);
  expect(withAbsenceMarks(options, absences, '2026-10-31')[1]?.description).toBe('Urlaub');
});

test('a picker date outside the window says that its absences are not loaded', () => {
  expect(absencesNotLoadedHint(absences, '2026-10-30')).toBeUndefined();
  expect(absencesNotLoadedHint(absences, '2026-11-09')).toBe(ABSENCES_NOT_LOADED_HINT);
  // No date chosen yet, or no window at all: nothing to say.
  expect(absencesNotLoadedHint(absences, '')).toBeUndefined();
  expect(absencesNotLoadedHint(indexBoardAbsences([], []), '2026-11-09')).toBeUndefined();
});

test('the card marks an assignee away on any day it covers, and only the assignees away', () => {
  const card = { plannedDate: '2026-10-30', endDateExclusive: null, assignedUserIds: ['u-sick', 'u-here'] };
  expect(absentAssignees(card, absences)).toEqual([{ userId: 'u-sick', mark: 'Abwesend' }]);
  expect(absentAssignees({ ...card, endDateExclusive: '2026-11-01' }, absences)).toEqual([
    { userId: 'u-sick', mark: 'Abwesend' },
    { userId: 'u-here', mark: 'Urlaub' },
  ]);
  // A card on a day the window does not hold marks nobody.
  expect(absentAssignees({ ...card, plannedDate: '2026-11-09' }, absences)).toEqual([]);
});

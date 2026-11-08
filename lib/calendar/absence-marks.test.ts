import { expect, test } from 'bun:test';
import {
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
  expect(absencesNotLoadedHint(absences, '2026-11-09')).toBe(
    'Für diesen Tag sind keine Abwesenheiten geladen. Beim Speichern prüft WerkFlow sie trotzdem.',
  );
  // No date chosen yet, or no window at all: nothing to say.
  expect(absencesNotLoadedHint(absences, '')).toBeUndefined();
  expect(absencesNotLoadedHint(indexBoardAbsences([], []), '2026-11-09')).toBeUndefined();
});

test('the card marks an assignee away on any day it covers, and only the assignees away', () => {
  const card = {
    plannedDate: '2026-10-30',
    endDateExclusive: null,
    assignedUserIds: ['u-sick', 'u-here'],
    assignedEmployeeRecordIds: ['r-sick', 'r-here'],
  };
  expect(absentAssignees(card, absences)).toEqual([
    { employeeRecordId: 'r-sick', name: 'r-sick', mark: 'Abwesend' },
  ]);
  expect(
    absentAssignees({ ...card, endDateExclusive: '2026-11-01' }, absences).map((entry) => entry.mark),
  ).toEqual(['Abwesend', 'Urlaub']);
  // A card on a day the window does not hold marks nobody.
  expect(absentAssignees({ ...card, plannedDate: '2026-11-09' }, absences)).toEqual([]);
});

test('the card marks a person without a login by record, and a legacy card by user id', () => {
  const noLogin = {
    plannedDate: '2026-10-30',
    assignedUserIds: [],
    assignedEmployeeRecordIds: ['r-nologin'],
  };
  expect(absentAssignees(noLogin, absences)).toEqual([
    { employeeRecordId: 'r-nologin', name: 'r-nologin', mark: 'Urlaub angefragt' },
  ]);
  expect(absentAssignees({ plannedDate: '2026-10-30', assignedUserIds: ['u-sick'] }, absences)).toHaveLength(
    1,
  );
});

test('a timed visit across midnight checks the day it ends on too', () => {
  // Fri 30.10. 21:00 to Sat 31.10. 01:00 Berlin: Lena works Friday and is on vacation Saturday.
  const overnight = {
    plannedDate: '2026-10-30',
    startAt: '2026-10-30T20:00:00.000Z',
    endAt: '2026-10-31T00:00:00.000Z',
    assignedUserIds: [],
    assignedEmployeeRecordIds: ['r-here'],
  };
  expect(absentAssignees(overnight, absences)).toEqual([
    { employeeRecordId: 'r-here', name: 'r-here', mark: 'Urlaub' },
  ]);
});

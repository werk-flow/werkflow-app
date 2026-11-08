import { describe, expect, test } from 'bun:test';

import { delegationPeriodText } from './delegation-window';
import {
  absentDaysInWindow,
  isAbsentForWholeWindow,
  substituteOptionDescription,
  windowDayCount,
  type SubstituteAbsenceSpan,
} from './substitute-absence';
import { orderByPersonName, type ResponsibilityPerson } from './types';

const nadine = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';

const span = (
  startDate: string,
  endDate: string | null,
  employeeRecordId = nadine,
): SubstituteAbsenceSpan => ({
  employeeRecordId,
  startDate,
  endDate,
});

const person = (employeeRecordId: string, firstName: string, role: ResponsibilityPerson['role']) => ({
  employeeRecordId,
  userId: employeeRecordId,
  firstName,
  lastName: null,
  email: null,
  role,
});

describe('substitute absence in a delegation window', () => {
  test('a window counts its days inclusively, across a month end', () => {
    expect(windowDayCount('2026-11-02', '2026-11-06')).toBe(5);
    expect(windowDayCount('2026-10-30', '2026-11-02')).toBe(4);
    expect(windowDayCount('2026-11-06', '2026-11-02')).toBe(0);
  });

  test('vacation over exactly the window is absence on every day', () => {
    const spans = [span('2026-11-02', '2026-11-06')];
    expect(absentDaysInWindow(spans, nadine, '2026-11-02', '2026-11-06')).toBe(5);
    expect(isAbsentForWholeWindow(spans, nadine, '2026-11-02', '2026-11-06')).toBe(true);
  });

  test('overlapping spans count a day once, and one free day is no whole-window absence', () => {
    const spans = [span('2026-11-02', '2026-11-04'), span('2026-11-04', '2026-11-05')];
    expect(absentDaysInWindow(spans, nadine, '2026-11-02', '2026-11-06')).toBe(4);
    expect(isAbsentForWholeWindow(spans, nadine, '2026-11-02', '2026-11-06')).toBe(false);
  });

  test('an open sickness report lasts until further notice', () => {
    expect(isAbsentForWholeWindow([span('2026-10-20', null)], nadine, '2026-11-02', '2026-11-30')).toBe(true);
  });

  test('another person’s absence and an invalid window never warn', () => {
    const spans = [span('2026-11-02', '2026-11-06', other)];
    expect(isAbsentForWholeWindow(spans, nadine, '2026-11-02', '2026-11-06')).toBe(false);
    expect(
      isAbsentForWholeWindow([span('2026-11-01', '2026-11-30')], nadine, '2026-11-06', '2026-11-02'),
    ).toBe(false);
  });
});

describe('the substitute picker and the dialog copy', () => {
  test('an option names the role and the absent days in the window', () => {
    const nadinePerson = person(nadine, 'Nadine', 'buero');
    const spans = [span('2026-11-02', '2026-11-06')];
    expect(substituteOptionDescription(nadinePerson, spans, '2026-11-02', '2026-11-06')).toBe(
      'Büro · im ganzen Zeitraum abwesend',
    );
    expect(substituteOptionDescription(nadinePerson, spans, '2026-11-05', '2026-11-09')).toBe(
      'Büro · an 2 von 5 Tagen abwesend',
    );
    expect(substituteOptionDescription(nadinePerson, spans, '2026-11-09', '2026-11-13')).toBe('Büro');
    // Without the owner's absence read, the picker shows the role alone.
    expect(substituteOptionDescription(nadinePerson, null, '2026-11-02', '2026-11-06')).toBe('Büro');
  });

  test('the effect sentence reads „vom … bis einschließlich …“, or „am …“ for one day', () => {
    expect(delegationPeriodText('2026-11-02', '2026-11-06')).toBe(
      'vom 2.11.2026 bis einschließlich 6.11.2026',
    );
    expect(delegationPeriodText('2026-11-02', '2026-11-02')).toBe('am 2.11.2026');
  });

  test('holders follow the name order of the people list in every section', () => {
    const people = [person(other, 'Anna', 'admin'), person(nadine, 'Nadine', 'buero')];
    const unknown = { employeeRecordId: '10000000-0000-4000-8000-000000000009' };
    expect(
      orderByPersonName([{ employeeRecordId: nadine }, unknown, { employeeRecordId: other }], people),
    ).toEqual([{ employeeRecordId: other }, { employeeRecordId: nadine }, unknown]);
  });
});

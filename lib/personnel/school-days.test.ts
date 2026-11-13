import { describe, expect, test } from 'bun:test';

import {
  describeSchoolDay,
  groupSchoolDaySpansByRecord,
  isApprenticeThroughout,
  type SchoolDay,
} from './school-days';
import type { ApprovedAbsenceSpan } from './targets';

/** One record's spans; the rules of each test belong to one record. */
function expandSchoolDaySpans(schoolDays: SchoolDay[], start: string, end: string): ApprovedAbsenceSpan[] {
  return [...groupSchoolDaySpansByRecord(schoolDays, start, end).values()].flat();
}

const weeklyMonday: SchoolDay = {
  id: 'rule-1',
  employeeRecordId: 'record-1',
  kind: 'weekday',
  weekday: 0,
  startDate: '2026-09-07',
  endDate: null,
  cancelledAt: null,
};

const block: SchoolDay = {
  id: 'rule-2',
  employeeRecordId: 'record-2',
  kind: 'block',
  weekday: null,
  startDate: '2026-10-05',
  endDate: '2026-10-16',
  cancelledAt: null,
};

function dates(spans: ApprovedAbsenceSpan[]): string[][] {
  return spans.map((span) => [span.startDate, span.endDate]);
}

describe('the Berufsschule spans', () => {
  test('a weekly rule is every matching weekday from its start, inside the window', () => {
    // 2026-09-01 is a Tuesday; the rule starts Monday 07.09.
    expect(dates(expandSchoolDaySpans([weeklyMonday], '2026-09-01', '2026-09-22'))).toEqual([
      ['2026-09-07', '2026-09-07'],
      ['2026-09-14', '2026-09-14'],
      ['2026-09-21', '2026-09-21'],
    ]);
  });

  test('an ended weekly rule stops at its end date', () => {
    const ended = { ...weeklyMonday, endDate: '2026-09-14' };
    expect(dates(expandSchoolDaySpans([ended], '2026-09-01', '2026-09-30'))).toEqual([
      ['2026-09-07', '2026-09-07'],
      ['2026-09-14', '2026-09-14'],
    ]);
  });

  test('a block is one span clamped to the window', () => {
    expect(dates(expandSchoolDaySpans([block], '2026-10-10', '2026-10-31'))).toEqual([
      ['2026-10-10', '2026-10-16'],
    ]);
  });

  test('a cancelled rule and a rule outside the window yield nothing', () => {
    expect(
      expandSchoolDaySpans([{ ...block, cancelledAt: '2026-10-01T08:00:00Z' }], '2026-10-01', '2026-10-31'),
    ).toEqual([]);
    expect(expandSchoolDaySpans([block], '2026-11-01', '2026-11-30')).toEqual([]);
  });

  test('every span is a full school day', () => {
    const spans = expandSchoolDaySpans([weeklyMonday, block], '2026-09-01', '2026-10-31');
    expect(spans.every((span) => span.type === 'school' && span.dayPortion === 'full')).toBe(true);
  });

  test('spans are grouped per record', () => {
    const grouped = groupSchoolDaySpansByRecord([weeklyMonday, block], '2026-10-01', '2026-10-31');
    expect([...grouped.keys()].sort()).toEqual(['record-1', 'record-2']);
    expect(grouped.get('record-1')).toHaveLength(4);
  });

  test('the office reads each rule in German', () => {
    expect(describeSchoolDay(weeklyMonday)).toBe('Jeden Montag ab 07.09.2026');
    expect(describeSchoolDay({ ...weeklyMonday, endDate: '2027-07-16' })).toBe(
      'Jeden Montag ab 07.09.2026 bis 16.07.2027',
    );
    expect(describeSchoolDay(block)).toBe('Blockunterricht 05.10.2026 – 16.10.2026');
  });
});

describe('who may get school days', () => {
  const ausbildung = (validFrom: string) => ({ valid_from: validFrom, employment_type: 'ausbildung' });
  const vollzeit = (validFrom: string) => ({ valid_from: validFrom, employment_type: 'vollzeit' });

  test('an apprentice throughout the rule may', () => {
    expect(isApprenticeThroughout([ausbildung('2025-09-01')], '2026-09-07', null)).toBe(true);
    expect(
      isApprenticeThroughout([vollzeit('2024-01-01'), ausbildung('2025-09-01')], '2026-09-07', '2026-12-18'),
    ).toBe(true);
  });

  test('a person who left the apprenticeship before the start may not', () => {
    expect(
      isApprenticeThroughout([ausbildung('2023-09-01'), vollzeit('2026-08-01')], '2026-09-07', null),
    ).toBe(false);
  });

  test('a rule that runs past the end of the apprenticeship may not', () => {
    const conditions = [ausbildung('2023-09-01'), vollzeit('2027-02-01')];
    expect(isApprenticeThroughout(conditions, '2026-09-07', null)).toBe(false);
    expect(isApprenticeThroughout(conditions, '2026-09-07', '2027-03-31')).toBe(false);
    expect(isApprenticeThroughout(conditions, '2026-09-07', '2027-01-29')).toBe(true);
  });

  test('a rule before the first condition may not', () => {
    expect(isApprenticeThroughout([ausbildung('2026-10-01')], '2026-09-07', '2026-09-30')).toBe(false);
    expect(isApprenticeThroughout([], '2026-09-07', null)).toBe(false);
  });
});

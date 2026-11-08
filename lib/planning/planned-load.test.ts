import { describe, expect, test } from 'bun:test';

import { EMPTY_HOLIDAY_CALENDAR, resolveDailyTarget } from '@/lib/personnel/targets';
import { evaluateProposedCapacity } from './planned-load';
import type { MaterializedOccurrence } from './types';

const VISIT_DATE = '2026-11-04';

const visit: MaterializedOccurrence = {
  originalStartLocal: `${VISIT_DATE}T08:00`,
  timeKind: 'timed',
  startAt: '2026-11-04T07:00:00.000Z',
  endAt: '2026-11-04T11:00:00.000Z',
  startDate: null,
  endDateExclusive: null,
  dstResolution: 'exact',
};

function assessVisitFor(input: {
  exitDate: string | null;
  accessEndDateByRecord?: ReadonlyMap<string, string>;
}) {
  const target = resolveDailyTarget({
    dateIso: VISIT_DATE,
    schedules: [],
    conditions: [],
    calendar: EMPTY_HOLIDAY_CALENDAR,
    employment: { entryDate: '2020-01-01', exitDate: input.exitDate },
  });
  return evaluateProposedCapacity({
    occurrences: [visit],
    assignmentsFor: () => [{ employeeRecordId: 'erik', teamSourceId: null }],
    existingRows: [],
    excludedOccurrenceIds: new Set(),
    employeeRecordIds: ['erik'],
    uniqueDates: [VISIT_DATE],
    targets: { targetByEmployeeDate: new Map([[`erik:${VISIT_DATE}`, target]]), pendingVacation: [] },
    accessEndDateByRecord: input.accessEndDateByRecord ?? new Map(),
  });
}

describe('planned load of a visit', () => {
  test('a person planned after their exit gets the outside-employment conflict and nothing else', () => {
    const result = assessVisitFor({ exitDate: '2026-10-29' });
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['outside_employment']);
  });

  test('a person still employed on the visit date gets no employment conflict', () => {
    const result = assessVisitFor({ exitDate: '2026-11-30' });
    expect(result.conflicts.map((conflict) => conflict.kind)).not.toContain('outside_employment');
  });

  test('access that ended on or before the visit date warns; a later end does not', () => {
    const ended = assessVisitFor({
      exitDate: null,
      accessEndDateByRecord: new Map([['erik', VISIT_DATE]]),
    });
    const later = assessVisitFor({
      exitDate: null,
      accessEndDateByRecord: new Map([['erik', '2026-11-05']]),
    });
    expect(ended.conflicts.map((conflict) => conflict.kind)).toContain('access_ended');
    expect(later.conflicts.map((conflict) => conflict.kind)).not.toContain('access_ended');
  });
});

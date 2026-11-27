import { describe, expect, test } from 'bun:test';

import type { DailyTarget } from '@/lib/personnel/targets';
import { canonicalDayTotals } from './clock-day-totals';
import {
  createActivitySelection,
  projectTimeSegmentsToLegacyTransitions,
  type TimeSegmentFact,
} from './segments';
import { computeBreakdownForSettings, type BreakPolicy } from './settings';
import type { TimeEntry } from './types';
import { buildWeeklyTimeData, computeWeekLabel, getTodayIndex, getWeekBounds, targetsOfWeek } from './weekly';

// The server renders in UTC. 2026-09-27T22:30Z is Sunday in UTC but Monday
// 00:30 in Berlin (CEST): the overview must already show the new week.
const MONDAY_JUST_AFTER_BERLIN_MIDNIGHT = new Date('2026-09-27T22:30:00Z');

describe('the Berlin calendar week', () => {
  test('starts at Monday 00:00 Berlin and ends at Sunday 23:59:59.999 Berlin', () => {
    const { monday, sunday } = getWeekBounds(MONDAY_JUST_AFTER_BERLIN_MIDNIGHT);
    expect(monday.toISOString()).toBe('2026-09-27T22:00:00.000Z');
    expect(sunday.toISOString()).toBe('2026-10-04T21:59:59.999Z');
  });

  test('counts today on the Berlin date, not the runtime date', () => {
    expect(getTodayIndex(MONDAY_JUST_AFTER_BERLIN_MIDNIGHT)).toBe(0);
    expect(getTodayIndex(new Date('2026-10-04T21:59:00Z'))).toBe(6);
  });

  test('labels the week by its Berlin dates and ISO week', () => {
    const { monday } = getWeekBounds(MONDAY_JUST_AFTER_BERLIN_MIDNIGHT);
    expect(computeWeekLabel(monday)).toEqual({
      dateRange: 'Diese Woche (28.09. - 02.10.)',
      kw: 'KW 40',
    });
  });

  test('keeps whole days across the switch to winter time', () => {
    const { monday, sunday } = getWeekBounds(new Date('2026-10-21T12:00:00Z'));
    expect(monday.toISOString()).toBe('2026-10-18T22:00:00.000Z');
    expect(sunday.toISOString()).toBe('2026-10-25T22:59:59.999Z');
  });
});

/** Monday, 7 September 2026, in Berlin (CEST). */
const MONDAY = new Date('2026-09-06T22:00:00.000Z');
const MONDAY_END = new Date('2026-09-07T21:59:59.999Z');
const STANDBY_POLICY: BreakPolicy = {
  breakMode: 'automatic',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
  secondStep: null,
  breakPolicyHistory: [],
};

function segment(id: string, kind: 'work' | 'standby', startedAt: string, endedAt: string): TimeSegmentFact {
  const base = {
    id,
    sessionId: 'session',
    organizationId: 'org',
    employeeRecordId: 'record',
    startedAt,
    endedAt,
  };
  return kind === 'work'
    ? { ...base, ...createActivitySelection('work') }
    : { ...base, ...createActivitySelection('standby') };
}

/** The day's segments as the week reads them: projected clock entries carrying their activity. */
function weekEntriesOf(segments: TimeSegmentFact[]): TimeEntry[] {
  const kindOf = new Map(segments.map((fact) => [fact.id, fact.kind]));
  return projectTimeSegmentsToLegacyTransitions(segments, MONDAY, MONDAY_END).map((point, index) => ({
    id: `${point.segmentId}:${index}`,
    userId: 'user',
    organizationId: 'org',
    entryType: point.entryType,
    timestamp: point.timestamp,
    isManual: false,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: point.timestamp,
    updatedAt: point.timestamp,
    activityKind: kindOf.get(point.segmentId),
  }));
}

function mondayTarget(targetMinutes: number): DailyTarget {
  return {
    date: '2026-09-07',
    weekday: 0,
    targetMinutes,
    baseTargetMinutes: targetMinutes,
    source: 'schedule',
    outsideEmployment: null,
    isHoliday: false,
    holidayName: null,
    isClosureDay: false,
    closureLabel: null,
    absence: null,
  };
}

describe('standby in the day and the week', () => {
  // 07:00–14:00 work, then 14:00–17:00 standby: ten hours of working time.
  const segments = [
    segment('work', 'work', '2026-09-07T05:00:00.000Z', '2026-09-07T12:00:00.000Z'),
    segment('standby', 'standby', '2026-09-07T12:00:00.000Z', '2026-09-07T15:00:00.000Z'),
  ];

  test('counts toward working time and overtime in the week as in the day', () => {
    const target = mondayTarget(480);
    // The day path: today's totals and the dashboard's breakdown of them.
    const dayTotals = canonicalDayTotals(segments, MONDAY, MONDAY_END);
    const day = computeBreakdownForSettings(
      dayTotals.presenceMinutes,
      dayTotals.breakMinutes,
      STANDBY_POLICY,
      target.targetMinutes,
    );
    const [weekDay] = buildWeeklyTimeData(weekEntriesOf(segments), MONDAY, STANDBY_POLICY, [target]);

    expect(day).toEqual({ workMinutes: 480, breakMinutes: 30, overtimeMinutes: 90 });
    expect(weekDay?.totalMinutes).toBe(600);
    expect(weekDay?.standbyMinutes).toBe(180);
    expect(weekDay?.workMinutes).toBe(day.workMinutes);
    expect(weekDay?.breakMinutes).toBe(day.breakMinutes);
    expect(weekDay?.overtimeMinutes).toBe(day.overtimeMinutes);
  });

  test('stays out of the break steps', () => {
    // Five hours of work and three of standby: only five hours count toward the six-hour step.
    const shortWork = [
      segment('work', 'work', '2026-09-07T05:00:00.000Z', '2026-09-07T10:00:00.000Z'),
      segment('standby', 'standby', '2026-09-07T10:00:00.000Z', '2026-09-07T13:00:00.000Z'),
    ];
    const [weekDay] = buildWeeklyTimeData(weekEntriesOf(shortWork), MONDAY, STANDBY_POLICY, [
      mondayTarget(480),
    ]);

    expect(weekDay?.breakMinutes).toBe(0);
    expect(weekDay?.workMinutes).toBe(480);
    expect(weekDay?.overtimeMinutes).toBe(0);
  });
});

describe('a day whose target is unknown', () => {
  test('shows every worked minute as working time, never overtime past eight hours', () => {
    const tenHours = [segment('work', 'work', '2026-09-07T05:00:00.000Z', '2026-09-07T15:00:00.000Z')];
    const manual: BreakPolicy = { ...STANDBY_POLICY, breakMode: 'manual' };
    const [weekDay] = buildWeeklyTimeData(weekEntriesOf(tenHours), MONDAY, manual, undefined);

    expect(weekDay?.workMinutes).toBe(600);
    expect(weekDay?.overtimeMinutes).toBe(0);
  });
});

describe('targets kept from an earlier read', () => {
  test('apply only to the week they were read for', () => {
    const lastWeek = [{ ...mondayTarget(480), date: '2026-08-31' }];
    expect(targetsOfWeek(lastWeek, MONDAY)).toBeUndefined();
    const thisWeek = [mondayTarget(480)];
    expect(targetsOfWeek(thisWeek, MONDAY)).toBe(thisWeek);
    expect(targetsOfWeek(undefined, MONDAY)).toBeUndefined();
  });
});

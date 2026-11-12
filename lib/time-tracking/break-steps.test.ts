import { describe, expect, test } from 'bun:test';

import {
  breakPolicyFormValues,
  breakPolicyValuesSchema,
  computeBreakdownForSettings,
  getAutomaticBreakRanges,
  parseBreakPolicyHistory,
  resolveBreakPolicyAtTimestamp,
  timeTrackingSettingsSchema,
  type BreakPolicy,
  type BreakPolicyValues,
} from './settings';
import { calculateCalendarWorkBlocks, getCalendarBlockDisplaySegments } from './calendar-blocks';
import { buildWeeklyTimeData } from './weekly';
import type { TimeEntry } from './types';

// The automatic break has two steps (ArbZG § 4): 30 minutes from six hours of
// presence, 45 minutes in total from nine. An organization created before the
// second step keeps one step until its admin switches the second one on.
const ONE_STEP: BreakPolicyValues = {
  breakMode: 'automatic',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
  secondStep: null,
};
const TWO_STEPS: BreakPolicyValues = {
  ...ONE_STEP,
  secondStep: { thresholdMinutes: 540, durationMinutes: 45 },
};

const breakOf = (presenceMinutes: number, policy: BreakPolicyValues) =>
  computeBreakdownForSettings(presenceMinutes, 0, policy).breakMinutes;

describe('the automatic break with the nine-hour step', () => {
  test.each([
    ['5:59', 359, 0],
    ['6:01', 361, 30],
    ['9:01', 541, 45],
    ['10:00', 600, 45],
  ])('a %s day gets the break of the last step it reached', (_label, presenceMinutes, breakMinutes) => {
    expect(breakOf(presenceMinutes, TWO_STEPS)).toBe(breakMinutes);
  });

  test('an organization without the second step keeps 30 minutes on long days', () => {
    expect([359, 361, 541, 600].map((minutes) => breakOf(minutes, ONE_STEP))).toEqual([0, 30, 30, 30]);
  });

  test('a ten-hour block shows 30 minutes ending at six hours and 15 more ending at nine', () => {
    const ranges = getAutomaticBreakRanges('2026-10-05T05:00:00.000Z', '2026-10-05T15:00:00.000Z', TWO_STEPS);
    expect(ranges.map((range) => [range.breakStart.toISOString(), range.breakEnd.toISOString()])).toEqual([
      ['2026-10-05T10:30:00.000Z', '2026-10-05T11:00:00.000Z'],
      ['2026-10-05T13:45:00.000Z', '2026-10-05T14:00:00.000Z'],
    ]);
  });

  test('the calendar breaks of a block add up to the break the totals deduct', () => {
    for (const minutes of [359, 361, 541, 600]) {
      const end = new Date(Date.parse('2026-10-05T05:00:00.000Z') + minutes * 60_000);
      const shown = getAutomaticBreakRanges('2026-10-05T05:00:00.000Z', end, TWO_STEPS).reduce(
        (total, range) => total + (range.breakEnd.getTime() - range.breakStart.getTime()) / 60_000,
        0,
      );
      expect(shown).toBe(breakOf(minutes, TWO_STEPS));
    }
  });
});

describe('switching the second step on from a start date', () => {
  const switchedOn = '2026-10-07T06:00:00.000Z';
  const policy: BreakPolicy = {
    ...TWO_STEPS,
    breakPolicyHistory: parseBreakPolicyHistory([
      // A version saved before the second step existed carries none.
      {
        breakMode: 'automatic',
        autoBreakThresholdMinutes: 360,
        autoBreakDurationMinutes: 30,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      },
      { ...TWO_STEPS, effectiveFrom: switchedOn },
    ]),
  };

  test('a version saved before the second step existed reads as one step', () => {
    expect(policy.breakPolicyHistory[0]?.secondStep).toBeNull();
  });

  test('a day before the start date keeps its 30 minutes, a day after gets 45', () => {
    expect(breakOf(600, resolveBreakPolicyAtTimestamp(policy, '2026-10-06T15:00:00.000Z'))).toBe(30);
    expect(breakOf(600, resolveBreakPolicyAtTimestamp(policy, '2026-10-07T15:00:00.000Z'))).toBe(45);
  });

  test('the week keeps Tuesday as it was and deducts 45 minutes from Wednesday on', () => {
    const entry = (id: string, entryType: TimeEntry['entryType'], timestamp: string): TimeEntry => ({
      id,
      userId: 'worker',
      organizationId: 'org',
      entryType,
      timestamp,
      isManual: false,
      jobId: null,
      status: 'approved',
      reviewedBy: null,
      reviewedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    // Ten hours on Tuesday 6 and Wednesday 7 October 2026, 07:00 to 17:00 Berlin.
    const week = buildWeeklyTimeData(
      [
        entry('1', 'clock_in', '2026-10-06T05:00:00.000Z'),
        entry('2', 'clock_out', '2026-10-06T15:00:00.000Z'),
        entry('3', 'clock_in', '2026-10-07T05:00:00.000Z'),
        entry('4', 'clock_out', '2026-10-07T15:00:00.000Z'),
      ],
      new Date('2026-10-04T22:00:00.000Z'),
      policy,
    );
    expect(week.slice(1, 3).map((day) => [day.label, day.breakMinutes])).toEqual([
      ['Di', 30],
      ['Mi', 45],
    ]);
  });
});

describe('the settings form', () => {
  test('an existing organization is offered the second step switched off, with the defaults', () => {
    expect(breakPolicyFormValues(ONE_STEP)).toMatchObject({
      secondStepEnabled: false,
      secondStepThresholdMinutes: 540,
      secondStepDurationMinutes: 45,
    });
  });

  test.each([
    [
      'a second threshold before the first',
      { secondStepThresholdMinutes: 300 },
      'secondStepThresholdMinutes',
    ],
    ['a total below the first step', { secondStepDurationMinutes: 20 }, 'secondStepDurationMinutes'],
    ['a cleared second threshold', { secondStepThresholdMinutes: 0 }, 'secondStepThresholdMinutes'],
    ['a second threshold beyond a day', { secondStepThresholdMinutes: 5000 }, 'secondStepThresholdMinutes'],
    [
      'extra minutes that do not fit',
      { secondStepThresholdMinutes: 370, secondStepDurationMinutes: 45 },
      'secondStepDurationMinutes',
    ],
  ])('refuses %s', (_label, change, path) => {
    const result = timeTrackingSettingsSchema.safeParse({ ...breakPolicyFormValues(TWO_STEPS), ...change });
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([path]);
  });

  test.each([
    ['a threshold before the first', { secondStepThresholdMinutes: 300 }],
    ['a cleared threshold', { secondStepThresholdMinutes: 0 }],
    ['a threshold beyond a day', { secondStepThresholdMinutes: 5000 }],
  ])('a switched-off second step with %s still saves', (_label, change) => {
    const values = { ...breakPolicyFormValues(ONE_STEP), ...change };
    expect(timeTrackingSettingsSchema.safeParse(values).success).toBe(true);
  });

  test('the clock state carries the rule with its second step', () => {
    expect(breakPolicyValuesSchema.parse(TWO_STEPS).secondStep).toEqual({
      thresholdMinutes: 540,
      durationMinutes: 45,
    });
  });
});

describe('a day split across jobs', () => {
  const entry = (
    id: string,
    entryType: TimeEntry['entryType'],
    timestamp: string,
    jobId: string,
  ): TimeEntry => ({
    id,
    userId: 'worker',
    organizationId: 'org',
    entryType,
    timestamp,
    isManual: false,
    jobId,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  // Seven hours on one job, then three on another, on Tuesday 6 October 2026.
  const entries = [
    entry('1', 'clock_in', '2026-10-06T05:00:00.000Z', 'job-a'),
    entry('2', 'clock_out', '2026-10-06T12:00:00.000Z', 'job-a'),
    entry('3', 'clock_in', '2026-10-06T12:00:00.000Z', 'job-b'),
    entry('4', 'clock_out', '2026-10-06T15:00:00.000Z', 'job-b'),
  ];
  const settings = { organizationId: 'org', ...TWO_STEPS, breakPolicyHistory: [] };

  test('the calendar shows the break the totals deduct, counting the whole day', () => {
    const blocks = calculateCalendarWorkBlocks(entries);
    expect(blocks).toHaveLength(2);
    const shownBreakMinutes = blocks
      .flatMap((block) =>
        getCalendarBlockDisplaySegments(block, new Date('2026-10-06T16:00:00.000Z'), settings),
      )
      .filter((segment) => segment.type === 'break')
      .reduce(
        (total, segment) => total + (Date.parse(segment.end ?? '') - Date.parse(segment.start)) / 60_000,
        0,
      );
    const [, tuesday] = buildWeeklyTimeData(entries, new Date('2026-10-04T22:00:00.000Z'), settings);
    expect(tuesday?.breakMinutes).toBe(45);
    expect(shownBreakMinutes).toBe(45);
  });
});

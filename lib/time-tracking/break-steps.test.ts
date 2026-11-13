import { describe, expect, setSystemTime, test } from 'bun:test';

import {
  computeBreakdownForSettings,
  getAutomaticBreakRanges,
  parseBreakPolicyHistory,
  resolveBreakPolicyAtTimestamp,
  type BreakPolicy,
  type BreakPolicyValues,
  type OrganizationTimeTrackingSettings,
} from './settings';
import { breakPolicyFormValues, timeTrackingSettingsSchema } from './break-rule-form';
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
});

describe('a day split across blocks', () => {
  const at = (minutesAfterSeven: number) =>
    new Date(Date.parse('2026-10-06T05:00:00.000Z') + minutesAfterSeven * 60_000).toISOString();
  /** Back-to-back blocks from 07:00 Berlin on Tuesday 6 October 2026, one job (or standby) each. */
  type BlockShape = {
    minutes: number;
    standby?: boolean;
    /** A break stamped inside the block: its start after the block's start, and its length. */
    stampedBreak?: { after: number; minutes: number };
  };
  const day = (blocks: BlockShape[]): TimeEntry[] => {
    let offset = 0;
    return blocks.flatMap((block, index) => {
      const entry = (entryType: TimeEntry['entryType'], minutes: number): TimeEntry => ({
        id: `${index}-${entryType}`,
        userId: 'worker',
        organizationId: 'org',
        entryType,
        timestamp: at(minutes),
        isManual: false,
        jobId: `job-${index}`,
        status: 'approved',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: at(minutes),
        updatedAt: at(minutes),
        ...(block.standby ? { activityKind: 'standby' as const } : {}),
      });
      const stamped = block.stampedBreak
        ? [
            entry('break_start', offset + block.stampedBreak.after),
            entry('break_end', offset + block.stampedBreak.after + block.stampedBreak.minutes),
          ]
        : [];
      const blockEntries = [
        entry('clock_in', offset),
        ...stamped,
        entry('clock_out', offset + block.minutes),
      ];
      offset += block.minutes;
      return blockEntries;
    });
  };
  const settings = { organizationId: 'org', ...TWO_STEPS, breakPolicyHistory: [] };
  const breaks = (entries: TimeEntry[], rule: OrganizationTimeTrackingSettings = settings) => {
    const shown = calculateCalendarWorkBlocks(entries)
      .flatMap((block) => getCalendarBlockDisplaySegments(block, new Date('2026-10-06T20:00:00.000Z'), rule))
      .filter((segment) => segment.type === 'break')
      .reduce(
        (total, segment) => total + (Date.parse(segment.end ?? '') - Date.parse(segment.start)) / 60_000,
        0,
      );
    const [, tuesday] = buildWeeklyTimeData(entries, new Date('2026-10-04T22:00:00.000Z'), rule);
    return { shown, deducted: tuesday?.breakMinutes };
  };

  test.each([
    ['seven hours on one job and three on another', [{ minutes: 420 }, { minutes: 180 }], 45],
    [
      'a block too short for its share: 8:55, 0:10 and 0:55',
      [{ minutes: 535 }, { minutes: 10 }, { minutes: 55 }],
      45,
    ],
    ['three hours of standby before seven of work', [{ minutes: 180, standby: true }, { minutes: 420 }], 30],
    ['a block too short to show: 8:59:30 and 0:00:45', [{ minutes: 539.5 }, { minutes: 0.75 }], 45],
    [
      'a stamped 10-minute break in a 6:40 block, then 3:20 on another job',
      [{ minutes: 400, stampedBreak: { after: 200, minutes: 10 } }, { minutes: 200 }],
      45,
    ],
  ])('%s: the calendar shows the break the totals deduct', (_label, blocks, breakMinutes) => {
    expect(breaks(day(blocks))).toEqual({ shown: breakMinutes, deducted: breakMinutes });
  });

  test('a second step switched on during the day applies to all its blocks, as in the totals', () => {
    // Nine hours under one step, then one more hour, with the second step switched on at 16:05 Berlin.
    const rule: OrganizationTimeTrackingSettings = {
      ...settings,
      breakPolicyHistory: parseBreakPolicyHistory([
        { ...ONE_STEP, effectiveFrom: '2026-01-01T00:00:00.000Z' },
        { ...TWO_STEPS, effectiveFrom: at(545) },
      ]),
    };
    expect(breaks(day([{ minutes: 540 }, { minutes: 60 }]), rule)).toEqual({ shown: 45, deducted: 45 });
  });

  test('a second step whose threshold the hidden blocks reach keeps its share', () => {
    const rule = { ...settings, secondStep: { thresholdMinutes: 361, durationMinutes: 31 } };
    expect(breaks(day([{ minutes: 360 }, { minutes: 0.5 }, { minutes: 0.5 }]), rule)).toEqual({
      shown: 31,
      deducted: 31,
    });
  });

  test("a break started after the switch puts the day's whole presence under the new rule", () => {
    // Nine hours on one job, then another job from 16:00 Berlin, the second step from 16:05
    // and a stamped break from 16:10; it is 16:11.
    setSystemTime(new Date(at(551)));
    try {
      const rule: OrganizationTimeTrackingSettings = {
        ...settings,
        breakPolicyHistory: parseBreakPolicyHistory([
          { ...ONE_STEP, effectiveFrom: '2026-01-01T00:00:00.000Z' },
          { ...TWO_STEPS, effectiveFrom: at(545) },
        ]),
      };
      const later = (id: string, entryType: TimeEntry['entryType'], minutes: number): TimeEntry => ({
        id,
        userId: 'worker',
        organizationId: 'org',
        entryType,
        timestamp: at(minutes),
        isManual: false,
        jobId: 'job-later',
        status: 'approved',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: at(minutes),
        updatedAt: at(minutes),
      });
      const entries = [
        ...day([{ minutes: 540 }]),
        later('later-in', 'clock_in', 540),
        later('later-break', 'break_start', 550),
      ];
      const automaticMinutes = calculateCalendarWorkBlocks(entries)
        .flatMap((block) => getCalendarBlockDisplaySegments(block, new Date(at(551)), rule))
        .filter((segment) => segment.type === 'break' && segment.id.includes('-auto-break'))
        .reduce(
          (total, segment) => total + (Date.parse(segment.end ?? '') - Date.parse(segment.start)) / 60_000,
          0,
        );
      const [, tuesday] = buildWeeklyTimeData(entries, new Date('2026-10-04T22:00:00.000Z'), rule);
      expect({ shown: automaticMinutes, deducted: tuesday?.breakMinutes }).toEqual({
        shown: 45,
        deducted: 45,
      });
    } finally {
      setSystemTime();
    }
  });
});

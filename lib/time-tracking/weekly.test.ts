import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';

import {
  LIVE_DAY_END,
  LIVE_DAY_START,
  liveClockStateOf,
  liveDayEntriesOf,
  liveDayTarget,
  reclassification,
} from '@/lib/testing/live-day-arbitraries';
import { applyApprovedTimeCorrections, correctedEntriesInWindow } from '@/lib/time-corrections/projection';
import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import { applyTransitionEcho } from './clock-echo';
import { liveMinutes } from './helpers';
import { computeZeiterfassungLiveTotals } from './live-totals';
import { memberLiveDay, memberStatusOf } from './member-day';
import { createActivitySelection, type TimeSegmentFact } from './segments';
import { buildBreakPolicyHistoryEntry, type BreakPolicy, type TimeBreakdown } from './settings';
import type { LiveClockState, TimeEntry } from './types';
import {
  buildWeeklyTimeData,
  computeWeekLabel,
  dayBreakPolicy,
  getTodayIndex,
  getWeekBounds,
  targetsOfWeek,
} from './weekly';

const { clockTotalsState } = await import('./canonical-clock-state');

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
const MONDAY = LIVE_DAY_START;
const MONDAY_END = LIVE_DAY_END;
const STANDBY_POLICY: BreakPolicy = {
  breakMode: 'automatic',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
  secondStep: null,
  breakPolicyHistory: [],
};

function segment(
  id: string,
  kind: 'work' | 'standby' | 'break',
  startedAt: string,
  endedAt: string | null,
): TimeSegmentFact {
  return {
    id,
    sessionId: 'session',
    organizationId: 'org',
    employeeRecordId: 'record',
    startedAt,
    endedAt,
    ...createActivitySelection(kind),
  };
}

describe('standby in the day and the week', () => {
  // 07:00–14:00 work, then 14:00–17:00 standby: ten hours of working time.
  const segments = [
    segment('work', 'work', '2026-09-07T05:00:00.000Z', '2026-09-07T12:00:00.000Z'),
    segment('standby', 'standby', '2026-09-07T12:00:00.000Z', '2026-09-07T15:00:00.000Z'),
  ];

  test('counts toward working time and overtime in the week as in the day', () => {
    const target = liveDayTarget(480);
    const [weekDay] = buildWeeklyTimeData(liveDayEntriesOf(segments), MONDAY, STANDBY_POLICY, [target]);

    expect(weekDay?.totalMinutes).toBe(600);
    expect(weekDay?.standbyMinutes).toBe(180);
    expect(weekDay).toMatchObject({ workMinutes: 480, breakMinutes: 30, overtimeMinutes: 90 });
    expect(todaysSplits(segments, STANDBY_POLICY, 480, AFTER_THE_DAY)).toEqual({
      dashboard: { workMinutes: 480, breakMinutes: 30, overtimeMinutes: 90 },
      mitarbeiter: { workMinutes: 480, breakMinutes: 30, overtimeMinutes: 90 },
    });
  });

  test('stays out of the break steps', () => {
    // Five hours of work and three of standby: only five hours count toward the six-hour step.
    const shortWork = [
      segment('work', 'work', '2026-09-07T05:00:00.000Z', '2026-09-07T10:00:00.000Z'),
      segment('standby', 'standby', '2026-09-07T10:00:00.000Z', '2026-09-07T13:00:00.000Z'),
    ];
    const [weekDay] = buildWeeklyTimeData(liveDayEntriesOf(shortWork), MONDAY, STANDBY_POLICY, [
      liveDayTarget(480),
    ]);

    expect(weekDay?.breakMinutes).toBe(0);
    expect(weekDay?.workMinutes).toBe(480);
    expect(weekDay?.overtimeMinutes).toBe(0);
  });
});

/** Monday 17:00 Berlin, after every closed segment of the fixtures. */
const AFTER_THE_DAY = Date.parse('2026-09-07T15:00:00.000Z');

/**
 * Today's clock state at `nowMs` as the server builds it from the day's entries with the approved
 * corrections applied; the last segment may still run.
 */
function clockStateOf(
  segments: TimeSegmentFact[],
  policy: BreakPolicy,
  nowMs: number,
  applications: TimeCorrectionApplicationProjection[],
): LiveClockState {
  const now = new Date(nowMs);
  const dayEntries = correctedEntriesInWindow(liveDayEntriesOf(segments, now), applications, 'org', {
    fromMs: MONDAY.getTime(),
    toMs: MONDAY_END.getTime(),
  });
  const running = segments.some((fact) => fact.endedAt === null);
  return liveClockStateOf(segments, clockTotalsState(dayEntries, policy, running, now), nowMs);
}

/** The clock state's own split of a closed day, which the phone keeps offline: it has no target. */
function closedClockTotals(segments: TimeSegmentFact[], policy: BreakPolicy) {
  return clockTotalsState(liveDayEntriesOf(segments), policy, false, new Date(AFTER_THE_DAY));
}

/**
 * Today's split at `nowMs` in each live view that shows it: the Zeiterfassung
 * dashboard (its hero and the week chart's today bar) from the clock state,
 * and the Mitarbeiter detail (its cards and the today bar) from the entries.
 */
function todaysSplits(
  segments: TimeSegmentFact[],
  policy: BreakPolicy,
  targetMinutes: number | undefined,
  nowMs: number,
  applications: TimeCorrectionApplicationProjection[] = [],
): { dashboard: TimeBreakdown; mitarbeiter: TimeBreakdown } {
  setSystemTime(new Date(nowMs));
  const state = clockStateOf(segments, policy, nowMs, applications);
  const presence = liveMinutes(state.todayMinutes, state.statusStartedAt, nowMs);
  // The office reads the member's entries with the approved corrections applied (getTimeEntries).
  const status = memberStatusOf(
    applyApprovedTimeCorrections(liveDayEntriesOf(segments), applications, 'org'),
    policy,
  );
  return {
    dashboard: computeZeiterfassungLiveTotals(state, presence, targetMinutes, nowMs).breakdown,
    mitarbeiter: memberLiveDay(status, targetMinutes, nowMs).breakdown,
  };
}

afterEach(() => {
  setSystemTime();
});

describe('today’s totals and the week', () => {
  // 07:00–12:00 work, then 12:00–15:00 standby: eight hours of working time,
  // five toward the six-hour step.
  const workThenStandby = (standbyEnd: string | null) => [
    segment('work', 'work', '2026-09-07T05:00:00.000Z', '2026-09-07T10:00:00.000Z'),
    segment('standby', 'standby', '2026-09-07T10:00:00.000Z', standbyEnd),
  ];
  const DAY_OF_SEVEN_HOURS = 420;
  const WEEK_SPLIT = { workMinutes: 420, breakMinutes: 0, overtimeMinutes: 60 };

  test('give a day with standby past the first step the break, working time and overtime of the week', () => {
    const closed = workThenStandby('2026-09-07T13:00:00.000Z');
    const [weekDay] = buildWeeklyTimeData(liveDayEntriesOf(closed), MONDAY, STANDBY_POLICY, [
      liveDayTarget(DAY_OF_SEVEN_HOURS),
    ]);

    expect(weekDay).toMatchObject(WEEK_SPLIT);
    expect(todaysSplits(closed, STANDBY_POLICY, DAY_OF_SEVEN_HOURS, AFTER_THE_DAY)).toEqual({
      dashboard: WEEK_SPLIT,
      mitarbeiter: WEEK_SPLIT,
    });
    expect(closedClockTotals(closed, STANDBY_POLICY)).toMatchObject({
      workMinutes: 480,
      breakMinutes: 0,
    });
  });

  test('reach a step at its exact threshold, whatever the standby’s milliseconds', () => {
    // Six hours of work, then standby that ends 7 ms past the full minute.
    const sixHoursAndStandby = [
      segment('work', 'work', '2026-09-07T05:00:00.000Z', '2026-09-07T11:00:00.000Z'),
      segment('standby', 'standby', '2026-09-07T11:00:00.000Z', '2026-09-07T14:00:00.007Z'),
    ];
    const [weekDay] = buildWeeklyTimeData(liveDayEntriesOf(sixHoursAndStandby), MONDAY, STANDBY_POLICY, [
      liveDayTarget(DAY_OF_SEVEN_HOURS),
    ]);

    expect(weekDay?.breakMinutes).toBe(30);
  });

  test('keep a standby that is still running out of the break steps', () => {
    const running = workThenStandby(null);
    const threeHoursOfStandby = Date.parse('2026-09-07T13:00:00.000Z');

    expect(todaysSplits(running, STANDBY_POLICY, DAY_OF_SEVEN_HOURS, threeHoursOfStandby)).toEqual({
      dashboard: WEEK_SPLIT,
      mitarbeiter: WEEK_SPLIT,
    });
  });

  /** A start at 06:00 Berlin that was never closed, as legacy captures left some. */
  const unclosedStart = (activityKind?: 'standby'): TimeEntry => ({
    id: 'legacy',
    userId: 'user',
    organizationId: 'org',
    entryType: 'clock_in',
    timestamp: '2026-09-07T04:00:00.000Z',
    isManual: false,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-09-07T04:00:00.000Z',
    updatedAt: '2026-09-07T04:00:00.000Z',
    activityKind,
  });

  test('find the running standby behind an earlier start that was never closed', () => {
    setSystemTime(new Date('2026-09-07T12:00:00.000Z'));
    const status = memberStatusOf(
      [unclosedStart(), ...liveDayEntriesOf(workThenStandby(null))],
      STANDBY_POLICY,
    );

    expect(status.isOnStandby).toBe(true);
  });

  test('count no running standby during a break, also behind an unclosed standby start', () => {
    setSystemTime(new Date('2026-09-07T11:00:00.000Z'));
    const workThenBreak = [
      segment('work', 'work', '2026-09-07T05:00:00.000Z', '2026-09-07T10:00:00.000Z'),
      segment('break', 'break', '2026-09-07T10:00:00.000Z', null),
    ];
    const status = memberStatusOf(
      [unclosedStart('standby'), ...liveDayEntriesOf(workThenBreak)],
      STANDBY_POLICY,
    );

    expect(status.status).toBe('on_break');
    expect(status.isOnStandby).toBe(false);
  });

  test('owe no overtime when today’s target is unknown', () => {
    const tenHours = [segment('work', 'work', '2026-09-07T05:00:00.000Z', '2026-09-07T15:00:00.000Z')];
    const noOvertime = { workMinutes: 570, breakMinutes: 30, overtimeMinutes: 0 };

    expect(todaysSplits(tenHours, STANDBY_POLICY, undefined, AFTER_THE_DAY)).toEqual({
      dashboard: noOvertime,
      mitarbeiter: noOvertime,
    });
    expect(closedClockTotals(tenHours, STANDBY_POLICY)).toMatchObject({
      workMinutes: 570,
    });
  });
});

describe('today’s totals after a change the week sees', () => {
  // 07:00–13:00 work, then 13:00–14:00 standby, clocked out at 14:00 Berlin.
  const sixHoursAndStandby = [
    segment('work', 'work', '2026-09-07T05:00:00.000Z', '2026-09-07T11:00:00.000Z'),
    segment('standby', 'standby', '2026-09-07T11:00:00.000Z', '2026-09-07T12:00:00.000Z'),
  ];
  /** The rule `earlier` until 14:30 Berlin, after the clock-out, and `later` from then on. */
  const changedAfterClockOut = (earlier: BreakPolicy, later: BreakPolicy): BreakPolicy => ({
    ...later,
    breakPolicyHistory: [
      buildBreakPolicyHistoryEntry(earlier, new Date(0).toISOString()),
      buildBreakPolicyHistoryEntry(later, '2026-09-07T12:30:00.000Z'),
    ],
  });

  test('keep the break rule of the day’s last entry when the first step rises after clock-out', () => {
    const policy = changedAfterClockOut(STANDBY_POLICY, {
      ...STANDBY_POLICY,
      autoBreakThresholdMinutes: 420,
    });
    const [weekDay] = buildWeeklyTimeData(liveDayEntriesOf(sixHoursAndStandby), MONDAY, policy, [
      liveDayTarget(420),
    ]);
    const weekSplit = { workMinutes: 390, breakMinutes: 30, overtimeMinutes: 0 };

    expect(weekDay).toMatchObject(weekSplit);
    expect(todaysSplits(sixHoursAndStandby, policy, 420, AFTER_THE_DAY)).toEqual({
      dashboard: weekSplit,
      mitarbeiter: weekSplit,
    });
  });

  test('deduct no automatic break from a manual day when the automatic rule starts after clock-out', () => {
    const policy = changedAfterClockOut({ ...STANDBY_POLICY, breakMode: 'manual' }, STANDBY_POLICY);
    const sixHours = sixHoursAndStandby.slice(0, 1);
    const manualSplit = { workMinutes: 360, breakMinutes: 0, overtimeMinutes: 0 };

    expect(todaysSplits(sixHours, policy, 480, AFTER_THE_DAY)).toEqual({
      dashboard: manualSplit,
      mitarbeiter: manualSplit,
    });
  });

  test('count a clock-in after the change by the current rule, before the server answers too', () => {
    const policy = changedAfterClockOut(STANDBY_POLICY, { ...STANDBY_POLICY, breakMode: 'manual' });
    const sixHours = sixHoursAndStandby.slice(0, 1);
    setSystemTime(new Date(AFTER_THE_DAY));
    const closed = clockStateOf(sixHours, policy, AFTER_THE_DAY, []);
    expect(computeZeiterfassungLiveTotals(closed, closed.todayMinutes, 480, AFTER_THE_DAY).breakdown).toEqual(
      {
        workMinutes: 330,
        breakMinutes: 30,
        overtimeMinutes: 0,
      },
    );

    // Clocked in again at 17:00 Berlin; an hour later the server has not answered yet.
    const echo = applyTransitionEcho(
      closed,
      createActivitySelection('work'),
      { outcome: 'active', sessionId: 'session-2', segmentId: 'segment-2', version: 1, recoveryReason: null },
      new Date(AFTER_THE_DAY),
    );
    const anHourLater = AFTER_THE_DAY + 60 * 60_000;
    const presence = liveMinutes(echo.todayMinutes, echo.statusStartedAt, anHourLater);

    expect(computeZeiterfassungLiveTotals(echo, presence, 480, anHourLater).breakdown).toEqual({
      workMinutes: 420,
      breakMinutes: 0,
      overtimeMinutes: 0,
    });
  });

  test('choose the rule by the entries the totals count, not by an entry still ahead', () => {
    const policy = changedAfterClockOut({ ...STANDBY_POLICY, breakMode: 'manual' }, STANDBY_POLICY);
    setSystemTime(new Date(AFTER_THE_DAY));
    const sixHours = liveDayEntriesOf(sixHoursAndStandby.slice(0, 1));
    // An entry added for 18:00 Berlin, read at 17:00 Berlin: its minutes do not count yet.
    const ahead = sixHours.map((entry) => ({
      ...entry,
      id: `ahead-${entry.id}`,
      timestamp: '2026-09-07T16:00:00.000Z',
    }));

    expect(dayBreakPolicy(policy, [...sixHours, ...ahead], false).breakMode).toBe('manual');
  });

  test('count a same-day reclassification of standby as work like the corrected week', () => {
    // 07:00–12:00 work, then three hours of standby that an approved correction makes work.
    const workThenStandby = [
      segment('work', 'work', '2026-09-07T05:00:00.000Z', '2026-09-07T10:00:00.000Z'),
      segment('standby', 'standby', '2026-09-07T10:00:00.000Z', '2026-09-07T13:00:00.000Z'),
    ];
    const applications = [reclassification(workThenStandby, 'standby', new Date(AFTER_THE_DAY))];
    const [weekDay] = buildWeeklyTimeData(
      applyApprovedTimeCorrections(liveDayEntriesOf(workThenStandby), applications, 'org'),
      MONDAY,
      STANDBY_POLICY,
      [liveDayTarget(420)],
    );
    const weekSplit = { workMinutes: 420, breakMinutes: 30, overtimeMinutes: 30 };

    expect(weekDay).toMatchObject({ ...weekSplit, standbyMinutes: 0 });
    expect(todaysSplits(workThenStandby, STANDBY_POLICY, 420, AFTER_THE_DAY, applications)).toEqual({
      dashboard: weekSplit,
      mitarbeiter: weekSplit,
    });
  });
});

describe('a day whose target is unknown', () => {
  test('shows every worked minute as working time, never overtime past eight hours', () => {
    const tenHours = [segment('work', 'work', '2026-09-07T05:00:00.000Z', '2026-09-07T15:00:00.000Z')];
    const manual: BreakPolicy = { ...STANDBY_POLICY, breakMode: 'manual' };
    const [weekDay] = buildWeeklyTimeData(liveDayEntriesOf(tenHours), MONDAY, manual, undefined);

    expect(weekDay?.workMinutes).toBe(600);
    expect(weekDay?.overtimeMinutes).toBe(0);
  });
});

describe('targets kept from an earlier read', () => {
  test('apply only to the week they were read for', () => {
    const lastWeek = [{ ...liveDayTarget(480), date: '2026-08-31' }];
    expect(targetsOfWeek(lastWeek, MONDAY)).toBeUndefined();
    const thisWeek = [liveDayTarget(480)];
    expect(targetsOfWeek(thisWeek, MONDAY)).toBe(thisWeek);
    expect(targetsOfWeek(undefined, MONDAY)).toBeUndefined();
  });
});

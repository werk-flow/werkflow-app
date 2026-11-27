import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import fc from 'fast-check';
import {
  LIVE_DAY_END,
  LIVE_DAY_START,
  type LiveDay,
  standbyAfterArbitrary,
  liveClockStateOf,
  liveDayArbitrary,
  liveDayEntriesOf,
  liveDayPolicyArbitrary,
  liveDayTargetArbitrary,
  liveDayWithReclassifiableSegmentArbitrary,
  liveDayWithRuleChangeArbitrary,
  reclassification,
  weekDayOf,
  withStandbyAfter,
} from '@/lib/testing/live-day-arbitraries';
import { applyApprovedTimeCorrections, correctedEntriesInWindow } from '@/lib/time-corrections/projection';
import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import { liveMinutes, todayRunningSince } from './helpers';
import { computeZeiterfassungLiveTotals } from './live-totals';
import type { BreakPolicy } from './settings';

const { clockTotalsState } = await import('./canonical-clock-state');

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/time-tracking.md, "Break rule" and "Targets": the automatic steps count the day's
// presence without standby; standby is working time; overtime is the work beyond the target, and
// an unknown target owes none; a day counts by the rule in force at its last entry. Today's live
// totals on the Zeiterfassung dashboard split the day as the week splits it once the day has
// ended, from the same records: the approved corrections applied.

afterEach(() => setSystemTime());

const DAY_WINDOW = { fromMs: LIVE_DAY_START.getTime(), toMs: LIVE_DAY_END.getTime() };

/** The dashboard's totals at `nowMs`, from the clock state the server builds of the day's corrected entries. */
function dashboardTotals(
  day: LiveDay,
  policy: BreakPolicy,
  target: number | undefined,
  applications: TimeCorrectionApplicationProjection[] = [],
) {
  const now = new Date(day.nowMs);
  setSystemTime(now);
  const dayEntries = correctedEntriesInWindow(
    liveDayEntriesOf(day.segments, now),
    applications,
    'org',
    DAY_WINDOW,
  );
  const state = liveClockStateOf(
    day.segments,
    clockTotalsState(dayEntries, policy, day.running !== null, now),
    day.nowMs,
  );
  // As the dashboard's clock: today counts the running activity from midnight at the earliest.
  const presence = liveMinutes(
    state.todayMinutes,
    todayRunningSince(state.isClockedIn ? state.statusStartedAt : null, day.nowMs),
    day.nowMs,
  );
  return { presence, totals: computeZeiterfassungLiveTotals(state, presence, target, day.nowMs) };
}

describe('Today’s live totals on the dashboard', () => {
  test('split the day at any moment as the week splits it once it ends then', () => {
    fc.assert(
      fc.property(liveDayArbitrary, liveDayPolicyArbitrary, liveDayTargetArbitrary, (day, policy, target) => {
        const { presence, totals } = dashboardTotals(day, policy, target);
        const { workMinutes, breakMinutes, overtimeMinutes } = totals.breakdown;

        expect(presence).toBe(day.presenceMinutes);
        expect(totals.liveStandbyMinutes).toBe(day.standbyMinutes);
        expect(weekDayOf(day, policy, target)).toMatchObject({ workMinutes, breakMinutes, overtimeMinutes });
        expect(workMinutes + overtimeMinutes + breakMinutes).toBe(day.presenceMinutes);
      }),
    );
  });

  test('split the day by the rule at its last entry, also when the rule changed after clock-out', () => {
    fc.assert(
      fc.property(liveDayWithRuleChangeArbitrary, liveDayTargetArbitrary, ({ day, policy }, target) => {
        const { workMinutes, breakMinutes, overtimeMinutes } = dashboardTotals(day, policy, target).totals
          .breakdown;

        expect(weekDayOf(day, policy, target)).toMatchObject({ workMinutes, breakMinutes, overtimeMinutes });
      }),
    );
  });

  test('split a day with a same-day reclassification as the corrected week does', () => {
    fc.assert(
      fc.property(
        liveDayWithReclassifiableSegmentArbitrary,
        liveDayPolicyArbitrary,
        liveDayTargetArbitrary,
        ({ day, segmentId }, policy, target) => {
          const applications = [reclassification(day.segments, segmentId, new Date(day.nowMs))];
          const { totals } = dashboardTotals(day, policy, target, applications);
          const { workMinutes, breakMinutes, overtimeMinutes } = totals.breakdown;
          const week = weekDayOf(day, policy, target, (entries) =>
            applyApprovedTimeCorrections(entries, applications, 'org'),
          );

          expect(week).toMatchObject({
            workMinutes,
            breakMinutes,
            overtimeMinutes,
            standbyMinutes: totals.liveStandbyMinutes,
          });
        },
      ),
    );
  });

  test('deduct the same break whether or not standby follows, running or ended', () => {
    fc.assert(
      fc.property(
        liveDayArbitrary.filter((day) => day.running === null),
        standbyAfterArbitrary,
        fc.boolean(),
        liveDayPolicyArbitrary,
        liveDayTargetArbitrary,
        (day, standby, running, policy, target) => {
          const before = dashboardTotals(day, policy, target).totals.breakdown;
          const after = dashboardTotals(withStandbyAfter(day, standby, running), policy, target).totals
            .breakdown;
          expect(after.breakMinutes).toBe(before.breakMinutes);
          expect(after.workMinutes + after.overtimeMinutes).toBe(
            before.workMinutes + before.overtimeMinutes + standby,
          );
        },
      ),
    );
  });

  test('owe overtime only past a known target, never a negative one', () => {
    fc.assert(
      fc.property(liveDayArbitrary, liveDayPolicyArbitrary, liveDayTargetArbitrary, (day, policy, target) => {
        const { breakdown } = dashboardTotals(day, policy, target).totals;
        const worked = day.presenceMinutes - breakdown.breakMinutes;
        expect(breakdown.overtimeMinutes).toBe(target === undefined ? 0 : Math.max(0, worked - target));
        expect(breakdown.workMinutes).toBe(target === undefined ? worked : Math.min(worked, target));
      }),
    );
  });
});

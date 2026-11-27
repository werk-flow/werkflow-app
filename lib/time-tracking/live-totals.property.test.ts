import { afterEach, describe, expect, mock, setSystemTime, test } from 'bun:test';
import fc from 'fast-check';
import {
  LIVE_DAY_END,
  LIVE_DAY_START,
  type LiveDay,
  standbyAfterArbitrary,
  liveClockStateOf,
  liveDayArbitrary,
  liveDayPolicyArbitrary,
  liveDayTargetArbitrary,
  weekDayOf,
  withStandbyAfter,
} from '@/lib/testing/live-day-arbitraries';
import { canonicalDayTotals } from './clock-day-totals';
import { liveMinutes, todayRunningSince } from './helpers';
import { computeZeiterfassungLiveTotals } from './live-totals';
import type { BreakPolicy } from './settings';

// The clock state's totals live in a server-only module; they are a pure function.
mock.module('server-only', () => ({}));
const { clockTotalsState } = await import('./canonical-clock-state');

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/time-tracking.md, "Break rule" and "Targets": the automatic steps count the day's
// presence without standby; standby is working time; overtime is the work beyond the target, and
// an unknown target owes none. Today's live totals on the Zeiterfassung dashboard split the day as
// the week splits it once the day has ended.

afterEach(() => setSystemTime());

/** The dashboard's totals at `nowMs`, from the clock state the server builds of the day. */
function dashboardTotals(day: LiveDay, policy: BreakPolicy, target: number | undefined) {
  setSystemTime(new Date(day.nowMs));
  const state = liveClockStateOf(
    day.segments,
    clockTotalsState(canonicalDayTotals(day.segments, LIVE_DAY_START, LIVE_DAY_END), policy),
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

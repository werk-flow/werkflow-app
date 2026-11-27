import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import fc from 'fast-check';
import {
  type LiveDay,
  liveDayArbitrary,
  liveDayEntriesOf,
  liveDayPolicyArbitrary,
  liveDayTargetArbitrary,
  standbyAfterArbitrary,
  weekDayOf,
  withStandbyAfter,
} from '@/lib/testing/live-day-arbitraries';
import { memberLiveDay, memberStatusOf } from './member-day';
import type { BreakPolicy } from './settings';

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/time-tracking.md, "Break rule" and "Targets": the automatic steps count the day's
// presence without standby; standby is working time; overtime is the work beyond the target, and
// an unknown target owes none. A member's day on the Mitarbeiter list and detail, read from that
// member's entries, splits the day as the week splits it once the day has ended.

afterEach(() => setSystemTime());

/** The member's day at `nowMs`, from the status the office reads of the day's entries. */
function memberDay(day: LiveDay, policy: BreakPolicy, target: number | undefined) {
  setSystemTime(new Date(day.nowMs));
  const status = memberStatusOf(liveDayEntriesOf(day.segments), policy);
  return { status, ...memberLiveDay(status, policy, target, day.nowMs) };
}

describe('A member’s live day', () => {
  test('splits the day at any moment as the week splits it once it ends then', () => {
    fc.assert(
      fc.property(liveDayArbitrary, liveDayPolicyArbitrary, liveDayTargetArbitrary, (day, policy, target) => {
        const { status, presenceMinutes, breakdown } = memberDay(day, policy, target);
        const { workMinutes, breakMinutes, overtimeMinutes } = breakdown;

        expect(status.isClockedIn).toBe(day.running !== null);
        expect(status.isOnStandby).toBe(day.running === 'standby');
        expect(presenceMinutes).toBe(day.presenceMinutes);
        expect(weekDayOf(day, policy, target)).toMatchObject({ workMinutes, breakMinutes, overtimeMinutes });
        expect(workMinutes + overtimeMinutes + breakMinutes).toBe(day.presenceMinutes);
      }),
    );
  });

  test('deducts the same break whether or not standby follows, running or ended', () => {
    fc.assert(
      fc.property(
        liveDayArbitrary.filter((day) => day.running === null),
        standbyAfterArbitrary,
        fc.boolean(),
        liveDayPolicyArbitrary,
        liveDayTargetArbitrary,
        (day, standby, running, policy, target) => {
          const before = memberDay(day, policy, target).breakdown;
          const after = memberDay(withStandbyAfter(day, standby, running), policy, target).breakdown;
          expect(after.breakMinutes).toBe(before.breakMinutes);
          expect(after.workMinutes + after.overtimeMinutes).toBe(
            before.workMinutes + before.overtimeMinutes + standby,
          );
        },
      ),
    );
  });

  test('owes overtime only past a known target, never a negative one', () => {
    fc.assert(
      fc.property(liveDayArbitrary, liveDayPolicyArbitrary, liveDayTargetArbitrary, (day, policy, target) => {
        const { breakdown } = memberDay(day, policy, target);
        const worked = day.presenceMinutes - breakdown.breakMinutes;
        expect(breakdown.overtimeMinutes).toBe(target === undefined ? 0 : Math.max(0, worked - target));
        expect(breakdown.workMinutes).toBe(target === undefined ? worked : Math.min(worked, target));
      }),
    );
  });
});

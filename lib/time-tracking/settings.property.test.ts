import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  appendBreakPolicyHistory,
  type BreakPolicy,
  type BreakPolicyHistoryEntry,
  type BreakPolicyValues,
  computeDayBreakdown,
  getAutomaticBreakRanges,
  resolveBreakPolicyAtTimestamp,
} from './settings';
import { automaticBreakRuleArbitrary as automaticPolicyArbitrary } from '@/lib/testing/break-rule-arbitraries';

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/time-tracking.md, "Break rule": an automatic break in up to two steps, each a
// threshold of presence and a longer total break from the second; the steps count the whole day's
// work; the calendar's blocks add up to the break the totals deduct, however the day is split; and
// a rule change applies from the moment it is saved, so every earlier day keeps its rule.

const MINUTE_MS = 60_000;

/** The split of a day without standby, with the stamped break, and no target unless one is given. */
function breakdownOf(presence: number, stamped: number, policy: BreakPolicyValues, target?: number) {
  return computeDayBreakdown(
    { presenceMinutes: presence, standbyMinutes: 0, trackedBreakMinutes: stamped },
    policy,
    target,
  );
}

/** The break of the last step a day reached, read off the rule without the module. */
function oracleBreak(presenceMinutes: number, policy: BreakPolicyValues): number {
  const second = policy.secondStep;
  if (second && presenceMinutes >= second.thresholdMinutes) return second.durationMinutes;
  return presenceMinutes >= policy.autoBreakThresholdMinutes ? policy.autoBreakDurationMinutes : 0;
}

/** Manual breaks: the day's break is the one the person stamped. */
const MANUAL_RULE: BreakPolicyValues = {
  breakMode: 'manual',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
  secondStep: null,
};

const presenceArbitrary = fc.integer({ min: 0, max: 16 * 60 });

/** A rule and a day's presence, the minutes around each threshold drawn often. */
const policyAndPresenceArbitrary = automaticPolicyArbitrary.chain((policy) => {
  const thresholds = [policy.autoBreakThresholdMinutes, policy.secondStep?.thresholdMinutes ?? 0];
  const nearThreshold = fc
    .tuple(fc.constantFrom(...thresholds), fc.integer({ min: -1, max: 1 }))
    .map(([threshold, offset]) => Math.max(0, threshold + offset));
  return fc.tuple(fc.constant(policy), fc.oneof(presenceArbitrary, nearThreshold));
});

/** A day's counted presence cut into shown blocks, in minutes. */
const dayBlocksArbitrary = fc.array(fc.integer({ min: 1, max: 6 * 60 }), { minLength: 1, maxLength: 6 });

describe('The automatic break', () => {
  test('is the break of the last step the day’s presence reached, never more than the presence', () => {
    fc.assert(
      fc.property(policyAndPresenceArbitrary, ([policy, presence]) => {
        const { breakMinutes } = breakdownOf(presence, 0, policy);
        expect(breakMinutes).toBe(Math.min(oracleBreak(presence, policy), presence));
      }),
    );
  });

  test('never shrinks when the day grows', () => {
    fc.assert(
      fc.property(
        presenceArbitrary,
        fc.nat({ max: 600 }),
        automaticPolicyArbitrary,
        (presence, more, policy) => {
          const shorter = breakdownOf(presence, 0, policy).breakMinutes;
          const longer = breakdownOf(presence + more, 0, policy).breakMinutes;
          expect(longer).toBeGreaterThanOrEqual(shorter);
        },
      ),
    );
  });

  test('ignores the breaks a person stamped, and a manual rule counts only those', () => {
    fc.assert(
      fc.property(
        presenceArbitrary,
        fc.nat({ max: 600 }),
        automaticPolicyArbitrary,
        (presence, stamped, policy) => {
          expect(breakdownOf(presence, stamped, policy)).toEqual(breakdownOf(presence, 0, policy));
          const manual = breakdownOf(presence, stamped, { ...policy, breakMode: 'manual' });
          expect(manual.breakMinutes).toBe(Math.min(stamped, presence));
        },
      ),
    );
  });

  test('in the calendar adds up over a day’s blocks to the break the totals deduct, inside each block', () => {
    fc.assert(
      fc.property(
        dayBlocksArbitrary,
        automaticPolicyArbitrary,
        fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2027, 0, 1) }),
        (blocks, policy, dayStart) => {
          const presence = blocks.reduce((sum, minutes) => sum + minutes, 0);
          let before = 0;
          let shownMinutes = 0;
          for (const minutes of blocks) {
            // Gaps between blocks do not count; only the order of the presence does.
            const start = new Date(dayStart + 2 * before * MINUTE_MS);
            const end = new Date(start.getTime() + minutes * MINUTE_MS);
            const ranges = getAutomaticBreakRanges(start, end, policy, {
              countsTowardBreak: true,
              beforeMinutes: before,
              afterMinutes: presence - before - minutes,
              hiddenMinutes: 0,
            });
            for (const range of ranges) {
              expect(range.breakStart.getTime()).toBeGreaterThanOrEqual(start.getTime());
              expect(range.breakEnd.getTime()).toBeLessThanOrEqual(end.getTime());
              shownMinutes += (range.breakEnd.getTime() - range.breakStart.getTime()) / MINUTE_MS;
            }
            before += minutes;
          }
          expect(shownMinutes).toBeCloseTo(breakdownOf(presence, 0, policy).breakMinutes, 6);
        },
      ),
    );
  });

  test('shows nothing for standby, a manual rule or a block that does not move forward', () => {
    fc.assert(
      fc.property(automaticPolicyArbitrary, fc.integer({ min: 0, max: 900 }), (policy, minutes) => {
        const start = new Date(Date.UTC(2026, 5, 1, 6));
        const end = new Date(start.getTime() + minutes * MINUTE_MS);
        const standby = { countsTowardBreak: false, beforeMinutes: 0, afterMinutes: 0, hiddenMinutes: 0 };
        expect(getAutomaticBreakRanges(start, end, policy, standby)).toEqual([]);
        expect(getAutomaticBreakRanges(start, end, { ...policy, breakMode: 'manual' })).toEqual([]);
        expect(getAutomaticBreakRanges(end, start, policy)).toEqual([]);
      }),
    );
  });
});

const minutesArbitrary = fc.integer({ min: 0, max: 24 * 60 });

describe('A day’s breakdown', () => {
  test('splits presence into work, break and overtime that add up to it', () => {
    fc.assert(
      fc.property(
        minutesArbitrary,
        fc.nat({ max: 24 * 60 }),
        minutesArbitrary,
        (presence, tracked, target) => {
          const { workMinutes, breakMinutes, overtimeMinutes } = breakdownOf(
            presence,
            tracked,
            MANUAL_RULE,
            target,
          );
          expect(workMinutes + breakMinutes + overtimeMinutes).toBe(presence);
          expect(breakMinutes).toBe(Math.min(tracked, presence));
          expect(overtimeMinutes).toBe(Math.max(0, presence - breakMinutes - target));
          expect(workMinutes).toBeLessThanOrEqual(target);
        },
      ),
    );
  });

  test('never counts overtime before the target is reached, nor for an unknown target', () => {
    fc.assert(
      fc.property(minutesArbitrary, minutesArbitrary, automaticPolicyArbitrary, (work, target, policy) => {
        fc.pre(work <= target);
        const manual = { ...policy, breakMode: 'manual' as const };
        expect(breakdownOf(work, 0, manual, target).overtimeMinutes).toBe(0);
        const unknown = breakdownOf(work + target, 0, policy);
        expect(unknown.overtimeMinutes).toBe(0);
        expect(unknown.workMinutes).toBe(work + target - unknown.breakMinutes);
      }),
    );
  });

  test('keeps standby out of the break steps and counts it as working time', () => {
    fc.assert(
      fc.property(
        policyAndPresenceArbitrary,
        minutesArbitrary,
        fc.option(minutesArbitrary, { nil: undefined }),
        ([policy, presence], standby, target) => {
          const withStandby = computeDayBreakdown(
            { presenceMinutes: presence + standby, standbyMinutes: standby, trackedBreakMinutes: 0 },
            policy,
            target,
          );
          expect(withStandby.breakMinutes).toBe(breakdownOf(presence, 0, policy).breakMinutes);
          expect(withStandby.workMinutes + withStandby.overtimeMinutes).toBe(
            presence + standby - withStandby.breakMinutes,
          );
        },
      ),
    );
  });
});

const effectiveFromArbitrary = fc
  .integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2028, 0, 1) })
  .map((ms) => new Date(ms).toISOString());

const historyEntryArbitrary: fc.Arbitrary<BreakPolicyHistoryEntry> = fc
  .tuple(automaticPolicyArbitrary, fc.boolean(), effectiveFromArbitrary)
  .map(([policy, manual, effectiveFrom]) => ({
    ...policy,
    breakMode: manual ? 'manual' : 'automatic',
    effectiveFrom,
  }));

/** A rule with its versions in time order, as the settings read them. */
const breakPolicyArbitrary: fc.Arbitrary<BreakPolicy> = fc
  .array(historyEntryArbitrary, { minLength: 0, maxLength: 5 })
  .map((entries) => {
    const history = [...entries].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
    const current = history.at(-1);
    return {
      breakMode: current?.breakMode ?? 'manual',
      autoBreakThresholdMinutes: current?.autoBreakThresholdMinutes ?? 360,
      autoBreakDurationMinutes: current?.autoBreakDurationMinutes ?? 30,
      secondStep: current?.secondStep ?? null,
      breakPolicyHistory: history,
    };
  });

const withoutDate = (entry: BreakPolicyHistoryEntry): BreakPolicyValues => ({
  breakMode: entry.breakMode,
  autoBreakThresholdMinutes: entry.autoBreakThresholdMinutes,
  autoBreakDurationMinutes: entry.autoBreakDurationMinutes,
  secondStep: entry.secondStep,
});

describe('A change of the break rule', () => {
  test('lets a day follow the version in force at its time, the earliest before the first', () => {
    fc.assert(
      fc.property(breakPolicyArbitrary, effectiveFromArbitrary, (policy, at) => {
        const history = policy.breakPolicyHistory;
        const inForce = [...history].reverse().find((entry) => entry.effectiveFrom <= at) ?? history[0];
        const resolved = resolveBreakPolicyAtTimestamp(policy, at);
        expect(resolved).toEqual(
          inForce
            ? withoutDate(inForce)
            : {
                breakMode: policy.breakMode,
                autoBreakThresholdMinutes: policy.autoBreakThresholdMinutes,
                autoBreakDurationMinutes: policy.autoBreakDurationMinutes,
                secondStep: policy.secondStep,
              },
        );
      }),
    );
  });

  test('never moves a day before it was saved, also for a rule whose first version was never recorded', () => {
    fc.assert(
      fc.property(
        breakPolicyArbitrary,
        historyEntryArbitrary,
        effectiveFromArbitrary,
        (policy, change, at) => {
          const history = policy.breakPolicyHistory;
          const last = history.at(-1);
          const savedAt =
            last && last.effectiveFrom > change.effectiveFrom ? last.effectiveFrom : change.effectiveFrom;
          fc.pre(at < savedAt);
          const next = { ...change, effectiveFrom: savedAt };
          const changed: BreakPolicy = {
            ...withoutDate(next),
            breakPolicyHistory: appendBreakPolicyHistory(policy, next),
          };
          expect(resolveBreakPolicyAtTimestamp(changed, at)).toEqual(
            resolveBreakPolicyAtTimestamp(policy, at),
          );
          expect(resolveBreakPolicyAtTimestamp(changed, savedAt)).toEqual(withoutDate(next));
        },
      ),
    );
  });
});

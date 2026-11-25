import fc from 'fast-check';
import type { BreakPolicyValues } from '@/lib/time-tracking/settings';

/**
 * An automatic rule the settings form accepts (break-rule-form.ts): a break no longer than its
 * threshold, a later second threshold, a second total break at least the first, and extra minutes
 * that fit between the two thresholds. Every length is a whole minute drawn within its bounds, so
 * both shares are positive often.
 */
export const automaticBreakRuleArbitrary: fc.Arbitrary<BreakPolicyValues> = fc
  .integer({ min: 1, max: 720 })
  .chain((firstThreshold) =>
    fc.tuple(
      fc.constant(firstThreshold),
      fc.integer({ min: 0, max: Math.min(firstThreshold, 120) }),
      fc.option(fc.integer({ min: firstThreshold + 1, max: Math.min(firstThreshold + 600, 1440) }), {
        nil: null,
      }),
    ),
  )
  .chain(([firstThreshold, firstDuration, secondThreshold]): fc.Arbitrary<BreakPolicyValues> => {
    const rule: Omit<BreakPolicyValues, 'secondStep'> = {
      breakMode: 'automatic',
      autoBreakThresholdMinutes: firstThreshold,
      autoBreakDurationMinutes: firstDuration,
    };
    if (secondThreshold === null) return fc.constant({ ...rule, secondStep: null });
    return fc.integer({ min: 0, max: Math.min(secondThreshold - firstThreshold, 120) }).map((extra) => ({
      ...rule,
      secondStep: { thresholdMinutes: secondThreshold, durationMinutes: firstDuration + extra },
    }));
  });

import fc from 'fast-check';
import type { BreakPolicyValues } from '@/lib/time-tracking/settings';

/**
 * An automatic rule the settings form accepts (break-rule-form.ts): a break no longer than its
 * threshold, a later second threshold, a second total break at least the first, and extra minutes
 * that fit between the two thresholds.
 */
export const automaticBreakRuleArbitrary: fc.Arbitrary<BreakPolicyValues> = fc
  .record({
    firstThreshold: fc.integer({ min: 1, max: 720 }),
    firstShare: fc.double({ min: 0, max: 1, noNaN: true }),
    second: fc.option(
      fc.record({
        later: fc.integer({ min: 1, max: 600 }),
        extraShare: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
      { nil: null },
    ),
  })
  .map(({ firstThreshold, firstShare, second }) => {
    const firstDuration = Math.floor(firstThreshold * firstShare);
    const secondThreshold = second ? Math.min(firstThreshold + second.later, 1440) : 0;
    return {
      breakMode: 'automatic' as const,
      autoBreakThresholdMinutes: firstThreshold,
      autoBreakDurationMinutes: firstDuration,
      secondStep:
        second === null || secondThreshold <= firstThreshold
          ? null
          : {
              thresholdMinutes: secondThreshold,
              durationMinutes:
                firstDuration + Math.floor((secondThreshold - firstThreshold) * second.extraShare),
            },
    };
  });

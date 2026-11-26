import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { computeTimeBreakdown, formatDuration, formatSignedDuration } from './helpers';

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/time-tracking.md, "Targets": a day's presence splits into work, break and
// overtime against its target, and overtime is only the work beyond the target. A balance shows
// with its sign.

const minutesArbitrary = fc.integer({ min: 0, max: 24 * 60 });

describe('A day’s breakdown', () => {
  test('splits presence into work, break and overtime that add up to it', () => {
    fc.assert(
      fc.property(
        minutesArbitrary,
        fc.nat({ max: 24 * 60 }),
        minutesArbitrary,
        (presence, tracked, target) => {
          const { workMinutes, breakMinutes, overtimeMinutes } = computeTimeBreakdown(
            presence,
            tracked,
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

  test('never counts overtime before the target is reached', () => {
    fc.assert(
      fc.property(minutesArbitrary, minutesArbitrary, (work, target) => {
        fc.pre(work <= target);
        expect(computeTimeBreakdown(work, 0, target).overtimeMinutes).toBe(0);
      }),
    );
  });
});

describe('A duration as shown', () => {
  test('reads back its whole minutes and shows a balance with its sign', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000 }), (minutes) => {
        const shown = formatDuration(Math.abs(minutes));
        const hours = Number(/(\d+) Std\./.exec(shown)?.[1] ?? 0);
        const rest = Number(/(\d+) Min\./.exec(shown)?.[1] ?? 0);
        expect(hours * 60 + rest).toBe(Math.abs(minutes));
        expect(formatSignedDuration(minutes)).toBe(`${minutes >= 0 ? '+' : '−'}${shown}`);
      }),
    );
  });
});

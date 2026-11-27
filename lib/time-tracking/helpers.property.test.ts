import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { formatDuration, formatSignedDuration } from './helpers';

// Property tests (docs/technical/testing.md, "Property tests"): a balance shows with its sign.

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

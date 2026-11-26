import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { MINUTE_MS, correctionStartArbitrary } from '@/lib/testing/time-correction-arbitraries';
import type { TimeSegmentKind } from '@/lib/time-tracking/types';
import { findBreakShortfall } from './break-warning';
import { newTimelineRow, type ResolvedTimelineSegment } from './timeline';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Added time as a timeline": the form warns when more than 6 hours of work carry less than 30
// minutes of break, or more than 9 hours less than 45 minutes, counting breaks and gaps of at
// least 15 minutes; every activity but a break counts as work.

type Draw = { kind: TimeSegmentKind; gap: number; minutes: number };

const drawArbitrary: fc.Arbitrary<Draw> = fc.oneof(
  fc.record({
    kind: fc.constantFrom<TimeSegmentKind>('work', 'travel', 'standby', 'callout', 'internal_activity'),
    gap: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 14 }), fc.integer({ min: 15, max: 90 })),
    minutes: fc.integer({ min: 1, max: 300 }),
  }),
  fc.record({
    kind: fc.constant<TimeSegmentKind>('break'),
    gap: fc.constant(0),
    minutes: fc.oneof(fc.integer({ min: 1, max: 14 }), fc.integer({ min: 15, max: 60 })),
  }),
);

function segmentsOf(start: number, draws: readonly Draw[]): ResolvedTimelineSegment[] {
  let cursor = start;
  return draws.map((draw, index) => {
    const startedAt = cursor + draw.gap * MINUTE_MS;
    cursor = startedAt + draw.minutes * MINUTE_MS;
    return {
      row: newTimelineRow(`row-${index}`, { kind: draw.kind }),
      startedAt: new Date(startedAt),
      endedAt: new Date(cursor),
    };
  });
}

/** The § 4 step the drawn day misses, read from the draws: work, and every break and gap of 15 minutes or more. */
function missedStep(
  draws: readonly Draw[],
): { workAboveHours: 6 | 9; required: 30 | 45; counted: number } | null {
  const work = draws.filter((draw) => draw.kind !== 'break').reduce((sum, draw) => sum + draw.minutes, 0);
  const rests = draws.flatMap((draw, index) => [
    ...(index > 0 ? [draw.gap] : []),
    ...(draw.kind === 'break' ? [draw.minutes] : []),
  ]);
  const counted = rests.filter((minutes) => minutes >= 15).reduce((sum, minutes) => sum + minutes, 0);
  if (work > 9 * 60) return counted < 45 ? { workAboveHours: 9, required: 45, counted } : null;
  if (work > 6 * 60) return counted < 30 ? { workAboveHours: 6, required: 30, counted } : null;
  return null;
}

const workDay = (...draws: Draw[]): [number, Draw[]] => [Date.parse('2026-11-23T06:00:00Z'), draws];

describe('The break warning of added time', () => {
  test('names the missed step exactly when the work exceeds 6 or 9 hours without its counted break', () => {
    fc.assert(
      fc.property(
        correctionStartArbitrary,
        fc.array(drawArbitrary, { minLength: 1, maxLength: 10 }),
        (start, draws) => {
          const shortfall = findBreakShortfall(segmentsOf(start, draws));
          const missed = missedStep(draws);
          if (missed)
            expect(shortfall).toEqual({
              kind: 'total',
              workAboveHours: missed.workAboveHours,
              requiredBreakMinutes: missed.required,
              countedBreakMinutes: missed.counted,
            });
          else expect(shortfall?.kind).not.toBe('total');
        },
      ),
      {
        examples: [
          // 6 hours and a minute of work with a 29-minute break.
          workDay(
            { kind: 'work', gap: 0, minutes: 181 },
            { kind: 'break', gap: 0, minutes: 29 },
            { kind: 'work', gap: 0, minutes: 180 },
          ),
          // Exactly 6 hours of work with no break.
          workDay({ kind: 'work', gap: 0, minutes: 180 }, { kind: 'travel', gap: 14, minutes: 180 }),
          // 9 hours and a minute: a 15-minute gap and a 29-minute break count 44 minutes.
          workDay(
            { kind: 'work', gap: 0, minutes: 271 },
            { kind: 'break', gap: 0, minutes: 29 },
            { kind: 'standby', gap: 0, minutes: 135 },
            { kind: 'callout', gap: 15, minutes: 135 },
          ),
        ],
      },
    );
  });
});

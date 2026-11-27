import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { addLocalDays } from '@/lib/date-time/berlin';
import {
  berlinMidnightMs,
  berlinMinuteInstantMsArbitrary,
  berlinOffsetMinutes,
} from '@/lib/testing/berlin-arbitraries';
import { createActivitySelection, splitSegmentAtLocalDayBoundaries, type TimeSegmentFact } from './segments';
import type { TimeSegmentKind } from './types';

// Property tests (docs/technical/testing.md, "Property tests"). The rule comes from
// docs/features/time-tracking.md, "Live capture": the split at midnight (Europe/Berlin) is display
// only and keeps every minute. The day totals counted from the split live in
// clock-day-totals.property.test.ts.

const MINUTE_MS = 60_000;
/** Every segment here is closed; the open tail's clock is pinned anyway, so no wall clock is read. */
const NOW = new Date('2100-01-01T00:00:00Z');

const oracleDate = (instant: number): string =>
  new Date(instant + berlinOffsetMinutes(instant) * MINUTE_MS).toISOString().slice(0, 10);

function segment(kind: TimeSegmentKind, startMs: number, minutes: number, index: number): TimeSegmentFact {
  return {
    ...createActivitySelection(kind, kind === 'break' ? null : 'job-1'),
    id: `segment-${index}`,
    sessionId: 'session-1',
    organizationId: 'organization-1',
    employeeRecordId: 'employee-1',
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(startMs + minutes * MINUTE_MS).toISOString(),
  };
}

const minutesOf = (slice: { startedAt: string; endedAt: string | null }): number =>
  (Date.parse(slice.endedAt ?? slice.startedAt) - Date.parse(slice.startedAt)) / MINUTE_MS;

describe('A session’s segments', () => {
  test('split at each Berlin midnight into one slice per day that keeps every minute', () => {
    fc.assert(
      fc.property(
        berlinMinuteInstantMsArbitrary,
        fc.integer({ min: 1, max: 3 * 24 * 60 }),
        (start, minutes) => {
          const fact = segment('work', start, minutes, 0);
          const wide = { start: new Date(start - 4 * 86_400_000), end: new Date(start + 8 * 86_400_000) };
          const slices = splitSegmentAtLocalDayBoundaries(fact, wide.start, wide.end, NOW);
          expect(slices.reduce((sum, slice) => sum + minutesOf(slice), 0)).toBe(minutes);
          expect(slices[0]?.startedAt).toBe(fact.startedAt);
          expect(slices.at(-1)?.endedAt).toBe(fact.endedAt);
          slices.forEach((slice, index) => {
            const first = Date.parse(slice.startedAt);
            const last = Date.parse(slice.endedAt ?? slice.startedAt) - 1;
            expect(oracleDate(last)).toBe(oracleDate(first));
            if (index > 0) expect(first).toBe(berlinMidnightMs(oracleDate(first)));
            const next = slices[index + 1];
            if (next) expect(oracleDate(Date.parse(next.startedAt))).toBe(addLocalDays(oracleDate(first), 1));
          });
        },
      ),
    );
  });
});

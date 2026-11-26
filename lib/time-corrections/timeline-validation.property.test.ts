import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  berlinDateArbitrary,
  berlinDayLengthHours,
  berlinMidnightMs,
} from '@/lib/testing/berlin-arbitraries';
import {
  DAY_MINUTES,
  MINUTE_MS,
  clockMinutes,
  correctionFact,
  openTimeArbitrary,
  openTimeFacts,
  oracleBerlinDate,
  recordedEntry,
} from '@/lib/testing/time-correction-arbitraries';
import type { TimeEntry } from '@/lib/time-tracking/types';
import {
  correctionTimelineWindow,
  exceedsLongestOpenTime,
  splitCorrectionFactsAtMidnight,
  validateCorrectionTimeline,
} from './timeline-validation';
import type { TimeCorrectionApplicationProjection, TimeCorrectionFact } from './types';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Corrections over midnight": time past 00:00 Europe/Berlin goes in as one correction, closes and
// reopens at 00:00, each day is checked on its own, open time over midnight lasts at most 24 hours,
// and a move of only the start or only the end across midnight is refused with that rule.

function candidate(
  facts: TimeCorrectionFact[],
  sources: TimeCorrectionApplicationProjection['sources'] = [],
) {
  return {
    applicationId: 'candidate',
    requestId: 'candidate',
    appliedAt: '2026-11-22T10:00:00Z',
    appliedBy: 'reviewer',
    sourceFingerprint: 'version',
    sources,
    snapshot: { schemaVersion: 1 as const, facts },
  };
}

/** Validates a candidate as the server does: the days of its before and proposed facts. */
function validate(
  before: readonly TimeCorrectionFact[],
  proposed: TimeCorrectionApplicationProjection,
  entries: readonly TimeEntry[] = [],
) {
  const window = correctionTimelineWindow([...before, ...proposed.snapshot.facts]);
  if (!window) throw new Error('A candidate has facts.');
  return validateCorrectionTimeline({
    organizationId: 'org',
    affectedDays: window.affectedDays,
    entries,
    applications: [],
    candidates: [proposed],
  });
}

const upToADay = openTimeArbitrary(DAY_MINUTES);

describe('Open time over midnight', () => {
  test('is refused exactly when it stays open across midnight for more than 24 hours', () => {
    fc.assert(
      fc.property(openTimeArbitrary(3 * DAY_MINUTES), (time) => {
        const crossesMidnight = oracleBerlinDate(time.start) !== oracleBerlinDate(time.end - 1);
        expect(exceedsLongestOpenTime(openTimeFacts(time, 'shift'))).toBe(
          time.end - time.start > DAY_MINUTES * MINUTE_MS && crossesMidnight,
        );
      }),
    );
  });

  test('splits at 00:00 Berlin into pieces of one day each and keeps every minute', () => {
    fc.assert(
      fc.property(upToADay, (time) => {
        const facts = openTimeFacts(time, 'shift');
        const split = splitCorrectionFactsAtMidnight(facts);
        const originalIds = new Set(facts.map((fact) => fact.factId));
        expect(split.filter((fact) => originalIds.has(fact.factId))).toEqual(facts);
        for (const added of split.filter((fact) => !originalIds.has(fact.factId))) {
          const instant = Date.parse(added.timestamp);
          expect(berlinMidnightMs(oracleBerlinDate(instant))).toBe(instant);
        }
        for (const [index, fact] of split.entries()) {
          const next = split[index + 1];
          if (!next || fact.entryType === 'clock_out') continue;
          const from = Date.parse(fact.timestamp);
          const to = Date.parse(next.timestamp);
          expect(to).toBeGreaterThanOrEqual(from);
          if (to > from) expect(oracleBerlinDate(to - 1)).toBe(oracleBerlinDate(from));
        }
        expect(clockMinutes(split)).toEqual({ work: time.workMinutes, rest: time.breakMinutes });
      }),
    );
  });

  test('passes the day checks once split, and is refused with the midnight rule unsplit', () => {
    fc.assert(
      fc.property(upToADay, (time) => {
        const facts = openTimeFacts(time, 'shift');
        expect(validate([], candidate(splitCorrectionFactsAtMidnight(facts)))).toBeNull();
        const crossesMidnight = oracleBerlinDate(time.start) !== oracleBerlinDate(time.end - 1);
        expect(validate([], candidate(facts))).toBe(crossesMidnight ? 'correction_crosses_midnight' : null);
      }),
    );
  });
});

/** The Berlin days open time touches, from its start's day to its last minute's, as [day start, next midnight]. */
function berlinDaysOf(start: number, end: number): Array<{ dayStart: number; nextMidnight: number }> {
  const days: Array<{ dayStart: number; nextMidnight: number }> = [];
  for (let dayStart = berlinMidnightMs(oracleBerlinDate(start)); dayStart < end; ) {
    const nextMidnight = dayStart + berlinDayLengthHours(oracleBerlinDate(dayStart)) * 60 * MINUTE_MS;
    days.push({ dayStart, nextMidnight });
    dayStart = nextMidnight;
  }
  return days;
}

/**
 * Open time over midnight and recorded time inside one of its Berlin days, of at least a minute:
 * overlapping the proposal's piece of that day by at least a minute, or a minute or more before
 * or after it. Recorded time never touches the proposal, so no two clock facts share an instant.
 */
const overnightWithRecordedArbitrary = fc
  .tuple(
    upToADay.filter((time) => oracleBerlinDate(time.start) !== oracleBerlinDate(time.end - 1)),
    fc.nat(),
    fc.constantFrom('overlaps', 'before', 'after'),
    fc.nat(),
    fc.nat(),
  )
  .map(([time, dayDraw, placement, firstDraw, secondDraw]) => {
    const days = berlinDaysOf(time.start, time.end);
    const day = days[dayDraw % days.length];
    if (!day) throw new Error('Open time touches at least one day.');
    const pieceStart = Math.max(time.start, day.dayStart);
    const pieceEnd = Math.min(time.end, day.nextMidnight);
    const minuteIn = (from: number, to: number, draw: number): number =>
      from + (draw % ((to - from) / MINUTE_MS + 1)) * MINUTE_MS;
    if (placement === 'overlaps') {
      const start = minuteIn(day.dayStart, pieceEnd - MINUTE_MS, firstDraw);
      const end = minuteIn(Math.max(start, pieceStart) + MINUTE_MS, day.nextMidnight, secondDraw);
      return { time, recorded: { start, end }, overlaps: true };
    }
    const [from, to] =
      placement === 'before'
        ? [day.dayStart, pieceStart - MINUTE_MS]
        : [pieceEnd + MINUTE_MS, day.nextMidnight];
    if (to - from < MINUTE_MS) return null;
    const start = minuteIn(from, to - MINUTE_MS, firstDraw);
    return { time, recorded: { start, end: minuteIn(start + MINUTE_MS, to, secondDraw) }, overlaps: false };
  })
  .filter((drawn) => drawn !== null);

describe('Open time over midnight and recorded time', () => {
  test('is refused as an overlap exactly when recorded time on either day overlaps it', () => {
    fc.assert(
      fc.property(overnightWithRecordedArbitrary, ({ time, recorded, overlaps }) => {
        const entries = [
          recordedEntry('recorded-in', 'clock_in', recorded.start),
          recordedEntry('recorded-out', 'clock_out', recorded.end),
        ];
        const proposal = candidate(splitCorrectionFactsAtMidnight(openTimeFacts(time, 'shift')));
        expect(validate([], proposal, entries)).toBe(overlaps ? 'correction_timeline_conflict' : null);
      }),
      {
        examples: [
          // 22:00 to 01:30 Berlin, recorded 21:00 to 22:30 the evening before.
          [
            {
              time: {
                start: Date.parse('2026-01-15T21:00:00Z'),
                end: Date.parse('2026-01-16T00:30:00Z'),
                break: null,
                workMinutes: 210,
                breakMinutes: 0,
              },
              recorded: {
                start: Date.parse('2026-01-15T20:00:00Z'),
                end: Date.parse('2026-01-15T21:30:00Z'),
              },
              overlaps: true,
            },
          ],
          // The same shift, recorded 01:00 to 02:00 the morning after.
          [
            {
              time: {
                start: Date.parse('2026-01-15T21:00:00Z'),
                end: Date.parse('2026-01-16T00:30:00Z'),
                break: null,
                workMinutes: 210,
                breakMinutes: 0,
              },
              recorded: {
                start: Date.parse('2026-01-16T00:00:00Z'),
                end: Date.parse('2026-01-16T01:00:00Z'),
              },
              overlaps: true,
            },
          ],
        ],
      },
    );
  });
});

/** Recorded time inside one Berlin day: its date, start and end, and the day's next midnight. */
const dayTimeArbitrary = berlinDateArbitrary.chain((localDate) => {
  const dayMinutes = berlinDayLengthHours(localDate) * 60;
  return fc
    .integer({ min: 0, max: dayMinutes - 1 })
    .chain((offset) =>
      fc.tuple(fc.constant(localDate), fc.constant(offset), fc.integer({ min: 1, max: dayMinutes - offset })),
    )
    .map(([date, offset, minutes]) => {
      const midnight = berlinMidnightMs(date);
      return {
        start: midnight + offset * MINUTE_MS,
        end: midnight + (offset + minutes) * MINUTE_MS,
        dayStart: midnight,
        nextMidnight: midnight + dayMinutes * MINUTE_MS,
      };
    });
});

describe('A correction of only one boundary of recorded time', () => {
  test('is refused with the midnight rule exactly when it moves the start or the end across midnight', () => {
    fc.assert(
      fc.property(
        dayTimeArbitrary,
        fc.boolean(),
        fc.integer({ min: 1, max: 3 * DAY_MINUTES }),
        (day, movesStart, minutes) => {
          const recorded = [
            recordedEntry('recorded-in', 'clock_in', day.start),
            recordedEntry('recorded-out', 'clock_out', day.end),
          ];
          // The new start lies up to three days before the end, the new end up to three days after the start.
          const moved = movesStart
            ? Math.max(day.end - minutes * MINUTE_MS, day.dayStart - 3 * DAY_MINUTES * MINUTE_MS)
            : day.start + minutes * MINUTE_MS;
          const entryType = movesStart ? 'clock_in' : 'clock_out';
          const source = movesStart ? recorded[0] : recorded[1];
          if (!source) throw new Error('Both boundaries are recorded.');
          const before = correctionFact('before', entryType, Date.parse(source.timestamp));
          const proposal = candidate(
            [correctionFact('moved', entryType, moved)],
            [{ kind: 'legacy_entry', id: source.id, version: source.timestamp }],
          );
          const leavesTheDay = movesStart ? moved < day.dayStart : moved > day.nextMidnight;
          expect(validate([before], proposal, recorded)).toBe(
            leavesTheDay ? 'correction_crosses_midnight' : null,
          );
        },
      ),
    );
  });
});

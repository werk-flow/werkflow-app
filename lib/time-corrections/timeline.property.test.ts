import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { berlinDateArbitrary, daysInMonth } from '@/lib/testing/berlin-arbitraries';
import {
  DAY_MINUTES,
  MINUTE_MS,
  clockMinutes,
  correctionStartArbitrary,
  oracleBerlinDate,
  oracleBerlinWallTime,
} from '@/lib/testing/time-correction-arbitraries';
import type { ClosedTimePeriod } from '@/lib/time-tracking/closed-period-dates';
import type { TimeSegmentKind } from '@/lib/time-tracking/types';
import {
  buildTimelineFacts,
  closedPeriodRowKeys,
  insertBreakIntoRow,
  newTimelineRow,
  resolveCorrectionTimeline,
  type CorrectionTimelineRow,
  type ResolvedTimelineSegment,
} from './timeline';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Added time as a timeline" and "Closed periods": an end before its start is refused unless the
// activity ends the next day, a break lies directly between two activities, a gap clocks out,
// „Pause einfügen“ splits an activity around a 30-minute break, a proposal stays open at most 24
// hours, and time that reaches into a closed period is marked.

const DAY_MS = DAY_MINUTES * MINUTE_MS;

const wallTimeOf = (minutes: number): string => {
  const ofDay = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(ofDay / 60)).padStart(2, '0')}:${String(ofDay % 60).padStart(2, '0')}`;
};
const minutesOfWallTime = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const nextDate = (localDate: string): string =>
  new Date(Date.parse(`${localDate}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/** The instants that show a Berlin wall time: none in the spring gap, two in the autumn overlap. */
function oracleInstants(localDate: string, time: string): number[] {
  const asUtc = Date.parse(`${localDate}T${time}:00Z`);
  return [60, 120]
    .map((offsetMinutes) => asUtc - offsetMinutes * MINUTE_MS)
    .filter((instant) => oracleBerlinWallTime(instant) === `${localDate}T${time}`);
}

/** Every real duration between two Berlin wall times, one per reading of an autumn-overlap time. */
function oracleDurations(fromDate: string, from: string, toDate: string, to: string): number[] {
  return oracleInstants(fromDate, from).flatMap((start) =>
    oracleInstants(toDate, to).map((end) => end - start),
  );
}

const minuteOfDay = fc.integer({ min: 0, max: DAY_MINUTES - 1 });
const activityKind = fc.constantFrom<TimeSegmentKind>(
  'work',
  'travel',
  'standby',
  'callout',
  'internal_activity',
);

describe('A row of added time', () => {
  test('refuses an end at or before its start unless it ends the next day, and then ends on the next day', () => {
    fc.assert(
      fc.property(
        berlinDateArbitrary,
        minuteOfDay,
        minuteOfDay,
        fc.boolean(),
        (localDate, a, b, endsNextDay) => {
          const start = wallTimeOf(Math.max(a, b));
          const end = wallTimeOf(Math.min(a, b));
          const result = resolveCorrectionTimeline(localDate, [
            newTimelineRow('row', { start, end, endsNextDay }),
          ]);
          if (!endsNextDay) {
            expect(result.valid ? undefined : result.errors[0]?.end).toBeString();
            return;
          }
          const durations = oracleDurations(localDate, start, nextDate(localDate), end);
          if (durations.every((duration) => duration > DAY_MS)) expect(result.valid).toBe(false);
          if (durations.length > 0 && durations.every((duration) => duration <= DAY_MS))
            expect(result.valid).toBe(true);
          if (!result.valid) return;
          const [segment] = result.segments;
          expect(segment && oracleBerlinWallTime(segment.startedAt.getTime())).toBe(`${localDate}T${start}`);
          expect(segment && oracleBerlinWallTime(segment.endedAt.getTime())).toBe(
            `${nextDate(localDate)}T${end}`,
          );
        },
      ),
      {
        examples: [
          ['2026-10-25', 600, 600, true],
          ['2026-03-29', 150, 60, true],
          ['2026-11-22', 600, 600, false],
        ],
      },
    );
  });

  test('ends on its own day when the end follows the start, also when marked for the next day', () => {
    fc.assert(
      fc.property(
        berlinDateArbitrary,
        minuteOfDay,
        minuteOfDay,
        fc.boolean(),
        (localDate, a, b, endsNextDay) => {
          fc.pre(a !== b);
          const start = wallTimeOf(Math.min(a, b));
          const end = wallTimeOf(Math.max(a, b));
          const result = resolveCorrectionTimeline(localDate, [
            newTimelineRow('row', { start, end, endsNextDay }),
          ]);
          const durations = oracleDurations(localDate, start, localDate, end);
          if (durations.length === 0) expect(result.valid).toBe(false);
          if (durations.length > 0 && durations.every((duration) => duration <= DAY_MS))
            expect(result.valid).toBe(true);
          if (!result.valid) return;
          const [segment] = result.segments;
          expect(segment && oracleBerlinDate(segment.endedAt.getTime())).toBe(localDate);
        },
      ),
    );
  });
});

/** Rows in order from a wall-time offset on a date, each after a gap of 0 to 3 hours, sometimes marked wrongly. */
const timelineArbitrary = fc
  .tuple(
    berlinDateArbitrary,
    minuteOfDay,
    fc.array(
      fc.record({
        kind: fc.oneof(activityKind, fc.constant<TimeSegmentKind>('break')),
        gap: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 180 })),
        minutes: fc.integer({ min: 1, max: 600 }),
        mismarked: fc.integer({ min: 0, max: 9 }).map((draw) => draw === 0),
      }),
      { minLength: 1, maxLength: 5 },
    ),
  )
  .map(([localDate, offset, draws]) => {
    let cursor = offset;
    const rows = draws.map((draw, index): CorrectionTimelineRow => {
      const start = cursor + draw.gap;
      cursor = start + draw.minutes;
      const crosses = Math.floor(cursor / DAY_MINUTES) > Math.floor(start / DAY_MINUTES);
      return newTimelineRow(`row-${index}`, {
        kind: draw.kind,
        start: wallTimeOf(start),
        end: wallTimeOf(cursor),
        endsNextDay: crosses !== draw.mismarked,
        jobId: index % 2 === 0 ? 'job' : null,
      });
    });
    return { localDate, rows };
  });

const minutesOfSegment = (segment: ResolvedTimelineSegment): number =>
  (segment.endedAt.getTime() - segment.startedAt.getTime()) / MINUTE_MS;

describe('A timeline of added time', () => {
  test('that resolves holds its rows in order, at most 24 hours, each break between two activities', () => {
    fc.assert(
      fc.property(timelineArbitrary, ({ localDate, rows }) => {
        const result = resolveCorrectionTimeline(localDate, rows);
        if (!result.valid) return;
        const { segments } = result;
        expect(segments.map((segment) => segment.row)).toEqual(rows);
        for (const [index, segment] of segments.entries()) {
          expect(segment.endedAt.getTime()).toBeGreaterThan(segment.startedAt.getTime());
          expect(oracleBerlinWallTime(segment.startedAt.getTime()).slice(11)).toBe(segment.row.start);
          expect(oracleBerlinWallTime(segment.endedAt.getTime()).slice(11)).toBe(segment.row.end);
          const previous = segments[index - 1];
          if (previous)
            expect(segment.startedAt.getTime()).toBeGreaterThanOrEqual(previous.endedAt.getTime());
          if (segment.row.kind !== 'break') continue;
          const next = segments[index + 1];
          expect(previous?.row.kind !== 'break' && previous?.endedAt.getTime()).toBe(
            segment.startedAt.getTime(),
          );
          expect(next?.row.kind !== 'break' && next?.startedAt.getTime()).toBe(segment.endedAt.getTime());
        }
        const first = segments[0];
        const last = segments.at(-1);
        if (first && last)
          expect(last.endedAt.getTime() - first.startedAt.getTime()).toBeLessThanOrEqual(DAY_MS);
      }),
    );
  });

  test('records every minute as clock facts, and a gap between two activities clocks out', () => {
    fc.assert(
      fc.property(timelineArbitrary, ({ localDate, rows }) => {
        const result = resolveCorrectionTimeline(localDate, rows);
        if (!result.valid) return;
        const facts = buildTimelineFacts(result.segments, 'person-record');
        const breaks = result.segments.filter((segment) => segment.row.kind === 'break');
        const work = result.segments.filter((segment) => segment.row.kind !== 'break');
        expect(clockMinutes(facts)).toEqual({
          work: work.reduce((sum, segment) => sum + minutesOfSegment(segment), 0),
          rest: breaks.reduce((sum, segment) => sum + minutesOfSegment(segment), 0),
        });
        for (const [index, segment] of result.segments.entries()) {
          const previous = result.segments[index - 1];
          if (!previous || previous.endedAt.getTime() === segment.startedAt.getTime()) continue;
          const clockOut = facts.find(
            (fact) => fact.entryType === 'clock_out' && fact.timestamp === previous.endedAt.toISOString(),
          );
          expect(clockOut).toBeDefined();
        }
        expect(facts.at(-1)?.entryType).toBe('clock_out');
      }),
    );
  });
});

/** One activity of at least an hour, its end on the next day when it crosses midnight. */
const longRowArbitrary = fc
  .tuple(berlinDateArbitrary, minuteOfDay, fc.integer({ min: 60, max: DAY_MINUTES }), activityKind)
  .map(([localDate, start, minutes, kind]) => ({
    localDate,
    row: newTimelineRow('activity', {
      kind,
      start: wallTimeOf(start),
      end: wallTimeOf(start + minutes),
      endsNextDay: start + minutes >= DAY_MINUTES,
      jobId: 'job',
    }),
  }));

describe('„Pause einfügen“', () => {
  test('splits an activity around a 30-minute break and keeps the rest of its time', () => {
    fc.assert(
      fc.property(longRowArbitrary, ({ localDate, row }) => {
        let keys = 0;
        const rows = insertBreakIntoRow([row], row.key, () => `new-${(keys += 1)}`);
        if (!rows) throw new Error('An activity of an hour or more takes a break.');
        const [before, pause, after] = rows;
        expect(rows).toHaveLength(3);
        expect(pause?.kind).toBe('break');
        expect([before?.kind, after?.kind, before?.jobId, after?.jobId]).toEqual([
          row.kind,
          row.kind,
          'job',
          'job',
        ]);
        expect([before?.start, before?.end, after?.end]).toEqual([row.start, pause?.start, row.end]);
        expect(after?.start).toBe(pause?.end);
        const wallBreak = minutesOfWallTime(pause?.end ?? '') - minutesOfWallTime(pause?.start ?? '');
        expect((wallBreak + DAY_MINUTES) % DAY_MINUTES).toBe(30);
        const original = resolveCorrectionTimeline(localDate, [row]);
        const split = resolveCorrectionTimeline(localDate, rows);
        if (!original.valid || !split.valid) return;
        const [whole] = original.segments;
        const [first, , last] = split.segments;
        expect(first?.startedAt).toEqual(whole?.startedAt);
        expect(last?.endedAt).toEqual(whole?.endedAt);
      }),
    );
  });

  test('gives a timeline that resolves when the activity does, on days without a clock change', () => {
    fc.assert(
      fc.property(longRowArbitrary, ({ localDate, row }) => {
        fc.pre(
          [localDate, nextDate(localDate)].every(
            (date) =>
              oracleInstants(date, '02:30').length === 1 && oracleInstants(date, '03:30').length === 1,
          ),
        );
        let keys = 0;
        const rows = insertBreakIntoRow([row], row.key, () => `new-${(keys += 1)}`);
        const original = resolveCorrectionTimeline(localDate, [row]);
        const split = rows && resolveCorrectionTimeline(localDate, rows);
        expect(split?.valid).toBe(original.valid);
      }),
    );
  });
});

/** The closed months around an instant's month: the month before, its own and the next, each drawn or not. */
function closedMonths(instant: number, draws: readonly boolean[]): ClosedTimePeriod[] {
  const date = new Date(`${oracleBerlinDate(instant)}T00:00:00Z`);
  return draws.flatMap((closed, index) => {
    if (!closed) return [];
    const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + index - 1, 1));
    const year = month.getUTCFullYear();
    const monthNumber = month.getUTCMonth() + 1;
    const prefix = `${year}-${String(monthNumber).padStart(2, '0')}`;
    return [{ startDate: `${prefix}-01`, endDate: `${prefix}-${daysInMonth(year, monthNumber)}` }];
  });
}

describe('Added time and closed periods', () => {
  test('marks exactly the rows with a minute on a day of a closed period', () => {
    fc.assert(
      fc.property(
        correctionStartArbitrary,
        fc.array(
          fc.tuple(
            fc.integer({ min: -40 * DAY_MINUTES, max: 40 * DAY_MINUTES }),
            fc.integer({ min: 1, max: DAY_MINUTES }),
          ),
          { minLength: 1, maxLength: 4 },
        ),
        fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
        (anchor, spans, draws) => {
          const periods = closedMonths(anchor, draws);
          const segments = spans.map(
            ([offset, minutes], index): ResolvedTimelineSegment => ({
              row: newTimelineRow(`row-${index}`),
              startedAt: new Date(anchor + offset * MINUTE_MS),
              endedAt: new Date(anchor + (offset + minutes) * MINUTE_MS),
            }),
          );
          // A row of up to 24 hours touches at most three days; a closed period is a whole month,
          // so a middle day is closed only when its first or last day's month is.
          const touchesClosedDay = (segment: ResolvedTimelineSegment): boolean => {
            const days = new Set([
              oracleBerlinDate(segment.startedAt.getTime()),
              oracleBerlinDate(segment.endedAt.getTime() - 1),
            ]);
            return [...days].some((day) =>
              periods.some((period) => period.startDate <= day && day <= period.endDate),
            );
          };
          expect(closedPeriodRowKeys(segments, periods)).toEqual(
            segments.filter(touchesClosedDay).map((segment) => segment.row.key),
          );
        },
      ),
    );
  });
});

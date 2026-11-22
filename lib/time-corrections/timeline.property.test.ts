import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  berlinDateArbitrary,
  berlinDayLengthHours,
  berlinMidnightMs,
  daysInMonth,
} from '@/lib/testing/berlin-arbitraries';
import {
  DAY_MINUTES,
  MINUTE_MS,
  correctionStartArbitrary,
  oracleBerlinDate,
  oracleBerlinWallTime,
} from '@/lib/testing/time-correction-arbitraries';
import type { ClosedTimePeriod } from '@/lib/time-tracking/closed-period-dates';
import type {
  TimeActivitySelection,
  TimeInternalActivity,
  TimeSegmentKind,
  TimeStandbyContext,
  TimeTravelRole,
  TimeTravelRoute,
} from '@/lib/time-tracking/types';
import {
  buildTimelineFacts,
  closedPeriodRowKeys,
  insertBreakIntoRow,
  newTimelineRow,
  resolveCorrectionTimeline,
  type CorrectionTimelineRow,
  type ResolvedTimelineSegment,
  type TimelineRowErrors,
} from './timeline';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Added time as a timeline" and "Closed periods": an end before its start is refused unless the
// activity ends the next day, a break lies directly between two activities, a gap clocks out, each
// activity keeps its times, its job and the details live capture asks for,
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

/** A Berlin date whose day and the two after it have 24 hours, so a wall minute is a real minute. */
const plainDateArbitrary = berlinDateArbitrary.filter((localDate) =>
  [localDate, nextDate(localDate), nextDate(nextDate(localDate))].every(
    (date) => berlinDayLengthHours(date) === 24,
  ),
);

/** What a row asks for besides its times, drawn for every kind; only the kinds that carry a detail keep it. */
const detailsArbitrary = fc.record({
  jobId: fc.constantFrom<string | null>('job-a', 'job-b', null),
  travelRoute: fc.constantFrom<TimeTravelRoute>(
    'company_to_site',
    'home_to_site',
    'site_to_site',
    'site_to_company',
    'other',
    'unspecified',
  ),
  travelRole: fc.constantFrom<TimeTravelRole>('driver', 'passenger', 'unspecified'),
  standbyContext: fc.constantFrom<TimeStandbyContext>('on_site', 'remote', 'unspecified'),
  internalType: fc.constantFrom<TimeInternalActivity>('internal_work', 'meeting', 'training', 'other'),
});

/** A row as drawn: its form values and its minutes from midnight of the timeline's date. */
type PlannedRow = { row: CorrectionTimelineRow; from: number; to: number };

/** The form row of an activity from `from` to `to`, marked for the next day exactly when it crosses midnight. */
function plannedRow(
  key: string,
  kind: TimeSegmentKind,
  from: number,
  to: number,
  details: Partial<CorrectionTimelineRow> = {},
): PlannedRow {
  const row = newTimelineRow(key, {
    ...details,
    kind,
    start: wallTimeOf(from),
    end: wallTimeOf(to),
    endsNextDay: Math.floor(to / DAY_MINUTES) > Math.floor(from / DAY_MINUTES),
  });
  return { row, from, to };
}

/**
 * A timeline the form accepts: up to five activities in order, each after a gap of 0 to 60 minutes
 * that stays on the day the previous activity ended, sometimes with a break directly between two
 * activities, at most 24 hours from the first start to the last end.
 */
const validTimelineArbitrary = fc
  .tuple(
    plainDateArbitrary,
    minuteOfDay,
    fc.array(
      fc.record({
        kind: activityKind,
        details: detailsArbitrary,
        gap: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 60 })),
        minutes: fc.integer({ min: 1, max: 240 }),
        breakAfter: fc.option(fc.integer({ min: 1, max: 60 }), { nil: null }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
  )
  .map(([localDate, offset, draws]) => {
    const planned: PlannedRow[] = [];
    let cursor = offset;
    for (const [index, draw] of draws.entries()) {
      const breakMinutes = draws[index - 1]?.breakAfter;
      if (breakMinutes) {
        planned.push(plannedRow(`break-${index}`, 'break', cursor, cursor + breakMinutes));
        cursor += breakMinutes;
      } else if (index > 0) {
        // A row starts on the day the previous one ended: the form has no date per row.
        cursor = Math.min(cursor + draw.gap, (Math.floor(cursor / DAY_MINUTES) + 1) * DAY_MINUTES - 1);
      }
      planned.push(plannedRow(`row-${index}`, draw.kind, cursor, cursor + draw.minutes, draw.details));
      cursor += draw.minutes;
    }
    return { localDate, planned };
  });

const rowsOf = (planned: readonly PlannedRow[]): CorrectionTimelineRow[] => planned.map(({ row }) => row);
const instantOf = (localDate: string, minutes: number): Date =>
  new Date(berlinMidnightMs(localDate) + minutes * MINUTE_MS);

/** The activity a drawn row records: its job only for work, call-out and travel, and its kind's details. */
function plannedActivity({ row }: PlannedRow): TimeActivitySelection {
  const allocation = row.jobId
    ? { allocationKind: 'job' as const, jobId: row.jobId }
    : { allocationKind: 'unallocated' as const, jobId: null };
  switch (row.kind) {
    case 'work':
    case 'callout':
      return { kind: row.kind, ...allocation };
    case 'travel':
      return { kind: 'travel', ...allocation, travelRoute: row.travelRoute, travelRole: row.travelRole };
    case 'break':
      return { kind: 'break', allocationKind: 'none' };
    case 'standby':
      return { kind: 'standby', allocationKind: 'none', standbyContext: row.standbyContext };
    case 'internal_activity':
      return {
        kind: 'internal_activity',
        allocationKind: 'internal_activity',
        internalType: row.internalType,
      };
  }
}

const OVERLAP = 'Die Tätigkeit beginnt vor dem Ende der vorherigen.';
const LOOSE_BREAK = 'Eine Pause liegt direkt zwischen zwei Tätigkeiten.';
const TOO_LONG = 'Ein Nachtrag umfasst höchstens 24 Stunden.';

type Refusal = { planned: PlannedRow[]; index: number; field: keyof TimelineRowErrors; message: string };

/** A row that starts 1 or more minutes before the previous row's end, on that end's day. */
function withOverlap(planned: readonly PlannedRow[], draw: number): Refusal | null {
  const candidates = planned.flatMap((current, index) => {
    const previous = planned[index - 1];
    return previous && previous.to % DAY_MINUTES > 0 ? [{ current, index, previous }] : [];
  });
  const picked = candidates[draw % Math.max(candidates.length, 1)];
  if (!picked) return null;
  const { current, index, previous } = picked;
  const from = previous.to - 1 - (draw % (previous.to % DAY_MINUTES));
  const moved = plannedRow(current.row.key, current.row.kind, from, current.to, current.row);
  return { planned: planned.with(index, moved), index, field: 'start', message: OVERLAP };
}

/** A break that leaves a gap before the next activity, or a break before the first or after the last. */
function withLooseBreak(planned: readonly PlannedRow[], draw: number): Refusal {
  const index = planned.findIndex((item) => item.row.kind === 'break' && item.to - item.from > 1);
  const shortened = planned[index];
  if (shortened && draw % 3 === 0) {
    const to = shortened.to - 1 - (draw % (shortened.to - shortened.from - 1));
    const gapAfter = plannedRow(shortened.row.key, 'break', shortened.from, to);
    return { planned: planned.with(index, gapAfter), index, field: 'kind', message: LOOSE_BREAK };
  }
  const first = planned[0];
  const minutes = 1 + (draw % 60);
  if (first && draw % 3 === 1 && first.from >= minutes) {
    const before = plannedRow('loose-break', 'break', first.from - minutes, first.from);
    return { planned: [before, ...planned], index: 0, field: 'kind', message: LOOSE_BREAK };
  }
  const end = planned.at(-1)?.to ?? 0;
  const after = plannedRow('loose-break', 'break', end, end + minutes);
  return { planned: [...planned, after], index: planned.length, field: 'kind', message: LOOSE_BREAK };
}

/** The last row ends 1 or more minutes past 24 hours after the first start. */
function withTooLong(planned: readonly PlannedRow[], draw: number): Refusal | null {
  const first = planned[0];
  const last = planned.at(-1);
  const index = planned.length - 1;
  // The last row stays shorter than a day, so its end lies on the day after its start.
  if (!first || !last || last.from - first.from < 2) return null;
  const to = first.from + DAY_MINUTES + 1 + (draw % (last.from - first.from - 1));
  const longer = plannedRow(last.row.key, last.row.kind, last.from, to, last.row);
  return { planned: planned.with(index, longer), index, field: 'end', message: TOO_LONG };
}

const refusedTimelineArbitrary = fc
  .tuple(validTimelineArbitrary, fc.constantFrom('overlap', 'loose break', 'too long'), fc.nat())
  .map(([{ localDate, planned }, mistake, draw]) => {
    const refusal =
      mistake === 'overlap'
        ? withOverlap(planned, draw)
        : mistake === 'too long'
          ? withTooLong(planned, draw)
          : withLooseBreak(planned, draw);
    return refusal && { localDate, ...refusal };
  })
  .filter((refused) => refused !== null);

describe('A timeline of added time', () => {
  test('with activities in order, gaps and breaks between two activities resolves to exactly its times', () => {
    fc.assert(
      fc.property(validTimelineArbitrary, ({ localDate, planned }) => {
        expect(resolveCorrectionTimeline(localDate, rowsOf(planned))).toEqual({
          valid: true,
          segments: planned.map(({ row, from, to }) => ({
            row,
            startedAt: instantOf(localDate, from),
            endedAt: instantOf(localDate, to),
          })),
        });
      }),
    );
  });

  test('is refused at the row that overlaps, holds a loose break, or ends past 24 hours', () => {
    fc.assert(
      fc.property(refusedTimelineArbitrary, ({ localDate, planned, index, field, message }) => {
        const result = resolveCorrectionTimeline(localDate, rowsOf(planned));
        expect(result.valid ? 'resolved' : result.errors[index]?.[field]).toBe(message);
      }),
    );
  });

  test('records each activity with its times, job and details, and a gap between two activities clocks out', () => {
    fc.assert(
      fc.property(validTimelineArbitrary, ({ localDate, planned }) => {
        const result = resolveCorrectionTimeline(localDate, rowsOf(planned));
        if (!result.valid) throw new Error('A drawn timeline resolves.');
        const facts = buildTimelineFacts(result.segments, 'person-record');
        // Read back as live capture: each fact but a clock-out opens an activity until the next fact.
        const activities = facts.flatMap((fact, index) => {
          const next = facts[index + 1];
          return fact.entryType === 'clock_out' || !next
            ? []
            : [{ from: fact.timestamp, to: next.timestamp, activity: fact.activity, jobId: fact.jobId }];
        });
        expect(activities).toEqual(
          planned.map((item) => {
            const activity = plannedActivity(item);
            return {
              from: instantOf(localDate, item.from).toISOString(),
              to: instantOf(localDate, item.to).toISOString(),
              activity,
              jobId: 'jobId' in activity ? (activity.jobId ?? null) : null,
            };
          }),
        );
        expect(facts.map((fact) => [fact.activityKind, fact.employeeRecordId])).toEqual(
          facts.map((fact) => [fact.activity.kind, 'person-record']),
        );
        const last = planned.at(-1);
        expect(facts.at(-1)).toMatchObject({
          entryType: 'clock_out',
          timestamp: last && instantOf(localDate, last.to).toISOString(),
        });
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

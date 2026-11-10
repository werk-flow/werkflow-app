// Recorded time reads back as activity intervals: each start pairs with the
// next event that ends it, whatever job that event names, and a tap shorter
// than a minute never shows as a „08:15–08:15“ row.
import { expect, test } from 'bun:test';
import { resolveBerlinWallTime } from '@/lib/date-time/berlin';
import {
  activityDays,
  intervalMinutes,
  isMomentary,
  jobActivityIntervals,
  jobIntervalEntries,
} from './activity-intervals';
import { projectTimeSegmentsToLegacyTransitions, type TimeSegmentFact } from './segments';
import { calculateWorkSessions } from './work-sessions';
import type { TimeEntry, TimeEntryStatus, TimeEntryType, TimeSegmentKind } from './types';

const organizationId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const jobX = '40000000-0000-4000-8000-000000000001';
const jobY = '40000000-0000-4000-8000-000000000002';

/** The fixture's now: 2026-09-18 12:00 in Berlin, the day after the legacy day below. */
const NOW = berlin('2026-09-18T12:00');

function berlin(localDateTime: string): Date {
  const resolved = resolveBerlinWallTime(localDateTime);
  if (!resolved) throw new Error(`Not a Berlin wall time: ${localDateTime}`);
  return resolved.instant;
}

function entry(
  id: string,
  entryType: TimeEntryType,
  localDateTime: string,
  jobId: string | null,
  extra: { status?: TimeEntryStatus; activityKind?: TimeSegmentKind } = {},
): TimeEntry {
  const timestamp = berlin(localDateTime).toISOString();
  return {
    id,
    userId,
    organizationId,
    entryType,
    timestamp,
    isManual: false,
    jobId,
    status: extra.status ?? 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    activityKind: extra.activityKind,
  };
}

/** Every activity of the entries, oldest first, as the Verlauf pairs them. */
function activities(entries: TimeEntry[]) {
  return activityDays(entries, NOW)
    .toReversed()
    .flatMap((day) => day.intervals);
}

/** The legacy clock's day: the job rides on clock-in and break end, never on the break start or clock-out. */
const legacyDay = [
  entry('in', 'clock_in', '2026-09-17T06:57', jobX),
  entry('pause', 'break_start', '2026-09-17T11:08', null),
  entry('resume', 'break_end', '2026-09-17T11:38', jobX),
  entry('out', 'clock_out', '2026-09-17T15:49', null),
];

test('a legacy close without a job id ends the job time it follows, so the past day never reads as running', () => {
  const jobEntries = jobIntervalEntries(legacyDay, jobX, NOW);
  expect(jobEntries.map((jobEntry) => jobEntry.id)).toEqual(['in', 'pause', 'resume', 'out']);

  // The work pack pairs only the job's entries and still reads both stretches as closed.
  const intervals = jobActivityIntervals(jobEntries, jobX, NOW);
  expect(intervals.map((interval) => [interval.state, intervalMinutes(interval, NOW)])).toEqual([
    ['closed', 251],
    ['closed', 251],
  ]);
});

test("a clock-out without a job id ends the job that precedes it, never the next job's time", () => {
  const day = [
    entry('x-in', 'clock_in', '2026-09-17T08:00', jobX),
    entry('x-out', 'clock_out', '2026-09-17T10:00', null),
    entry('y-in', 'clock_in', '2026-09-17T10:00', jobY),
    entry('y-out', 'clock_out', '2026-09-17T12:00', null),
  ];
  expect(jobIntervalEntries(day, jobX, NOW).map((jobEntry) => jobEntry.id)).toEqual(['x-in', 'x-out']);
  expect(jobIntervalEntries(day, jobY, NOW).map((jobEntry) => jobEntry.id)).toEqual(['y-in', 'y-out']);
});

test("a clock-out during the job's break ends the job's day", () => {
  const day = [
    entry('in', 'clock_in', '2026-09-17T07:00', jobX),
    entry('pause', 'break_start', '2026-09-17T09:00', null),
    entry('out', 'clock_out', '2026-09-17T09:30', null),
  ];
  expect(jobIntervalEntries(day, jobX, NOW).map((jobEntry) => jobEntry.id)).toEqual(['in', 'pause', 'out']);
});

test('only an open start of today runs; an open start of an earlier day lacks its end', () => {
  const intervals = activities([
    entry('yesterday', 'clock_in', '2026-09-17T06:57', jobX),
    entry('today', 'clock_in', '2026-09-18T07:30', jobX),
  ]);
  expect(intervals.map((interval) => [interval.id, interval.state, intervalMinutes(interval, NOW)])).toEqual([
    ['yesterday:open', 'unclosed', null],
    ['today:open', 'running', 270],
  ]);
});

test('an end without a start stays visible as an end whose start is missing', () => {
  const [interval] = activities([entry('out', 'clock_out', '2026-09-17T15:49', jobX)]);
  expect(interval?.state).toBe('unopened');
  expect(interval && intervalMinutes(interval, NOW)).toBeNull();
});

test('a rejected entry never closes counted time', () => {
  const intervals = activities([
    entry('in', 'clock_in', '2026-09-17T08:00', jobX),
    entry('rejected-out', 'clock_out', '2026-09-17T09:00', null, { status: 'rejected' }),
    entry('out', 'clock_out', '2026-09-17T16:00', null),
  ]);
  expect(intervals.map((interval) => [interval.id, interval.status])).toEqual([
    ['in:out', 'approved'],
    ['none:rejected-out', 'rejected'],
  ]);
});

test('time with a pending event reads as pending', () => {
  const [interval] = activities([
    entry('in', 'clock_in', '2026-09-17T08:00', jobX),
    entry('out', 'clock_out', '2026-09-17T09:00', null, { status: 'pending' }),
  ]);
  expect(interval?.status).toBe('pending');
});

test('a shorter-than-a-minute span is momentary; a minute, an open span and none are not', () => {
  const start = '2026-09-17T06:15:10.000Z';
  expect(isMomentary(start, '2026-09-17T06:15:10.000Z')).toBe(true);
  expect(isMomentary(start, '2026-09-17T06:16:09.999Z')).toBe(true);
  expect(isMomentary(start, '2026-09-17T06:16:10.000Z')).toBe(false);
  expect(isMomentary(start, null)).toBe(false);
});

function segment(
  id: string,
  kind: 'work' | 'travel' | 'break',
  startedAt: string,
  endedAt: string,
  jobId: string | null,
): TimeSegmentFact {
  const selection =
    kind === 'break'
      ? { kind, allocationKind: 'none' as const }
      : kind === 'travel'
        ? jobId
          ? {
              kind,
              allocationKind: 'job' as const,
              jobId,
              travelRoute: 'company_to_site' as const,
              travelRole: 'driver' as const,
            }
          : {
              kind,
              allocationKind: 'unallocated' as const,
              jobId: null,
              travelRoute: 'company_to_site' as const,
              travelRole: 'driver' as const,
            }
        : jobId
          ? { kind, allocationKind: 'job' as const, jobId }
          : { kind, allocationKind: 'unallocated' as const, jobId: null };
  return {
    ...selection,
    id,
    sessionId: 'session',
    organizationId,
    employeeRecordId: 'record',
    startedAt,
    endedAt,
  };
}

/** The walkthrough's clock: in, travel, break, work again, out, each a few seconds or minutes apart. */
function walkthroughEntries(): TimeEntry[] {
  const segments = [
    segment('work-1', 'work', '2026-09-17T06:12:00.000Z', '2026-09-17T06:14:30.000Z', jobX),
    segment('travel', 'travel', '2026-09-17T06:14:30.000Z', '2026-09-17T06:15:05.000Z', jobX),
    segment('break', 'break', '2026-09-17T06:15:05.000Z', '2026-09-17T06:15:40.000Z', null),
    segment('work-2', 'work', '2026-09-17T06:15:40.000Z', '2026-09-17T06:40:00.000Z', jobX),
  ];
  const kinds = new Map(segments.map((fact) => [fact.id, fact]));
  const points = projectTimeSegmentsToLegacyTransitions(
    segments,
    new Date('2026-09-16T22:00:00.000Z'),
    new Date('2026-09-17T21:59:59.999Z'),
    NOW,
  );
  // The Verlauf receives them sorted by creation, not by time.
  return points
    .map((point, index): TimeEntry => {
      const fact = kinds.get(point.segmentId);
      return {
        id: `${point.segmentId}:${index}:${point.entryType}`,
        userId,
        organizationId,
        entryType: point.entryType,
        timestamp: point.timestamp,
        isManual: false,
        jobId: fact?.jobId ?? null,
        status: 'approved',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: '2026-09-17T06:12:00.000Z',
        updatedAt: '2026-09-17T06:12:00.000Z',
        activityKind: fact?.kind,
        canonicalSegmentId: point.segmentId,
        sourceKind: 'canonical_segment',
      };
    })
    .reverse();
}

test('a day of activities reads as one row per activity in time order, without its momentary taps', () => {
  const [day, ...otherDays] = activityDays(walkthroughEntries(), NOW);
  expect(otherDays).toEqual([]);
  expect(day?.date).toBe('2026-09-17');
  expect(
    day?.intervals.map((interval) => [
      interval.kind,
      interval.jobId,
      interval.start?.timestamp,
      interval.end?.timestamp,
    ]),
  ).toEqual([
    ['work', jobX, '2026-09-17T06:12:00.000Z', '2026-09-17T06:14:30.000Z'],
    ['work', jobX, '2026-09-17T06:15:40.000Z', '2026-09-17T06:40:00.000Z'],
  ]);
});

test('days read newest first', () => {
  const days = activityDays(
    [
      entry('a-in', 'clock_in', '2026-09-16T08:00', jobX),
      entry('a-out', 'clock_out', '2026-09-16T09:00', null),
      ...legacyDay,
    ],
    NOW,
  );
  expect(days.map((day) => [day.date, day.intervals.map((interval) => interval.kind)])).toEqual([
    ['2026-09-17', ['work', 'break', 'work']],
    ['2026-09-16', ['work']],
  ]);
});

test('a status filter keeps whole activities: an approved start with a pending end reads as one pending activity', () => {
  const day = [
    entry('in', 'clock_in', '2026-09-17T08:00', jobX),
    entry('out', 'clock_out', '2026-09-17T09:00', null, { status: 'pending' }),
  ];
  const ids = (status: TimeEntryStatus) =>
    activityDays(day, NOW, status).flatMap((activityDay) =>
      activityDay.intervals.map((interval) => interval.id),
    );
  expect(ids('pending')).toEqual(['in:out']);
  expect(ids('approved')).toEqual([]);
});

test('a start that another start follows lacks its end, as the work sessions behind the totals leave it unpaired', () => {
  const day = [
    entry('x-in', 'clock_in', '2026-09-17T08:00', jobX),
    entry('y-in', 'clock_in', '2026-09-17T10:00', jobY),
    entry('y-out', 'clock_out', '2026-09-17T12:00', null),
  ];
  expect(activities(day).map((interval) => [interval.id, interval.state])).toEqual([
    ['x-in:open', 'unclosed'],
    ['y-in:y-out', 'closed'],
  ]);
  expect(calculateWorkSessions(day).map((session) => session.durationMinutes)).toEqual([null, 120]);
});

test("today's job time that another job's start superseded reads „Ende fehlt“ in the job's own view, never „läuft“", () => {
  const today = [
    entry('x-in', 'clock_in', '2026-09-18T08:00', jobX),
    entry('y-in', 'clock_in', '2026-09-18T10:00', jobY),
    entry('y-out', 'clock_out', '2026-09-18T11:00', null),
  ];
  const jobEntries = jobIntervalEntries(today, jobX, NOW);
  expect(jobEntries.map((jobEntry) => jobEntry.id)).toEqual(['x-in', 'y-in']);
  expect(jobActivityIntervals(jobEntries, jobX, NOW).map((interval) => interval.state)).toEqual(['unclosed']);
});

import fc from 'fast-check';
import type { DailyTarget } from '@/lib/personnel/targets';
import type { clockTotalsState } from '@/lib/time-tracking/canonical-clock-state';
import {
  createActivitySelection,
  projectTimeSegmentsToLegacyTransitions,
  type TimeSegmentFact,
} from '@/lib/time-tracking/segments';
import type { BreakPolicy } from '@/lib/time-tracking/settings';
import type { LiveClockState, TimeEntry, WeeklyTimeDataPoint } from '@/lib/time-tracking/types';
import { buildWeeklyTimeData } from '@/lib/time-tracking/weekly';
import { automaticBreakRuleArbitrary } from './break-rule-arbitraries';

/**
 * Today as the live views see it, for tests of today's split against the week: one attendance
 * session of work, standby and tracked breaks on one Berlin day, whose last segment may still run,
 * with what it holds counted while it is built. The counts never read the modules under test.
 */

const MINUTE_MS = 60_000;

/** Monday, 7 September 2026, in Berlin (CEST): the day every live day lies in. */
export const LIVE_DAY_START = new Date('2026-09-06T22:00:00.000Z');
export const LIVE_DAY_END = new Date('2026-09-07T21:59:59.999Z');
/** 06:00 Berlin; the latest day starts half an hour later and ends by 21:30 Berlin. */
const EARLIEST_START_MS = Date.parse('2026-09-07T04:00:00.000Z');

type LiveDayKind = 'work' | 'standby' | 'break';

export type LiveDay = {
  /** The day's segments in order; the last one runs (`endedAt` null) when `running` is set. */
  segments: TimeSegmentFact[];
  /** The kind of the segment that still runs at `nowMs`, or null when the day has ended. */
  running: LiveDayKind | null;
  /** When the last segment ended, or `nowMs` while it runs. */
  endMs: number;
  nowMs: number;
  /** Everything clocked up to `nowMs`: work, standby and tracked break. */
  presenceMinutes: number;
  standbyMinutes: number;
  trackedBreakMinutes: number;
};

type LiveDayPart = { kind: LiveDayKind; minutes: number };

function segmentOf(id: string, kind: LiveDayKind, startMs: number, endMs: number | null): TimeSegmentFact {
  return {
    id,
    sessionId: 'session',
    organizationId: 'org',
    employeeRecordId: 'record',
    startedAt: new Date(startMs).toISOString(),
    endedAt: endMs === null ? null : new Date(endMs).toISOString(),
    ...createActivitySelection(kind),
  };
}

/** Builds the day from its parts in order; a break never opens the day nor follows a break. */
function liveDayOf(
  startMs: number,
  parts: readonly LiveDayPart[],
  running: boolean,
  idleMinutes: number,
): LiveDay {
  const segments: TimeSegmentFact[] = [];
  const counted = { presenceMinutes: 0, standbyMinutes: 0, trackedBreakMinutes: 0 };
  let atMs = startMs;
  let previous: LiveDayKind | null = null;
  for (const [index, part] of parts.entries()) {
    const kind: LiveDayKind =
      part.kind === 'break' && (previous === null || previous === 'break') ? 'work' : part.kind;
    const endMs = atMs + part.minutes * MINUTE_MS;
    const runs = running && index === parts.length - 1;
    segments.push(segmentOf(`segment-${index}`, kind, atMs, runs ? null : endMs));
    counted.presenceMinutes += part.minutes;
    if (kind === 'standby') counted.standbyMinutes += part.minutes;
    if (kind === 'break') counted.trackedBreakMinutes += part.minutes;
    atMs = endMs;
    previous = kind;
  }
  return {
    segments,
    running: running ? previous : null,
    endMs: atMs,
    nowMs: running ? atMs : atMs + idleMinutes * MINUTE_MS,
    ...counted,
  };
}

const partArbitrary: fc.Arbitrary<LiveDayPart> = fc.record({
  kind: fc.constantFrom<LiveDayKind>('work', 'standby', 'break'),
  minutes: fc.integer({ min: 1, max: 180 }),
});

/** One to five segments, often past eight hours, the last still running or ended up to an hour ago. */
export const liveDayArbitrary: fc.Arbitrary<LiveDay> = fc
  .tuple(
    fc.integer({ min: 0, max: 30 }),
    fc.array(partArbitrary, { minLength: 1, maxLength: 5 }),
    fc.boolean(),
    fc.integer({ min: 0, max: 60 }),
  )
  .map(([startOffset, parts, running, idleMinutes]) =>
    liveDayOf(EARLIEST_START_MS + startOffset * MINUTE_MS, parts, running, idleMinutes),
  );

/** The day as the week reads it once it ends at `nowMs`: the running segment closed then. */
function endedAtNow(day: LiveDay): TimeSegmentFact[] {
  const now = new Date(day.nowMs).toISOString();
  return day.segments.map((segment) => (segment.endedAt === null ? { ...segment, endedAt: now } : segment));
}

/** Standby minutes that still end before Berlin midnight after any live day. */
export const standbyAfterArbitrary = fc.integer({ min: 1, max: 140 });

/** The same day with one more standby segment right after it, still running or just ended. */
export function withStandbyAfter(day: LiveDay, minutes: number, running: boolean): LiveDay {
  const endMs = day.endMs + minutes * MINUTE_MS;
  return {
    segments: [
      ...endedAtNow({ ...day, nowMs: day.endMs }),
      segmentOf('standby-after', 'standby', day.endMs, running ? null : endMs),
    ],
    running: running ? 'standby' : null,
    endMs,
    nowMs: endMs,
    presenceMinutes: day.presenceMinutes + minutes,
    standbyMinutes: day.standbyMinutes + minutes,
    trackedBreakMinutes: day.trackedBreakMinutes,
  };
}

/** Any break rule: automatic in up to two steps, or manual. Its history is empty, so today's rule holds. */
export const liveDayPolicyArbitrary: fc.Arbitrary<BreakPolicy> = fc
  .tuple(automaticBreakRuleArbitrary, fc.boolean())
  .map(([rule, manual]) => ({ ...rule, breakMode: manual ? 'manual' : 'automatic', breakPolicyHistory: [] }));

/** A known target of up to ten hours, or an unknown one. */
export const liveDayTargetArbitrary: fc.Arbitrary<number | undefined> = fc.option(
  fc.integer({ min: 0, max: 600 }),
  { nil: undefined },
);

/** The live day's target row, as the week reads it. */
export function liveDayTarget(targetMinutes: number): DailyTarget {
  return {
    date: '2026-09-07',
    weekday: 0,
    targetMinutes,
    baseTargetMinutes: targetMinutes,
    source: 'schedule',
    outsideEmployment: null,
    isHoliday: false,
    holidayName: null,
    isClosureDay: false,
    closureLabel: null,
    absence: null,
  };
}

/** The week's split of the live day once it has ended at `nowMs`; an unknown target leaves the week without one. */
export function weekDayOf(
  day: LiveDay,
  policy: BreakPolicy,
  target: number | undefined,
): WeeklyTimeDataPoint | undefined {
  const [weekDay] = buildWeeklyTimeData(
    liveDayEntriesOf(endedAtNow(day)),
    LIVE_DAY_START,
    policy,
    target === undefined ? undefined : [liveDayTarget(target)],
  );
  return weekDay;
}

/** The day's segments as the week and the member status read them: projected clock entries carrying their activity. */
export function liveDayEntriesOf(segments: TimeSegmentFact[], now: Date = new Date()): TimeEntry[] {
  const kindOf = new Map(segments.map((fact) => [fact.id, fact.kind]));
  return projectTimeSegmentsToLegacyTransitions(segments, LIVE_DAY_START, LIVE_DAY_END, now).map(
    (point, index) => ({
      id: `${point.segmentId}:${index}`,
      userId: 'user',
      organizationId: 'org',
      entryType: point.entryType,
      timestamp: point.timestamp,
      isManual: false,
      jobId: null,
      status: 'approved',
      reviewedBy: null,
      reviewedAt: null,
      createdAt: point.timestamp,
      updatedAt: point.timestamp,
      activityKind: kindOf.get(point.segmentId),
    }),
  );
}

/**
 * Today's clock state as the server builds it: `totals` are `clockTotalsState` of the day's
 * segments (a server-only module the caller loads), and the last segment may still run.
 */
export function liveClockStateOf(
  segments: readonly TimeSegmentFact[],
  totals: ReturnType<typeof clockTotalsState>,
  fetchedAtMs: number,
): LiveClockState {
  const running = segments.find((fact) => fact.endedAt === null) ?? null;
  const onBreak = running?.kind === 'break';
  return {
    ...totals,
    organizationId: 'org',
    status: running === null ? 'clocked_out' : onBreak ? 'on_break' : 'working',
    isClockedIn: running !== null,
    isOnBreak: onBreak,
    clockInTime: segments[0]?.startedAt ?? null,
    statusStartedAt: running?.startedAt ?? null,
    breakStartTime: onBreak ? running.startedAt : null,
    activeJobId: null,
    activeJobInfo: null,
    captureModel: 'canonical',
    sessionId: 'session',
    sessionVersion: 1,
    currentSegmentId: running?.id ?? null,
    currentActivity: running ? createActivitySelection(running.kind) : null,
    resumeActivity: null,
    resumeJobInfo: null,
    recoveryReason: null,
    legacyOpen: false,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
  };
}

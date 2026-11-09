import { addLocalDays, formatBerlinLocalDateTime, parseBerlinDateTimeInput } from '@/lib/date-time/berlin';
import { UNUSUALLY_LONG_SESSION_MS } from '@/lib/time-tracking/segments';
import type {
  TimeActivitySelection,
  TimeEntryType,
  TimeInternalActivity,
  TimeSegmentKind,
  TimeStandbyContext,
  TimeTravelRole,
  TimeTravelRoute,
} from '@/lib/time-tracking/types';
import { isClockTime, type PlannedCorrectionVisit } from './types';

// A forgotten day as one proposal: the activities of the day in order, each
// with its Berlin wall times, turned into the clock facts live capture would
// have recorded (werk-flow/werkflow-planning#153).

/** The most activities one proposal carries: each adds at most two facts, and a proposal holds 20. */
export const MAX_TIMELINE_ROWS = 10;

/** One activity of the day as the form holds it. Times are `HH:MM`, '' while empty. */
export type CorrectionTimelineRow = {
  /** Stable per row, for the list key and the field ids. */
  key: string;
  kind: TimeSegmentKind;
  start: string;
  end: string;
  /** The end lies on the day after the start, as a night call-out's does. Only an end at or before the start asks for it. */
  endsNextDay: boolean;
  /** The job of work, call-out or travel; null for time without a job. */
  jobId: string | null;
  travelRoute: TimeTravelRoute;
  travelRole: TimeTravelRole;
  standbyContext: TimeStandbyContext;
  internalType: TimeInternalActivity;
};

export type TimelineRowErrors = { kind?: string; start?: string; end?: string };

export type ResolvedTimelineSegment = { row: CorrectionTimelineRow; startedAt: Date; endedAt: Date };

export type ResolvedTimeline =
  | { valid: true; segments: ResolvedTimelineSegment[] }
  | { valid: false; errors: TimelineRowErrors[] };

const MISSING_TIME = 'Bitte gib eine Uhrzeit an.';

/** A new row of the given kind, its fields at the live clock's defaults. */
export function newTimelineRow(
  key: string,
  values: Partial<Omit<CorrectionTimelineRow, 'key'>> = {},
): CorrectionTimelineRow {
  return {
    key,
    kind: 'work',
    start: '',
    end: '',
    endsNextDay: false,
    jobId: null,
    travelRoute: 'unspecified',
    travelRole: 'unspecified',
    standbyContext: 'unspecified',
    internalType: 'internal_work',
    ...values,
  };
}

/**
 * The instants of the rows on the Berlin day `dateIso`. A row's end at or
 * before its start ends on the next day only when the row says so, so a
 * typed-over end never becomes a 23-hour activity; a row starts on the day
 * the previous one ended. A start before the previous end overlaps it and
 * is refused, never moved to the next day.
 */
function resolveRowTimes(dateIso: string, rows: readonly CorrectionTimelineRow[]) {
  const errors: TimelineRowErrors[] = rows.map(() => ({}));
  const segments: ResolvedTimelineSegment[] = [];
  let day = dateIso;
  let previousEnd: string | null = null;
  for (const [index, row] of rows.entries()) {
    const rowErrors = errors[index] ?? {};
    if (!isClockTime(row.start)) rowErrors.start = MISSING_TIME;
    if (!isClockTime(row.end)) rowErrors.end = MISSING_TIME;
    if (rowErrors.start || rowErrors.end) {
      previousEnd = null;
      continue;
    }
    if (previousEnd !== null && row.start < previousEnd) {
      rowErrors.start = 'Die Tätigkeit beginnt vor dem Ende der vorherigen.';
      previousEnd = null;
      continue;
    }
    if (row.end === row.start) rowErrors.end = 'Das Ende muss nach dem Beginn liegen.';
    else if (row.end < row.start && !row.endsNextDay)
      rowErrors.end =
        'Das Ende liegt vor dem Beginn. Geht die Tätigkeit über Mitternacht, wähl „Endet am nächsten Tag“.';
    const endDay = row.end <= row.start ? addLocalDays(day, 1) : day;
    const startedAt = parseBerlinDateTimeInput(`${day}T${row.start}`);
    const endedAt = parseBerlinDateTimeInput(`${endDay}T${row.end}`);
    const missingHour = 'Diese Uhrzeit gibt es an dem Tag wegen der Zeitumstellung nicht.';
    if (!startedAt) rowErrors.start = missingHour;
    if (!endedAt) rowErrors.end = missingHour;
    if (startedAt && endedAt && !rowErrors.end) segments.push({ row, startedAt, endedAt });
    day = endDay;
    previousEnd = row.end;
  }
  return { errors, segments };
}

/**
 * The timeline's segments, or an error per row: every time set and in
 * order, a break only between two activities that it adjoins, and no more
 * than 24 hours from the first start to the last end.
 */
export function resolveCorrectionTimeline(
  dateIso: string,
  rows: readonly CorrectionTimelineRow[],
): ResolvedTimeline {
  const { errors, segments } = resolveRowTimes(dateIso, rows);
  for (const [index, row] of rows.entries()) {
    if (row.kind !== 'break') continue;
    const before = segments.find((segment) => segment.row.key === rows[index - 1]?.key);
    const current = segments.find((segment) => segment.row.key === row.key);
    const after = segments.find((segment) => segment.row.key === rows[index + 1]?.key);
    const adjoins =
      before?.row.kind !== 'break' &&
      after?.row.kind !== 'break' &&
      before?.endedAt.getTime() === current?.startedAt.getTime() &&
      after?.startedAt.getTime() === current?.endedAt.getTime();
    const rowErrors = errors[index];
    if (!adjoins && rowErrors && !rowErrors.start && !rowErrors.end)
      rowErrors.kind = 'Eine Pause liegt direkt zwischen zwei Tätigkeiten.';
  }
  const first = segments[0];
  const last = segments.at(-1);
  const lastErrors = errors.at(-1);
  if (
    first &&
    last &&
    lastErrors &&
    !lastErrors.end &&
    last.endedAt.getTime() - first.startedAt.getTime() > UNUSUALLY_LONG_SESSION_MS
  )
    lastErrors.end = 'Ein Nachtrag umfasst höchstens 24 Stunden.';
  return errors.some((rowErrors) => Object.keys(rowErrors).length > 0) || segments.length !== rows.length
    ? { valid: false, errors }
    : { valid: true, segments };
}

/** The activity a row records, with the details live capture asks for. */
function timelineRowActivity(row: CorrectionTimelineRow): TimeActivitySelection {
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

export type TimelineFact = {
  factId: string;
  employeeRecordId: string;
  entryType: TimeEntryType;
  timestamp: string;
  jobId: string | null;
  activityKind: TimeSegmentKind;
  activity: TimeActivitySelection;
};

/**
 * The clock facts of resolved segments, as live capture projects a session:
 * a break starts and ends inside the session, any other change closes one
 * activity and opens the next at the same instant, and a gap clocks out.
 */
export function buildTimelineFacts(
  segments: readonly ResolvedTimelineSegment[],
  employeeRecordId: string,
): TimelineFact[] {
  const fact = (
    index: number,
    entryType: TimeEntryType,
    instant: Date,
    segment: ResolvedTimelineSegment,
  ): TimelineFact => {
    const activity = timelineRowActivity(segment.row);
    return {
      factId: `activity-${index}-${entryType}`,
      employeeRecordId,
      entryType,
      timestamp: instant.toISOString(),
      jobId: 'jobId' in activity ? activity.jobId : null,
      activityKind: activity.kind,
      activity,
    };
  };
  const facts: TimelineFact[] = [];
  for (const [index, segment] of segments.entries()) {
    const previous = segments[index - 1];
    const adjoins = previous !== undefined && previous.endedAt.getTime() === segment.startedAt.getTime();
    if (adjoins && segment.row.kind === 'break') {
      facts.push(fact(index, 'break_start', segment.startedAt, segment));
    } else if (adjoins && previous.row.kind === 'break') {
      facts.push(fact(index, 'break_end', segment.startedAt, segment));
    } else {
      if (previous) facts.push(fact(index - 1, 'clock_out', previous.endedAt, previous));
      facts.push(fact(index, 'clock_in', segment.startedAt, segment));
    }
  }
  const last = segments.at(-1);
  if (last) facts.push(fact(segments.length - 1, 'clock_out', last.endedAt, last));
  return facts;
}

/**
 * The rows a forgotten day starts from: one work row per planned visit, with
 * its job and times; an all-day visit leaves the times to the person. Without
 * a visit, one empty work row. More visits than a timeline holds prefill
 * nothing and say so, rather than a day that silently lacks some.
 */
export function timelineRowsFromVisits(
  visits: readonly PlannedCorrectionVisit[],
  newKey: () => string,
): { rows: CorrectionTimelineRow[]; overflow: boolean } {
  if (visits.length === 0 || visits.length > MAX_TIMELINE_ROWS)
    return { rows: [newTimelineRow(newKey())], overflow: visits.length > MAX_TIMELINE_ROWS };
  const wallTime = (instant: string | null): string =>
    instant ? formatBerlinLocalDateTime(instant).slice(11) : '';
  const rows = visits.map((visit) => {
    const start = wallTime(visit.startAt);
    const end = wallTime(visit.endAt);
    return newTimelineRow(newKey(), {
      jobId: visit.jobId,
      start,
      end,
      endsNextDay: Boolean(end) && end <= start,
    });
  });
  return { rows, overflow: false };
}

/** A row with the person's change; „Endet am nächsten Tag“ holds only while the end is at or before the start. */
export function editTimelineRow(
  row: CorrectionTimelineRow,
  patch: Partial<Omit<CorrectionTimelineRow, 'key'>>,
): CorrectionTimelineRow {
  const next = { ...row, ...patch };
  return next.start && next.end && next.end <= next.start ? next : { ...next, endsNextDay: false };
}

const MINUTES_PER_DAY = 24 * 60;
const INSERTED_BREAK_MINUTES = 30;

function wallTimeOf(minutes: number): string {
  const ofDay = minutes % MINUTES_PER_DAY;
  return `${String(Math.floor(ofDay / 60)).padStart(2, '0')}:${String(ofDay % 60).padStart(2, '0')}`;
}

/**
 * The rows with a 30-minute break in the middle of one activity, on a
 * quarter hour: the activity ends, the break follows, and the same activity
 * resumes until the old end. Null when the activity is a break, has no
 * complete times, is shorter than an hour, or the timeline is full.
 */
export function insertBreakIntoRow(
  rows: readonly CorrectionTimelineRow[],
  key: string,
  newKey: () => string,
): CorrectionTimelineRow[] | null {
  const index = rows.findIndex((row) => row.key === key);
  const row = rows[index];
  if (!row || row.kind === 'break' || !isClockTime(row.start) || !isClockTime(row.end)) return null;
  if (rows.length + 2 > MAX_TIMELINE_ROWS) return null;
  // The same end day as resolveCorrectionTimeline: an end at or before the start is the next day's only when marked.
  const endsNextDay = row.end <= row.start;
  if (endsNextDay && !row.endsNextDay) return null;
  // Both times are complete `HH:MM` here.
  const minutesOf = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const start = minutesOf(row.start);
  const end = minutesOf(row.end) + (endsNextDay ? MINUTES_PER_DAY : 0);
  if (end - start < 60) return null;
  const breakStart = start + Math.floor((end - start - INSERTED_BREAK_MINUTES) / 2 / 15) * 15;
  const breakEnd = breakStart + INSERTED_BREAK_MINUTES;
  // A part ends on the next day when it starts before midnight and ends at or after it.
  const crossesMidnight = (from: number, to: number): boolean =>
    from < MINUTES_PER_DAY && to >= MINUTES_PER_DAY;
  return [
    ...rows.slice(0, index),
    { ...row, end: wallTimeOf(breakStart), endsNextDay: crossesMidnight(start, breakStart) },
    newTimelineRow(newKey(), {
      kind: 'break',
      start: wallTimeOf(breakStart),
      end: wallTimeOf(breakEnd),
      endsNextDay: crossesMidnight(breakStart, breakEnd),
    }),
    { ...row, key: newKey(), start: wallTimeOf(breakEnd), endsNextDay: crossesMidnight(breakEnd, end) },
    ...rows.slice(index + 1),
  ];
}

import { formatBerlinLocalDate, isSameLocalDay } from '@/lib/date-time/berlin';
import { getEffectiveTimeEntries, sortTimeEntries } from './effective-entries';
import { isBreakEndFollowedByClockIn } from './transition-pairs';
import type { TimeEntry, TimeEntryStatus, TimeSegmentKind } from './types';

// Recorded time as activity intervals: each start paired with the next event
// that ends it on its Berlin day (a clock-out, a break start for work, a break
// end for a break), whatever job that event names. The job time
// reader, the Verlauf and the work pack's „Meine Zeit“ read time through it, and
// the calendar's day hides what `isMomentary` names.

type IntervalFacts = {
  id: string;
  userId: string;
  kind: TimeSegmentKind;
  /** The job its start names; a break names none. */
  jobId: string | null;
  /** Pending while one of its events waits for a decision; rejected and pending deletions pair on their own. */
  status: TimeEntryStatus;
};

/**
 * One activity of one person. `running`: today's start, still open.
 * `unclosed`: a start whose end is missing, on an earlier day or before
 * another start (`supersededBy`). `unopened`: an end without a start.
 */
export type ActivityInterval =
  | (IntervalFacts & {
      state: 'closed';
      start: TimeEntry;
      end: TimeEntry;
      /** The clock-in a break end hands over to, so the break end starts no work of its own. */
      handedOverTo: TimeEntry | null;
    })
  | (IntervalFacts & { state: 'running'; start: TimeEntry; end: null })
  | (IntervalFacts & { state: 'unclosed'; start: TimeEntry; end: null; supersededBy: TimeEntry | null })
  | (IntervalFacts & { state: 'unopened'; start: null; end: TimeEntry });

const ONE_MINUTE_MS = 60_000;

function intervalKind(start: TimeEntry): TimeSegmentKind {
  return start.entryType === 'break_start' ? 'break' : (start.activityKind ?? 'work');
}

function facts(start: TimeEntry, endId: string, status: TimeEntryStatus): IntervalFacts {
  const kind = intervalKind(start);
  return {
    id: `${start.id}:${endId}`,
    userId: start.userId,
    kind,
    jobId: kind === 'break' ? null : start.jobId,
    status,
  };
}

/** Counted time is pending while either event waits; a rejected or pending deletion keeps its own status. */
function pairStatus(
  status: TimeEntryStatus,
  start: TimeEntry | null,
  end: TimeEntry | null,
): TimeEntryStatus {
  if (status !== 'approved') return status;
  return start?.status === 'pending' || end?.status === 'pending' ? 'pending' : 'approved';
}

/** One person's entries of one status group, in time order, as intervals. */
function pairPersonEntries(entries: TimeEntry[], status: TimeEntryStatus, now: Date): ActivityInterval[] {
  const intervals: ActivityInterval[] = [];
  let open: TimeEntry | null = null;
  /** A start without its end: running while it is today's last, else superseded by the next start or the day. */
  const leaveOpen = (start: TimeEntry, supersededBy: TimeEntry | null, dayEnded = false) => {
    const base = { ...facts(start, 'open', pairStatus(status, start, null)), start, end: null };
    if (!supersededBy && !dayEnded && isSameLocalDay(new Date(start.timestamp), now)) {
      intervals.push({ ...base, state: 'running' });
    } else {
      intervals.push({ ...base, state: 'unclosed', supersededBy });
    }
  };
  const close = (start: TimeEntry, end: TimeEntry, handedOverTo: TimeEntry | null = null) => {
    intervals.push({
      ...facts(start, end.id, pairStatus(status, start, end)),
      state: 'closed',
      start,
      end,
      handedOverTo,
    });
  };

  for (const [index, entry] of entries.entries()) {
    if (open && !isSameLocalDay(new Date(open.timestamp), new Date(entry.timestamp))) {
      leaveOpen(open, null, true);
      open = null;
    }
    const onBreak = open?.entryType === 'break_start';
    switch (entry.entryType) {
      case 'clock_in':
        // Only an end event ends time, as the work sessions behind the totals
        // pair it: a start before another start lacks its end.
        if (open) leaveOpen(open, entry);
        open = entry;
        break;
      case 'break_start':
        if (open && !onBreak) close(open, entry);
        else if (open) leaveOpen(open, entry);
        open = entry;
        break;
      case 'break_end': {
        // A break end that a clock-in follows hands over to that clock-in.
        const handedOverTo = isBreakEndFollowedByClockIn(entries, index)
          ? (entries[index + 1] ?? null)
          : null;
        if (open && onBreak) close(open, entry, handedOverTo);
        else if (open) leaveOpen(open, entry);
        open = handedOverTo ? null : entry;
        break;
      }
      case 'clock_out':
        if (open) close(open, entry);
        else {
          intervals.push({
            id: `none:${entry.id}`,
            userId: entry.userId,
            kind: entry.activityKind ?? 'work',
            jobId: entry.jobId,
            status: pairStatus(status, null, entry),
            state: 'unopened',
            start: null,
            end: entry,
          });
        }
        open = null;
        break;
    }
  }
  if (open) leaveOpen(open, null);
  return intervals;
}

/** The instant an interval starts at, or its end when the start is missing. */
export function intervalAnchor(interval: ActivityInterval): TimeEntry {
  return interval.start ?? interval.end;
}

/**
 * Each person's entries as activity intervals in time order. Approved and
 * pending entries pair together, as they count; rejected entries and pending
 * deletions each pair among themselves, so they never close counted time.
 */
function pairActivityIntervals(entries: readonly TimeEntry[], now = new Date()): ActivityInterval[] {
  const groups = new Map<string, { status: TimeEntryStatus; entries: TimeEntry[] }>();
  for (const entry of entries) {
    const status =
      entry.status === 'rejected' || entry.status === 'pending_delete' ? entry.status : 'approved';
    const key = `${entry.userId}:${status}`;
    const group = groups.get(key);
    if (group) group.entries.push(entry);
    else groups.set(key, { status, entries: [entry] });
  }
  return [...groups.values()]
    .flatMap(({ status, entries: groupEntries }) =>
      pairPersonEntries(
        status === 'approved'
          ? getEffectiveTimeEntries(groupEntries, { referenceDate: now })
          : sortTimeEntries(groupEntries),
        status,
        now,
      ),
    )
    .sort(
      (left, right) =>
        Date.parse(intervalAnchor(left).timestamp) - Date.parse(intervalAnchor(right).timestamp) ||
        left.id.localeCompare(right.id),
    );
}

/** The minutes of a closed interval, or of a running one until now; null when an end or start is missing. */
export function intervalMinutes(interval: ActivityInterval, now = new Date()): number | null {
  if (interval.state === 'closed') {
    return (Date.parse(interval.end.timestamp) - Date.parse(interval.start.timestamp)) / ONE_MINUTE_MS;
  }
  if (interval.state === 'running') {
    return Math.max(0, now.getTime() - Date.parse(interval.start.timestamp)) / ONE_MINUTE_MS;
  }
  return null;
}

/**
 * A closed span shorter than a minute: an activity tapped through, which a view
 * in minutes would show as „08:15–08:15“. Views hide it; the day totals and the
 * time account still count it.
 */
export function isMomentary(start: string, end: string | null): boolean {
  return end !== null && Date.parse(end) - Date.parse(start) < ONE_MINUTE_MS;
}

function isMomentaryInterval(interval: ActivityInterval): boolean {
  return interval.state === 'closed' && isMomentary(interval.start.timestamp, interval.end.timestamp);
}

/** Counted time of the job: no break, no rejected time, no time whose deletion waits. */
function isCountedJobTime(interval: ActivityInterval, jobId: string): boolean {
  return (
    interval.kind !== 'break' &&
    interval.jobId === jobId &&
    interval.status !== 'rejected' &&
    interval.status !== 'pending_delete'
  );
}

/**
 * One job's entries in one person's day: each start of the job with the event
 * that ends it, whatever job that event names; the end of a break that
 * interrupts the job's time; and the start that left the job's time without
 * an end. A clock-out or break start that names no job (as the legacy clock
 * wrote them) still ends the job's time, and a clock-out during the break
 * still ends its day.
 */
export function jobIntervalEntries(dayEntries: readonly TimeEntry[], jobId: string, now: Date): TimeEntry[] {
  // A break's end that resumes the job also starts its next stretch: keep it once.
  const entries = new Map<string, TimeEntry>();
  let jobTimeEndId: string | null = null;
  for (const interval of pairActivityIntervals(dayEntries, now)) {
    if (isCountedJobTime(interval, jobId)) {
      // The start that superseded the job's open time keeps it unclosed when the job's entries pair again.
      const supersededBy = interval.state === 'unclosed' ? interval.supersededBy : null;
      for (const entry of [interval.start, interval.end, supersededBy])
        if (entry) entries.set(entry.id, entry);
      jobTimeEndId = interval.end?.id ?? null;
    } else if (
      interval.kind === 'break' &&
      interval.start?.id === jobTimeEndId &&
      interval.state === 'closed'
    ) {
      // With the clock-in a break end hands over to, the break end starts no work when paired again.
      for (const entry of [interval.end, interval.handedOverTo]) if (entry) entries.set(entry.id, entry);
    }
  }
  return [...entries.values()];
}

/** One job's activities of one person, oldest first, without breaks and momentary taps. */
export function jobActivityIntervals(
  entries: readonly TimeEntry[],
  jobId: string,
  now = new Date(),
): ActivityInterval[] {
  return pairActivityIntervals(entries, now).filter(
    (interval) => isCountedJobTime(interval, jobId) && !isMomentaryInterval(interval),
  );
}

/** One Berlin day of a person's history: its activities in time order. */
export type ActivityDay = { date: string; intervals: ActivityInterval[] };

/**
 * A person's history as days, newest first, each with its activities in time
 * order, momentary taps left out. A status keeps only the activities of that
 * status, so an approved start with a pending end reads as one pending
 * activity, never as two halves.
 */
export function activityDays(
  entries: readonly TimeEntry[],
  now = new Date(),
  status?: TimeEntryStatus,
): ActivityDay[] {
  const days = new Map<string, ActivityInterval[]>();
  for (const interval of pairActivityIntervals(entries, now)) {
    if (isMomentaryInterval(interval) || (status && interval.status !== status)) continue;
    const date = formatBerlinLocalDate(intervalAnchor(interval).timestamp);
    const day = days.get(date);
    if (day) day.push(interval);
    else days.set(date, [interval]);
  }
  return [...days]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, intervals]) => ({ date, intervals }));
}

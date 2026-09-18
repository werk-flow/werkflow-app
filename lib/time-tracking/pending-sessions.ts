import type { TimeEntryRow } from './types';
import { getLocalDayKey } from './day-utils';

/**
 * Pending time entries reach the database in one insert per manual submission
 * (`addManualEntry`), so the rows of one session share a user, a local day and
 * a creation instant. Grouping walks each such submission in timestamp order:
 * a clock-in opens a session, breaks attach to the open session and a
 * clock-out closes it. Rows that never pair stay single-entry sessions.
 *
 * The earlier rule paired any two opposite-type rows of a user created within
 * five seconds, regardless of day; a bulk insert therefore welded hundreds of
 * unrelated rows into bogus multi-day sessions (2026-09-18).
 */
export type PendingEntryGroup = {
  /** Id of the row that opened the session (the clock-in when there is one). */
  id: string;
  userId: string;
  /** Local day of the session for display. */
  date: string;
  createdAt: string;
  clockIn: TimeEntryRow | null;
  clockOut: TimeEntryRow | null;
  /** Every row of the session, breaks included, in timestamp order. */
  entries: TimeEntryRow[];
};

const SUBMISSION_WINDOW_MS = 5000;

function splitSubmissions(rows: TimeEntryRow[]): TimeEntryRow[][] {
  const byCreation = [...rows].sort((left, right) => left.created_at.localeCompare(right.created_at));
  const submissions: TimeEntryRow[][] = [];
  let current: TimeEntryRow[] = [];
  let previousCreated = Number.NEGATIVE_INFINITY;
  for (const row of byCreation) {
    const created = new Date(row.created_at).getTime();
    if (current.length > 0 && created - previousCreated > SUBMISSION_WINDOW_MS) {
      submissions.push(current);
      current = [];
    }
    current.push(row);
    previousCreated = created;
  }
  if (current.length > 0) submissions.push(current);
  return submissions;
}

function walkSubmission(rows: TimeEntryRow[], userId: string, date: string): PendingEntryGroup[] {
  const groups: PendingEntryGroup[] = [];
  let open: PendingEntryGroup | null = null;
  const single = (row: TimeEntryRow): PendingEntryGroup => ({
    id: row.id,
    userId,
    date,
    createdAt: row.created_at,
    clockIn: row.entry_type === 'clock_in' ? row : null,
    clockOut: row.entry_type === 'clock_out' ? row : null,
    entries: [row],
  });
  for (const row of [...rows].sort((left, right) => left.timestamp.localeCompare(right.timestamp))) {
    if (row.entry_type === 'clock_in') {
      if (open) groups.push(open);
      open = single(row);
      continue;
    }
    if (!open) {
      groups.push(single(row));
      continue;
    }
    open.entries.push(row);
    if (row.entry_type === 'clock_out') {
      open.clockOut = row;
      groups.push(open);
      open = null;
    }
  }
  if (open) groups.push(open);
  return groups;
}

export function groupPendingEntries(rows: TimeEntryRow[]): PendingEntryGroup[] {
  const byUserAndDay = new Map<string, TimeEntryRow[]>();
  for (const row of rows) {
    const key = `${row.user_id}:${getLocalDayKey(new Date(row.timestamp))}`;
    byUserAndDay.set(key, [...(byUserAndDay.get(key) ?? []), row]);
  }
  const groups: PendingEntryGroup[] = [];
  for (const dayRows of byUserAndDay.values()) {
    const first = dayRows[0];
    if (!first) continue;
    const date = getLocalDayKey(new Date(first.timestamp));
    for (const submission of splitSubmissions(dayRows)) {
      groups.push(...walkSubmission(submission, first.user_id, date));
    }
  }
  return groups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

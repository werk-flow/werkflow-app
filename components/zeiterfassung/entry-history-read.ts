import { readInBackground } from '@/lib/data/background-read-client';
import type { ActivityDay } from '@/lib/time-tracking/activity-intervals';
import type { TimeEntry, TimeEntryAuditEvent } from '@/lib/time-tracking/types';

// What the Verlauf's read (entry-history.tsx) returns and the labels it adds:
// people's names for the office, and the activities' job labels for an
// employee.

export interface EntryWithProfile extends TimeEntry {
  firstName?: string | null;
  lastName?: string | null;
}

/** An employee reads their days as activities; the office reads the entries with their detail. */
export type HistoryLayout = 'activities' | 'entries';

export type EntryHistoryQuery = {
  layout: HistoryLayout;
  organizationId: string;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  statusFilter: string;
  memberFilter: string;
  /** Also read the Admins' own direct changes of the window (Admin and Büro). */
  withOwnChanges: boolean;
};

export type EntryHistoryData = {
  entries: EntryWithProfile[];
  ownChanges: TimeEntryAuditEvent[];
  /** The activities layout's days, and the labels of the jobs they name. */
  days: ActivityDay[];
  jobLabels: Record<string, string>;
};

type ProfileNames = Map<string, { firstName: string | null; lastName: string | null }>;

/**
 * What this view already read: a live refresh after an approval reads the
 * entries only, and names or job labels follow in a second request only for
 * what the view has not shown yet.
 */
export type KnownLabels = { names: ProfileNames; jobLabels: Map<string, string> };

/** The entries with their people's names; null when the names could not be read. */
export async function withProfileNames(
  entries: TimeEntry[],
  knownNames: ProfileNames,
  signal: AbortSignal,
): Promise<EntryWithProfile[] | null> {
  const unknownUserIds = [...new Set(entries.map((e) => e.userId))].filter(
    (userId) => !knownNames.has(userId),
  );
  if (unknownUserIds.length > 0) {
    const profiles = await readInBackground('profiles-by-ids', { userIds: unknownUserIds }, signal);
    if (!profiles.success) return null;
    // A name the server did not return is asked for again on the next read.
    for (const userId of unknownUserIds) {
      const profile = profiles.profiles[userId];
      if (profile) knownNames.set(userId, profile);
    }
  }
  return entries.map((entry) => ({
    ...entry,
    firstName: knownNames.get(entry.userId)?.firstName ?? null,
    lastName: knownNames.get(entry.userId)?.lastName ?? null,
  }));
}

// The job labels of the activities: read once per job and kept across live refreshes.

/** Ids per label read, so the read's address stays short. */
const LABEL_READ_IDS = 100;

/**
 * Adds the labels of the days' jobs that `knownLabels` lacks; false when a
 * read failed. A time correction may name these jobs, so its picker purpose
 * resolves them for every member, a finished job of the person's own time
 * included.
 */
export async function readActivityJobLabels(
  organizationId: string,
  days: readonly ActivityDay[],
  knownLabels: Map<string, string>,
  signal: AbortSignal,
): Promise<boolean> {
  const unknownIds = [
    ...new Set(days.flatMap((day) => day.intervals.flatMap((interval) => interval.jobId ?? []))),
  ].filter((jobId) => !knownLabels.has(jobId));
  const batches: string[][] = [];
  for (let index = 0; index < unknownIds.length; index += LABEL_READ_IDS) {
    batches.push(unknownIds.slice(index, index + LABEL_READ_IDS));
  }
  const results = await Promise.all(
    batches.map((selectedIds) =>
      readInBackground(
        'entity-options',
        { organizationId, kind: 'jobs', purpose: 'time-correction', query: '', offset: 0, selectedIds },
        signal,
      ),
    ),
  );
  for (const result of results) {
    if (!result.success) return false;
    for (const option of result.selected) knownLabels.set(option.value, option.label);
  }
  return true;
}

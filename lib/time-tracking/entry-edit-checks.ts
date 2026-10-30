import 'server-only';
import type { ActionFailure } from '@/lib/action-result';
import { loggedRead, logReadFailure } from '@/lib/data/read-request-cache';
import { formatBerlinLocalDate, isSameLocalDay } from '@/lib/date-time/berlin';
import type { AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import type { z } from '@/lib/zod';
import { getDayBounds } from './action-access';
import type { updateEntryInputSchema } from './action-schemas';
import { toTimeEntries, type TimeEntryRow, type TimeValidationActionFailure } from './types';
import { validateDayEntrySequence, validateTimestampUpdate } from './validation';
import type { TimeValidationFailure } from './validation-messages';

// The checks updateEntry (entry-write-actions.ts) runs on an authorized edit
// before it writes: the day rules on the recorded and the new day, and the
// organization of a named job. The action authorizes the caller first.

/** The user's complete entries on the timestamps' local days; null when a read fails or overflows. */
async function getUserEntriesOnDays(
  admin: AdminClient,
  userId: string,
  orgId: string,
  timestamps: readonly Date[],
): Promise<TimeEntryRow[] | null> {
  const days = [
    ...new Map(timestamps.map((timestamp) => [formatBerlinLocalDate(timestamp), timestamp])).values(),
  ];
  const results = await Promise.all(
    days.map((day) => {
      const { start, end } = getDayBounds(day);
      return readCompleteRows(
        (from, to) =>
          admin
            .from('time_entries')
            .select('*')
            .eq('user_id', userId)
            .eq('organization_id', orgId)
            .gte('timestamp', start.toISOString())
            .lte('timestamp', end.toISOString())
            .order('timestamp', { ascending: false })
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      );
    }),
  );
  const failed = results.find((result) => result.error)?.error;
  if (failed) logReadFailure('Error fetching user entries:', { code: failed.code });
  return failed ? null : results.flatMap((result) => result.data);
}

type EntryEditFields = z.infer<typeof updateEntryInputSchema>['fields'];

/** Whether an edit changes the entry's place in its day's sequence. */
function changesEntrySequence(fields: EntryEditFields): boolean {
  return fields.entryType !== undefined || Object.hasOwn(fields, 'jobId');
}

/**
 * The day rules an edit keeps against the entries of its recorded and its
 * new day: a free timestamp and a valid sequence on the target day. Answers
 * the refused rule, or null when the edit keeps them.
 */
function validateEntryEdit(
  dayRows: TimeEntryRow[],
  entry: TimeEntryRow,
  fields: EntryEditFields,
  targetTimestamp: Date,
): TimeValidationFailure | null {
  const changesSequence = changesEntrySequence(fields);
  if (fields.timestamp) {
    const timeEntries = toTimeEntries(dayRows);

    const validationResult = validateTimestampUpdate(timeEntries, entry.id, new Date(fields.timestamp));

    if (!validationResult.valid) return validationResult.failure;
  }

  if (changesSequence) {
    const timeEntries = toTimeEntries(dayRows);

    const simulatedEntries = timeEntries.map((existingEntry) =>
      existingEntry.id === entry.id
        ? {
            ...existingEntry,
            entryType: fields.entryType ?? existingEntry.entryType,
            jobId: fields.jobId !== undefined ? fields.jobId : existingEntry.jobId,
            timestamp: fields.timestamp ?? existingEntry.timestamp,
          }
        : existingEntry,
    );

    const dayReference = new Date(targetTimestamp);
    const dayEntries = simulatedEntries.filter((timeEntry) =>
      isSameLocalDay(new Date(timeEntry.timestamp), dayReference),
    );
    const sequenceResult = validateDayEntrySequence(dayEntries);

    if (!sequenceResult.valid) return sequenceResult.failure;
  }
  return null;
}

/** The refusal of an edit to the authorized entry, or null when the edit may be written. */
export async function refuseEntryEdit(
  admin: AdminClient,
  entry: TimeEntryRow,
  fields: EntryEditFields,
  targetTimestamp: Date,
): Promise<TimeValidationActionFailure | ActionFailure | null> {
  // Validate timestamp update if provided
  const dayRows =
    fields.timestamp || changesEntrySequence(fields)
      ? await getUserEntriesOnDays(admin, entry.user_id, entry.organization_id, [
          new Date(entry.timestamp),
          targetTimestamp,
        ])
      : [];
  if (!dayRows) return { success: false, error: 'fetch_failed' };
  const editRefusal = validateEntryEdit(dayRows, entry, fields, targetTimestamp);
  if (editRefusal) return { success: false, ...editRefusal };

  // A caller-supplied job must belong to the entry's organization before it is written.
  if (fields.jobId) {
    const { data: job, error: jobError } = await loggedRead(
      'updateEntry: jobs read failed',
      admin
        .from('jobs')
        .select('id')
        .eq('id', fields.jobId)
        .eq('organization_id', entry.organization_id)
        .maybeSingle(),
    );
    if (jobError) return { success: false, error: 'load_failed' };
    if (!job) {
      return { success: false, error: 'job_not_found' };
    }
  }
  return null;
}

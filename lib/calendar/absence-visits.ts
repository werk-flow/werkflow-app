import 'server-only';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { addLocalDays, formatBerlinLocalDateTime, resolveBerlinWallTime } from '@/lib/date-time/berlin';
import { loadOccurrenceDispatchStates } from '@/lib/dispatch/server';
import type { AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readAllRows } from '@/lib/supabase/query-batches';
import { z } from '@/lib/zod';
import type { AbsenceAffectedVisit } from './absence-visits-types';
import { isNoteEntry } from './board';

// Boundary schema of the read below: the aliased, inner-joined embed is
// selected as a string, so the rows are parsed instead of cast.
const affectedOccurrenceRowSchema = z.object({
  id: z.string(),
  entry_kind: z.enum(['job_visit', 'internal']),
  internal_type: z.enum(['internal_work', 'meeting', 'training', 'other']).nullable(),
  time_kind: z.enum(['timed', 'all_day']),
  title: z.string().nullable(),
  start_at: z.string().nullable(),
  start_date: z.string().nullable(),
  job: z
    .object({
      title: z.string(),
      description: z.string().nullable(),
      job_number: z.string().nullable(),
      status: z.enum(['nicht_bearbeitet', 'in_bearbeitung', 'fertig', 'geparkt']),
    })
    .nullable(),
});

const AFFECTED_OCCURRENCE_SELECT: string = [
  'id, entry_kind, internal_type, time_kind, title, start_at, start_date',
  'absent:planning_occurrence_assignments!inner(employee_record_id)',
  'job:jobs!planning_occurrences_job_id_fkey(title, description, job_number, status)',
].join(', ');

/**
 * The scheduled visits of one person that overlap the Berlin dates, in the
 * calendar's order, each with that person's dispatch state. Parked jobs and
 * notes are not work the absence takes away, as on the Plantafel. Null when a
 * read fails or overflows: a missing list is never „nothing affected“.
 */
export async function loadAbsenceAffectedVisits(input: {
  admin: AdminClient;
  orgId: string;
  employeeRecordId: string;
  from: string;
  to: string;
}): Promise<AbsenceAffectedVisit[] | null> {
  const { admin, orgId, employeeRecordId, from, to } = input;
  const fromInstant = resolveBerlinWallTime(`${from}T00:00`);
  const toInstant = resolveBerlinWallTime(`${addLocalDays(to, 1)}T00:00`);
  if (!fromInstant || !toInstant) return null;
  // The window reader's overlap filter; the inner-joined alias carries the person.
  const occurrenceQuery = () =>
    admin
      .from('planning_occurrences')
      .select(AFFECTED_OCCURRENCE_SELECT)
      .eq('organization_id', orgId)
      .eq('status', 'scheduled')
      .eq('absent.employee_record_id', employeeRecordId)
      .or(
        `and(start_at.lt.${toInstant.instant.toISOString()},end_at.gt.${fromInstant.instant.toISOString()}),and(start_date.lte.${to},end_date_exclusive.gt.${from})`,
      )
      .order('id');
  const rows = await readAllRows<unknown, { message: string; code?: string }>(
    (rangeFrom, rangeTo) => occurrenceQuery().range(rangeFrom, rangeTo),
    { cap: LIST_ROW_CAP },
  );
  if (rows.error || rows.overflow) {
    logReadFailure('loadAbsenceAffectedVisits: occurrences failed', {
      code: rows.overflow ? 'row_overflow' : (rows.error?.code ?? 'unknown'),
    });
    return null;
  }
  const parsed = z.array(affectedOccurrenceRowSchema).safeParse(rows.data);
  if (!parsed.success) {
    logReadFailure('loadAbsenceAffectedVisits: occurrences failed', { code: 'unexpected_shape' });
    return null;
  }
  const occurrences = parsed.data.filter(
    (row) =>
      row.job?.status !== 'geparkt' &&
      !isNoteEntry({ entryKind: row.entry_kind, internalType: row.internal_type, timeKind: row.time_kind }),
  );
  const dispatch = await loadOccurrenceDispatchStates(
    admin,
    orgId,
    occurrences.map((row) => row.id),
  );
  if (!dispatch) return null;
  const stateByOccurrence = new Map(
    dispatch.flatMap((entry) =>
      entry.employeeRecordId === employeeRecordId ? [[entry.occurrenceId, entry.state] as const] : [],
    ),
  );
  return occurrences
    .flatMap((row): AbsenceAffectedVisit[] => {
      const startLocal = row.start_at ? formatBerlinLocalDateTime(row.start_at) : null;
      const date = startLocal?.slice(0, 10) ?? row.start_date;
      if (!date) return [];
      return [
        {
          occurrenceId: row.id,
          date,
          time: startLocal?.slice(11, 16) ?? null,
          title: row.job?.title.trim() || row.job?.description?.trim() || row.title || '—',
          jobNumber: row.job?.job_number ?? null,
          dispatchState: stateByOccurrence.get(row.id) ?? 'nicht_gesendet',
        },
      ];
    })
    .sort((left, right) =>
      `${left.date} ${left.time ?? ''}`.localeCompare(`${right.date} ${right.time ?? ''}`),
    );
}

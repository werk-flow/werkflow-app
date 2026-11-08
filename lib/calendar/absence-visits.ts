import 'server-only';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { addLocalDays, formatBerlinLocalDateTime, resolveBerlinWallTime } from '@/lib/date-time/berlin';
import { loadOccurrenceDispatchStates } from '@/lib/dispatch/server';
import type { AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, mapInWindows, readAllRows } from '@/lib/supabase/query-batches';
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
  end_at: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date_exclusive: z.string().nullable(),
  absent: z.array(z.object({ id: z.string(), employee_record_id: z.string() })),
  job: z
    .object({
      title: z.string(),
      description: z.string().nullable(),
      job_number: z.string().nullable(),
      status: z.enum(['nicht_bearbeitet', 'in_bearbeitung', 'fertig', 'geparkt']),
    })
    .nullable(),
});
type AffectedOccurrenceRow = z.infer<typeof affectedOccurrenceRowSchema>;

const AFFECTED_OCCURRENCE_SELECT: string = [
  'id, entry_kind, internal_type, time_kind, title, start_at, end_at, start_date, end_date_exclusive',
  'absent:planning_occurrence_assignments!inner(id, employee_record_id)',
  'job:jobs!planning_occurrences_job_id_fkey(title, description, job_number, status)',
].join(', ');

/** One person's absence over inclusive Berlin dates. */
export type AbsenceVisitWindow = { employeeRecordId: string; from: string; to: string };

/** One affected visit with the assignment that puts the absent person on it. */
export type AbsenceAffectedAssignment = { assignmentId: string; visit: AbsenceAffectedVisit };

type InstantWindow = { from: string; to: string; fromInstant: string; toInstant: string };
type AbsenceInstantWindow = InstantWindow & { employeeRecordId: string };

/**
 * Absences per read. Their people and date windows travel in the query string,
 * which the gateway caps (lib/supabase/query-batches.ts): fifteen of each stay
 * near the size of one id batch.
 */
const ABSENCE_BATCH_SIZE = 15;

/** The Berlin dates as the instants the timed visits compare with; null for a date that does not exist. */
function toInstantWindow(absence: AbsenceVisitWindow): AbsenceInstantWindow | null {
  const fromInstant = resolveBerlinWallTime(`${absence.from}T00:00`);
  const toInstant = resolveBerlinWallTime(`${addLocalDays(absence.to, 1)}T00:00`);
  if (!fromInstant || !toInstant) return null;
  return {
    ...absence,
    fromInstant: fromInstant.instant.toISOString(),
    toInstant: toInstant.instant.toISOString(),
  };
}

/** The absences in reads of at most ABSENCE_BATCH_SIZE, one person's together so their windows merge. */
function absenceBatches(absences: readonly AbsenceInstantWindow[]): AbsenceInstantWindow[][] {
  const ordered = absences.toSorted((left, right) =>
    `${left.employeeRecordId} ${left.from}`.localeCompare(`${right.employeeRecordId} ${right.from}`),
  );
  const batches: AbsenceInstantWindow[][] = [];
  for (let index = 0; index < ordered.length; index += ABSENCE_BATCH_SIZE) {
    batches.push(ordered.slice(index, index + ABSENCE_BATCH_SIZE));
  }
  return batches;
}

/** Overlapping or adjacent date windows merged, so the read's filter names each day once. */
function mergeWindows(windows: readonly InstantWindow[]): InstantWindow[] {
  const merged: InstantWindow[] = [];
  for (const window of windows.toSorted((left, right) => left.from.localeCompare(right.from))) {
    const last = merged.at(-1);
    if (last && window.from <= addLocalDays(last.to, 1)) {
      if (window.to > last.to)
        merged[merged.length - 1] = { ...last, to: window.to, toInstant: window.toInstant };
    } else {
      merged.push(window);
    }
  }
  return merged;
}

/** The window reader's overlap filter, for timed and all-day visits alike. */
function overlapTerms(window: InstantWindow): string {
  return `and(start_at.lt.${window.toInstant},end_at.gt.${window.fromInstant}),and(start_date.lte.${window.to},end_date_exclusive.gt.${window.from})`;
}

function overlaps(row: AffectedOccurrenceRow, window: InstantWindow): boolean {
  if (row.start_at && row.end_at) {
    return (
      Date.parse(row.start_at) < Date.parse(window.toInstant) &&
      Date.parse(row.end_at) > Date.parse(window.fromInstant)
    );
  }
  return (
    row.start_date !== null &&
    row.end_date_exclusive !== null &&
    row.start_date <= window.to &&
    row.end_date_exclusive > window.from
  );
}

/** The scheduled visits of one batch's people over its windows in one paged read; null when it fails or overflows. */
async function readAffectedOccurrences(
  admin: AdminClient,
  orgId: string,
  batch: readonly AbsenceInstantWindow[],
): Promise<AffectedOccurrenceRow[] | null> {
  const employeeRecordIds = [...new Set(batch.map((absence) => absence.employeeRecordId))];
  const overlapFilter = mergeWindows(batch).map(overlapTerms).join(',');
  const occurrenceQuery = () =>
    admin
      .from('planning_occurrences')
      .select(AFFECTED_OCCURRENCE_SELECT)
      .eq('organization_id', orgId)
      .eq('status', 'scheduled')
      .in('absent.employee_record_id', employeeRecordIds)
      .or(overlapFilter)
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
  // Parked jobs and notes are not work an absence takes away, as on the Plantafel.
  return parsed.data.filter(
    (row) =>
      row.job?.status !== 'geparkt' &&
      !isNoteEntry({ entryKind: row.entry_kind, internalType: row.internal_type, timeKind: row.time_kind }),
  );
}

function toAffectedVisit(row: AffectedOccurrenceRow, dispatchState: AbsenceAffectedVisit['dispatchState']) {
  const startLocal = row.start_at ? formatBerlinLocalDateTime(row.start_at) : null;
  const date = startLocal?.slice(0, 10) ?? row.start_date;
  if (!date) return null;
  return {
    occurrenceId: row.id,
    date,
    time: startLocal?.slice(11, 16) ?? null,
    title: row.job?.title.trim() || row.job?.description?.trim() || row.title || '—',
    jobNumber: row.job?.job_number ?? null,
    dispatchState,
  } satisfies AbsenceAffectedVisit;
}

/**
 * The scheduled visits each absence takes its person away from, in the
 * calendar's order and in the order of the absences, each with that person's
 * dispatch state and assignment. The reads follow the number of absences in
 * batches, never the number of visits. Null when a read fails or overflows, or
 * a date does not exist: a missing list is never „nothing affected“.
 */
export async function loadAbsencesAffectedVisits(input: {
  admin: AdminClient;
  orgId: string;
  absences: readonly AbsenceVisitWindow[];
}): Promise<AbsenceAffectedAssignment[][] | null> {
  const { admin, orgId, absences } = input;
  const known = absences.flatMap((absence) => {
    const window = toInstantWindow(absence);
    return window ? [window] : [];
  });
  if (known.length !== absences.length) return null;
  const batches = await mapInWindows(
    absenceBatches(known),
    (batch) => readAffectedOccurrences(admin, orgId, batch),
    (rows) => rows === null,
  );
  if (batches.some((rows) => rows === null)) return null;
  // A visit two batches both reach is read twice; it counts once.
  const occurrences = [
    ...new Map(batches.flatMap((rows) => rows ?? []).map((row) => [row.id, row])).values(),
  ];
  const dispatch = await loadOccurrenceDispatchStates(
    admin,
    orgId,
    occurrences.map((row) => row.id),
  );
  if (!dispatch) return null;
  const stateByAssignment = new Map(
    dispatch.map((entry) => [`${entry.occurrenceId}:${entry.employeeRecordId}`, entry.state] as const),
  );
  return absences.map((absence, index) => {
    const window = known[index];
    if (!window) return [];
    return occurrences
      .flatMap((row): AbsenceAffectedAssignment[] => {
        const assignment = row.absent.find((entry) => entry.employee_record_id === absence.employeeRecordId);
        if (!assignment || !overlaps(row, window)) return [];
        const visit = toAffectedVisit(
          row,
          stateByAssignment.get(`${row.id}:${absence.employeeRecordId}`) ?? 'nicht_gesendet',
        );
        return visit ? [{ assignmentId: assignment.id, visit }] : [];
      })
      .sort((left, right) =>
        `${left.visit.date} ${left.visit.time ?? ''}`.localeCompare(
          `${right.visit.date} ${right.visit.time ?? ''}`,
        ),
      );
  });
}

/** The scheduled visits of one person that overlap the Berlin dates, in the calendar's order. */
export async function loadAbsenceAffectedVisits(input: {
  admin: AdminClient;
  orgId: string;
  employeeRecordId: string;
  from: string;
  to: string;
}): Promise<AbsenceAffectedVisit[] | null> {
  const { admin, orgId, ...absence } = input;
  const affected = await loadAbsencesAffectedVisits({ admin, orgId, absences: [absence] });
  return affected?.[0]?.map((entry) => entry.visit) ?? null;
}

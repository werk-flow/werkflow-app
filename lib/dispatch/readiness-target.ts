import type { ActionResult } from '@/lib/action-result';
import 'server-only';

// Readiness composition for one dispatch target. This is an internal server
// helper, not a Server Action: it takes the admin client from its authorized
// caller and must never be exported from a 'use server' module (SI-024).

import { getJobMaterialLines } from '@/lib/inventory/actions';
import { fingerprintSnapshot } from '@/lib/planning/capacity';
import { addLocalDays, formatBerlinLocalDateTime, resolveBerlinWallTime } from '@/lib/date-time/berlin';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { deriveTravelNotes, type TravelVisitFact } from './derivation';
import {
  composeReadiness,
  type MaterialReadinessFacts,
  type PlanningReadinessFacts,
  type SiteReadinessFacts,
} from './readiness';
import {
  assessVisitReadiness,
  loadNextJobVisit,
  loadReadinessVisit,
  visitAssignments,
  type ReadinessVisit,
} from './readiness-visit';
import { dispatchReadFailed, loadEmployeeNameFacts, type EmployeeNameFacts } from './server';
import type { ReadinessResult, TravelNote } from './types';

async function loadSiteFacts(
  admin: AdminClient,
  orgId: string,
  siteId: string | null,
): Promise<SiteReadinessFacts> {
  if (!siteId) return { known: false, reason: 'missing' };
  const { data: site, error } = await admin
    .from('client_sites')
    .select('name, access_notes')
    .eq('organization_id', orgId)
    .eq('id', siteId)
    .maybeSingle();
  if (error) {
    logReadFailure('loadSiteFacts: site failed', { code: error.code });
    return { known: false, reason: 'load_failed' };
  }
  if (!site) return { known: false, reason: 'missing' };
  return { known: true, name: site.name, accessNotes: site.access_notes };
}

async function loadMaterialFacts(jobId: string): Promise<MaterialReadinessFacts> {
  const result = await getJobMaterialLines(jobId);
  if (!result.success) return { state: 'unknown' };
  if (result.lines.length === 0) return { state: 'no_demand' };
  return {
    state: 'demand',
    lines: result.lines.map((line) => ({
      itemName: line.itemName,
      plannedQuantity: line.plannedQuantity,
      takenQuantity: line.takenQuantity,
      availableQuantity: line.availableQuantity,
    })),
  };
}

type DayVisitRow = Pick<
  Database['public']['Tables']['planning_occurrences']['Row'],
  'id' | 'job_id' | 'start_at' | 'end_at'
>;

type DayVisitAssignmentRow = Pick<
  Database['public']['Tables']['planning_occurrence_assignments']['Row'],
  'occurrence_id' | 'employee_record_id'
>;

type DayVisitJobRow = Pick<
  Database['public']['Tables']['jobs']['Row'],
  'id' | 'title' | 'description' | 'site_id'
>;

function toTravelVisitFacts(input: {
  assignments: DayVisitAssignmentRow[];
  sameDayRows: DayVisitRow[];
  jobs: Map<string, DayVisitJobRow>;
  nameFacts: Map<string, EmployeeNameFacts>;
  localDate: string;
}): TravelVisitFact[] {
  const { jobs, nameFacts, localDate } = input;
  const sameDayRowById = new Map(input.sameDayRows.map((row) => [row.id, row]));
  return input.assignments.flatMap((assignment) => {
    const row = sameDayRowById.get(assignment.occurrence_id);
    if (!row?.start_at || !row.end_at) return [];
    const job = row.job_id ? jobs.get(row.job_id) : null;
    const startLocal = formatBerlinLocalDateTime(row.start_at);
    const endLocal = formatBerlinLocalDateTime(row.end_at);
    const sameDay = endLocal.slice(0, 10) === startLocal.slice(0, 10);
    return [
      {
        occurrenceId: row.id,
        title: job?.title.trim() || job?.description?.trim() || 'Auftragsbesuch',
        employeeRecordId: assignment.employee_record_id,
        employeeName: nameFacts.get(assignment.employee_record_id)?.displayName ?? 'Unbenannt',
        localDate,
        startMinutes: Number(startLocal.slice(11, 13)) * 60 + Number(startLocal.slice(14, 16)),
        endMinutes: sameDay ? Number(endLocal.slice(11, 13)) * 60 + Number(endLocal.slice(14, 16)) : 24 * 60,
        siteId: job?.site_id ?? null,
      },
    ];
  });
}

// The assignments and jobs of the day's visits. The day's visits are
// organization-sized, so they go in id batches; the target's own assignees are
// filtered in memory to keep one list per query.
async function loadDayVisitAssignmentsAndJobs(
  admin: AdminClient,
  orgId: string,
  sameDayRows: DayVisitRow[],
): Promise<{ assignments: DayVisitAssignmentRow[]; jobs: DayVisitJobRow[] } | null> {
  const rowIds = sameDayRows.map((row) => row.id);
  const [assignmentsResult, jobsResult] = await Promise.all([
    readInBatches(rowIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('planning_occurrence_assignments')
            .select('occurrence_id, employee_record_id')
            .eq('organization_id', orgId)
            .in('occurrence_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(
      sameDayRows.flatMap((row) => (row.job_id ? [row.job_id] : [])),
      (batch) =>
        admin
          .from('jobs')
          .select('id, title, description, site_id')
          .eq('organization_id', orgId)
          .in('id', [...batch]),
    ),
  ]);
  const visitError = assignmentsResult.error ?? jobsResult.error;
  if (visitError)
    return dispatchReadFailed('loadTravelNotesForOccurrence', 'assignments or jobs', visitError);
  return { assignments: assignmentsResult.data, jobs: jobsResult.data };
}

// Travel facts for the target occurrence's assignees on its Berlin day. Null
// means a read failed or overflowed: the caller must not report "no travel
// conflicts" for a day it could not read completely.
async function loadTravelNotesForOccurrence(
  admin: AdminClient,
  orgId: string,
  occurrence: {
    id: string;
    start_at: string | null;
    end_at: string | null;
  },
  employeeRecordIds: string[],
): Promise<TravelNote[] | null> {
  if (!occurrence.start_at || !occurrence.end_at || !employeeRecordIds.length) {
    return [];
  }
  const localDate = formatBerlinLocalDateTime(occurrence.start_at).slice(0, 10);
  const dayStart = resolveBerlinWallTime(`${localDate}T00:00`);
  const dayEnd = resolveBerlinWallTime(`${addLocalDays(localDate, 1)}T00:00`);
  if (!dayStart || !dayEnd) return [];
  const { data: dayRows, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('planning_occurrences')
        .select('id, job_id, start_at, end_at')
        .eq('organization_id', orgId)
        .eq('status', 'scheduled')
        .eq('entry_kind', 'job_visit')
        .gte('start_at', dayStart.instant.toISOString())
        .lt('start_at', dayEnd.instant.toISOString())
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) return dispatchReadFailed('loadTravelNotesForOccurrence', 'day occurrences', error);
  const sameDayRows = dayRows.filter(
    (row) => row.start_at && formatBerlinLocalDateTime(row.start_at).slice(0, 10) === localDate,
  );
  if (!sameDayRows.length) return [];
  const visitFacts = await loadDayVisitAssignmentsAndJobs(admin, orgId, sameDayRows);
  if (!visitFacts) return null;
  const targetRecordIds = new Set(employeeRecordIds);
  const assignments = visitFacts.assignments.filter((assignment) =>
    targetRecordIds.has(assignment.employee_record_id),
  );
  const nameFacts = await loadEmployeeNameFacts(
    admin,
    orgId,
    assignments.map((assignment) => assignment.employee_record_id),
  );
  if (!nameFacts) return null;
  return deriveTravelNotes(
    toTravelVisitFacts({
      assignments,
      sameDayRows,
      jobs: new Map(visitFacts.jobs.map((job) => [job.id, job])),
      nameFacts,
      localDate,
    }),
  );
}

/**
 * The visit readiness looks at: the dispatched visit, or for a job the next
 * scheduled visit that has not ended. Undefined when the job has none.
 */
async function loadTargetVisit(input: {
  admin: AdminClient;
  orgId: string;
  occurrenceId: string | null;
  jobId: string | null;
  assessPeople: boolean;
}): Promise<ActionResult<{ visit: ReadinessVisit | undefined; jobId: string }>> {
  if (input.occurrenceId) {
    const visit = await loadReadinessVisit(input.admin, input.orgId, input.occurrenceId);
    if (visit === null) return { success: false, error: 'load_failed' };
    if (!visit?.job_id) return { success: false, error: 'dispatch_occurrence_not_found' };
    return { success: true, visit, jobId: visit.job_id };
  }
  if (!input.jobId) return { success: false, error: 'invalid_input' };
  // A field worker's readiness assesses no people, so it needs no visit.
  if (!input.assessPeople) return { success: true, visit: undefined, jobId: input.jobId };
  const visit = await loadNextJobVisit(input.admin, input.orgId, input.jobId);
  if (visit === null) return { success: false, error: 'load_failed' };
  return { success: true, visit, jobId: input.jobId };
}

/** The planning facts and travel gaps of the target's visit; null after a failed read. */
async function loadVisitFacts(input: {
  admin: AdminClient;
  orgId: string;
  jobId: string;
  visit: ReadinessVisit | undefined;
  withTravel: boolean;
  assessPeople: boolean;
}): Promise<{ planning: PlanningReadinessFacts; travelNotes: TravelNote[] } | null> {
  const { visit } = input;
  const [planning, travelNotes] = await Promise.all([
    input.assessPeople
      ? assessVisitReadiness(input.orgId, input.jobId, visit)
      : Promise.resolve<PlanningReadinessFacts>({ state: 'office_only' }),
    // Travel gaps are read for a dispatched visit only; a job's own readiness
    // leaves them „nicht bewertet“.
    input.withTravel && visit
      ? loadTravelNotesForOccurrence(
          input.admin,
          input.orgId,
          visit,
          visitAssignments(visit).map((assignment) => assignment.employeeRecordId),
        )
      : Promise.resolve([]),
  ]);
  return planning && travelNotes ? { planning, travelNotes } : null;
}

/** The job's site and planned material; null when the job is not found. */
async function loadJobFacts(
  admin: AdminClient,
  orgId: string,
  jobId: string,
): Promise<{ site: SiteReadinessFacts; material: MaterialReadinessFacts } | null> {
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('id, site_id')
    .eq('organization_id', orgId)
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) logReadFailure('composeReadinessForTarget: job failed', { code: jobError.code });
  if (jobError || !job) return null;
  const [site, material] = await Promise.all([
    loadSiteFacts(admin, orgId, job.site_id),
    loadMaterialFacts(jobId),
  ]);
  return { site, material };
}

export async function composeReadinessForTarget(input: {
  admin: AdminClient;
  orgId: string;
  occurrenceId: string | null;
  jobId: string | null;
  /**
   * False for a field worker: the visit's people, their absences and exits
   * are office facts, so capacity and qualifications stay unassessed.
   */
  assessPeople: boolean;
}): Promise<ActionResult<{ readiness: ReadinessResult; fingerprint: string }>> {
  const target = await loadTargetVisit(input);
  if (!target.success) return target;
  const [visitFacts, jobFacts] = await Promise.all([
    loadVisitFacts({
      admin: input.admin,
      orgId: input.orgId,
      jobId: target.jobId,
      visit: target.visit,
      withTravel: input.occurrenceId !== null,
      assessPeople: input.assessPeople,
    }),
    loadJobFacts(input.admin, input.orgId, target.jobId),
  ]);
  if (!jobFacts) return { success: false, error: 'dispatch_job_not_found' };
  if (!visitFacts) return { success: false, error: 'load_failed' };
  const readiness = composeReadiness({ ...visitFacts, ...jobFacts });
  const fingerprint = await fingerprintSnapshot(readiness.snapshot);
  return { success: true, readiness, fingerprint };
}

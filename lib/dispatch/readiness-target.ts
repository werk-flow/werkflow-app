import type { ActionResult } from '@/lib/action-result';
import 'server-only';

// Readiness composition for one dispatch target. This is an internal server
// helper, not a Server Action: it takes the admin client from its authorized
// caller and must never be exported from a 'use server' module (SI-024).

import { getJobMaterialLines } from '@/lib/inventory/actions';
import { fingerprintSnapshot } from '@/lib/planning/capacity';
import { addLocalDays, formatBerlinLocalDateTime, resolveBerlinWallTime } from '@/lib/planning/date-time';
import { assessPlanningOccurrences } from '@/lib/planning/server';
import type { MaterializedOccurrence, PlanningAssignmentDraft, PlanningConflict } from '@/lib/planning/types';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { deriveTravelNotes, type TravelVisitFact } from './derivation';
import {
  composeReadiness,
  type MaterialReadinessFacts,
  type ReadinessFacts,
  type SiteReadinessFacts,
} from './readiness';
import { loadEmployeeNameFacts } from './server';
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
  const travelReadFailed = (read: string, error: { message: string; code?: string }): null => {
    logReadFailure(`loadTravelNotesForOccurrence: ${read} failed`, {
      code: error.code ?? 'unknown',
      message: error.message,
    });
    return null;
  };
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
  if (error) return travelReadFailed('day occurrences', error);
  const sameDayRows = dayRows.filter(
    (row) => row.start_at && formatBerlinLocalDateTime(row.start_at).slice(0, 10) === localDate,
  );
  const rowIds = sameDayRows.map((row) => row.id);
  if (!rowIds.length) return [];
  // The day's visits are organization-sized, so they go in id batches; the
  // target's own assignees are filtered in memory to keep one list per query.
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
  if (visitError) return travelReadFailed('assignments or jobs', visitError);
  const targetRecordIds = new Set(employeeRecordIds);
  const assignments = assignmentsResult.data.filter((assignment) =>
    targetRecordIds.has(assignment.employee_record_id),
  );
  const nameFacts = await loadEmployeeNameFacts(
    admin,
    orgId,
    assignments.map((assignment) => assignment.employee_record_id),
  );
  if (!nameFacts) return null;
  const jobs = new Map(jobsResult.data.map((job) => [job.id, job]));
  const sameDayRowById = new Map(sameDayRows.map((row) => [row.id, row]));
  const facts: TravelVisitFact[] = assignments.flatMap((assignment) => {
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
  return deriveTravelNotes(facts);
}

function toMaterializedOccurrence(occurrence: {
  id: string;
  time_kind: 'timed' | 'all_day';
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date_exclusive: string | null;
  original_start_local: string | null;
}): MaterializedOccurrence {
  return {
    // Used only as an in-memory assignment key during assessment.
    originalStartLocal: occurrence.original_start_local ?? occurrence.id,
    timeKind: occurrence.time_kind,
    startAt: occurrence.start_at,
    endAt: occurrence.end_at,
    startDate: occurrence.start_date,
    endDateExclusive: occurrence.end_date_exclusive,
    dstResolution: 'exact',
  };
}

export async function composeReadinessForTarget(input: {
  admin: AdminClient;
  orgId: string;
  occurrenceId: string | null;
  jobId: string | null;
}): Promise<ActionResult<{ readiness: ReadinessResult; fingerprint: string }>> {
  let planningConflicts: PlanningConflict[] = [];
  let site: SiteReadinessFacts = { known: false, reason: 'missing' };
  let travelNotes: TravelNote[] = [];
  let jobId = input.jobId;

  if (input.occurrenceId) {
    const { data: occurrence, error } = await input.admin
      .from('planning_occurrences')
      .select(
        'id, job_id, time_kind, status, start_at, end_at, start_date, end_date_exclusive, original_start_local',
      )
      .eq('organization_id', input.orgId)
      .eq('id', input.occurrenceId)
      .maybeSingle();
    if (error) logReadFailure('composeReadinessForTarget: occurrence failed', { code: error.code });
    if (error || !occurrence || !occurrence.job_id) {
      return { success: false, error: 'dispatch_occurrence_not_found' };
    }
    jobId = occurrence.job_id;
    const { data: assignments, error: assignmentError } = await input.admin
      .from('planning_occurrence_assignments')
      .select('employee_record_id, team_source_id')
      .eq('organization_id', input.orgId)
      .eq('occurrence_id', occurrence.id);
    if (assignmentError) {
      logReadFailure('composeReadinessForTarget: assignments failed', { code: assignmentError.code });
      return { success: false, error: 'load_failed' };
    }
    const drafts: PlanningAssignmentDraft[] = (assignments ?? []).map((assignment) => ({
      employeeRecordId: assignment.employee_record_id,
      teamSourceId: assignment.team_source_id,
    }));
    const assessment = await assessPlanningOccurrences({
      orgId: input.orgId,
      jobId: occurrence.job_id,
      occurrences: [toMaterializedOccurrence(occurrence)],
      assignments: drafts,
      excludeOccurrenceId: occurrence.id,
    });
    if (!assessment) return { success: false, error: 'load_failed' };
    planningConflicts = assessment.conflicts;
    const loadedTravelNotes = await loadTravelNotesForOccurrence(
      input.admin,
      input.orgId,
      occurrence,
      drafts.map((draft) => draft.employeeRecordId),
    );
    if (!loadedTravelNotes) return { success: false, error: 'load_failed' };
    travelNotes = loadedTravelNotes;
  }

  if (!jobId) return { success: false, error: 'invalid_input' };
  const { data: job, error: jobError } = await input.admin
    .from('jobs')
    .select('id, site_id')
    .eq('organization_id', input.orgId)
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) logReadFailure('composeReadinessForTarget: job failed', { code: jobError.code });
  if (jobError || !job) return { success: false, error: 'dispatch_job_not_found' };
  const [siteFacts, material] = await Promise.all([
    loadSiteFacts(input.admin, input.orgId, job.site_id),
    loadMaterialFacts(jobId),
  ]);
  site = siteFacts;

  const facts: ReadinessFacts = {
    planningConflicts,
    site,
    travelNotes,
    material,
  };
  const readiness = composeReadiness(facts);
  const fingerprint = await fingerprintSnapshot(readiness.snapshot);
  return { success: true, readiness, fingerprint };
}

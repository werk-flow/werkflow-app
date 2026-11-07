import 'server-only';

// The visit readiness assesses and its planning facts. An internal server
// helper beside readiness-target.ts: it takes the admin client from its
// authorized caller and is never exported from a 'use server' module.

import { logReadFailure } from '@/lib/data/read-request-cache';
import { addLocalDays, formatBerlinLocalDate, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { assessPlanningOccurrences } from '@/lib/planning/server';
import type { MaterializedOccurrence, PlanningAssignmentDraft } from '@/lib/planning/types';
import type { AdminClient } from '@/lib/supabase/admin';
import type { PlanningReadinessFacts } from './readiness';

const VISIT_SELECT =
  'id, job_id, time_kind, start_at, end_at, start_date, end_date_exclusive, original_start_local, assignments:planning_occurrence_assignments!planning_occurrence_assignments_occurrence_id_fkey(employee_record_id, team_source_id)';

/** One visit with the people on it, as readiness assesses it. */
export type ReadinessVisit = {
  id: string;
  job_id: string | null;
  time_kind: 'timed' | 'all_day';
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date_exclusive: string | null;
  original_start_local: string | null;
  assignments: Array<{ employee_record_id: string; team_source_id: string | null }>;
};

function toMaterializedOccurrence(visit: ReadinessVisit): MaterializedOccurrence {
  return {
    // Used only as an in-memory assignment key during assessment.
    originalStartLocal: visit.original_start_local ?? visit.id,
    timeKind: visit.time_kind,
    startAt: visit.start_at,
    endAt: visit.end_at,
    startDate: visit.start_date,
    endDateExclusive: visit.end_date_exclusive,
    dstResolution: 'exact',
  };
}

/** The Berlin date a visit starts on. */
function visitLocalDate(visit: ReadinessVisit): string | null {
  return visit.start_at ? formatBerlinLocalDate(visit.start_at) : visit.start_date;
}

/** The people on a visit as planning assignment drafts. */
export function visitAssignments(visit: ReadinessVisit): PlanningAssignmentDraft[] {
  return visit.assignments.map((assignment) => ({
    employeeRecordId: assignment.employee_record_id,
    teamSourceId: assignment.team_source_id,
  }));
}

/** One scheduled visit of the organization by id; null after a logged failure, undefined when absent. */
export async function loadReadinessVisit(
  admin: AdminClient,
  orgId: string,
  occurrenceId: string,
): Promise<ReadinessVisit | null | undefined> {
  const { data, error } = await admin
    .from('planning_occurrences')
    .select(VISIT_SELECT)
    .eq('organization_id', orgId)
    .eq('id', occurrenceId)
    .maybeSingle();
  if (error) {
    logReadFailure('loadReadinessVisit: occurrence failed', { code: error.code });
    return null;
  }
  return data ?? undefined;
}

/**
 * The job's next scheduled visit that has not ended: the earlier of its next
 * timed and its next all-day visit. Undefined when it has none; null after a
 * logged failure.
 */
export async function loadNextJobVisit(
  admin: AdminClient,
  orgId: string,
  jobId: string,
): Promise<ReadinessVisit | null | undefined> {
  const scheduledVisits = () =>
    admin
      .from('planning_occurrences')
      .select(VISIT_SELECT)
      .eq('organization_id', orgId)
      .eq('job_id', jobId)
      .eq('entry_kind', 'job_visit')
      .eq('status', 'scheduled');
  const [timed, allDay] = await Promise.all([
    scheduledVisits()
      .gte('end_at', new Date().toISOString())
      .order('start_at')
      .order('id')
      .limit(1)
      .maybeSingle(),
    scheduledVisits()
      .gte('end_date_exclusive', addLocalDays(getBusinessTodayIso(), 1))
      .order('start_date')
      .order('id')
      .limit(1)
      .maybeSingle(),
  ]);
  const error = timed.error ?? allDay.error;
  if (error) {
    logReadFailure('loadNextJobVisit: visits failed', { code: error.code });
    return null;
  }
  const candidates = [timed.data, allDay.data].flatMap((visit) => {
    const localDate = visit ? visitLocalDate(visit) : null;
    return visit && localDate ? [{ visit, localDate }] : [];
  });
  candidates.sort((left, right) => left.localDate.localeCompare(right.localDate));
  return candidates[0]?.visit;
}

/**
 * Capacity and qualifications of the visit's people, or why they cannot be
 * assessed. Null when the assessment could not read its facts.
 */
export async function assessVisitReadiness(
  orgId: string,
  jobId: string,
  visit: ReadinessVisit | undefined,
): Promise<PlanningReadinessFacts | null> {
  const localDate = visit ? visitLocalDate(visit) : null;
  if (!visit || !localDate) return { state: 'no_visit' };
  const assignments = visitAssignments(visit);
  if (assignments.length === 0) return { state: 'no_assignees' };
  const assessment = await assessPlanningOccurrences({
    orgId,
    jobId,
    occurrences: [toMaterializedOccurrence(visit)],
    assignments,
    excludeOccurrenceId: visit.id,
  });
  if (!assessment) return null;
  return { state: 'assessed', localDate, conflicts: assessment.conflicts };
}

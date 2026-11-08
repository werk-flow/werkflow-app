import 'server-only';

// The capacity check of a job team change. A person added to the job team
// reaches the job's legacy visit while it has not started (data-model.md,
// "Job team and visit plan"), so the job page assesses that visit as every
// planning write does. An internal server helper: it takes the admin client
// from its authorized caller and is never exported from a 'use server' module.

import type { ActionFailure } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import {
  rejectUnacknowledgedConflicts,
  type ConflictAcknowledgement,
  type PlanningWarningFailure,
} from './conflict-acknowledgement';
import { assessPlanningOccurrences } from './server';
import type { PlanningAssignmentDraft } from './types';

/** What the team write records for the visit it changes, with the reason a conflict needed. */
export type JobVisitAssessment = {
  visitId: string;
  visitVersion: number;
  capacitySnapshot: Json;
  capacityFingerprint: string;
  qualificationSnapshot: Json;
  qualificationFingerprint: string;
  overrideReason: string | null;
};

export type JobTeamAssessmentResult =
  | {
      success: true;
      /** The team the assessment read; the write refuses a team that changed since. */
      currentUserIds: string[];
      visitAssessment: JobVisitAssessment | null;
    }
  | PlanningWarningFailure
  | ActionFailure<'load_failed'>;

/** The job's legacy visit while it is scheduled and has not started; undefined when there is none. */
async function loadUnstartedLegacyVisit(admin: AdminClient, orgId: string, jobId: string) {
  const { data: visit, error } = await admin
    .from('planning_occurrences')
    .select(
      'id, version, time_kind, start_at, end_at, start_date, end_date_exclusive, original_start_local, assignments:planning_occurrence_assignments!planning_occurrence_assignments_occurrence_id_fkey(employee_record_id, team_source_id)',
    )
    .eq('organization_id', orgId)
    .eq('legacy_source_job_id', jobId)
    .eq('status', 'scheduled')
    .maybeSingle();
  if (error) {
    logReadFailure('loadUnstartedLegacyVisit: visit failed', { code: error.code });
    return null;
  }
  if (!visit) return undefined;
  // The rule of app_private.sync_legacy_job_assignment: a visit that started is history.
  const started = visit.start_at
    ? new Date(visit.start_at).getTime() <= Date.now()
    : !visit.start_date || visit.start_date <= getBusinessTodayIso();
  return started ? undefined : visit;
}

/** The current team and the personnel records of the people a change adds or removes. */
async function loadTeamChange(input: {
  admin: AdminClient;
  orgId: string;
  jobId: string;
  nextUserIds: string[];
}) {
  const { data: currentRows, error } = await readCompleteRows(
    (from, to) =>
      input.admin
        .from('job_assignments')
        .select('user_id')
        .eq('organization_id', input.orgId)
        .eq('job_id', input.jobId)
        .order('user_id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logReadFailure('loadTeamChange: job assignments failed', { code: error.code });
    return null;
  }
  const currentUserIds = new Set(currentRows.map((row) => row.user_id));
  const nextUserIds = new Set(input.nextUserIds);
  const addedUserIds = [...nextUserIds].filter((userId) => !currentUserIds.has(userId));
  const removedUserIds = [...currentUserIds].filter((userId) => !nextUserIds.has(userId));
  const records = await readInBatches([...addedUserIds, ...removedUserIds], (batch) =>
    input.admin
      .from('employee_records')
      .select('id, user_id')
      .eq('organization_id', input.orgId)
      .in('user_id', [...batch]),
  );
  if (records.error) {
    logReadFailure('loadTeamChange: employee records failed', { code: records.error.code });
    return null;
  }
  const recordIdsOf = (userIds: string[]) =>
    records.data.flatMap((record) => (record.user_id && userIds.includes(record.user_id) ? [record.id] : []));
  return {
    currentUserIds: [...currentUserIds],
    addedRecordIds: recordIdsOf(addedUserIds),
    removedRecordIds: recordIdsOf(removedUserIds),
  };
}

/**
 * The capacity assessment of the job's unstarted legacy visit with the people
 * the new team leaves on it. Null visit assessment when the change adds nobody
 * to a visit. A capacity conflict needs a reason confirmed for this exact
 * assessment; a qualification gap keeps its own override on the job.
 */
export async function assessJobTeamChange(input: {
  admin: AdminClient;
  orgId: string;
  jobId: string;
  nextUserIds: string[];
  acknowledgement: ConflictAcknowledgement;
}): Promise<JobTeamAssessmentResult> {
  const [visit, change] = await Promise.all([
    loadUnstartedLegacyVisit(input.admin, input.orgId, input.jobId),
    loadTeamChange(input),
  ]);
  if (visit === null || change === null) return { success: false, error: 'load_failed' };
  const { currentUserIds } = change;
  if (!visit || change.addedRecordIds.length === 0) {
    return { success: true, currentUserIds, visitAssessment: null };
  }

  const removed = new Set(change.removedRecordIds);
  const crew: PlanningAssignmentDraft[] = [
    ...new Map(
      [
        ...visit.assignments
          .filter((assignment) => !removed.has(assignment.employee_record_id))
          .map((assignment) => ({
            employeeRecordId: assignment.employee_record_id,
            teamSourceId: assignment.team_source_id,
          })),
        ...change.addedRecordIds.map((employeeRecordId) => ({ employeeRecordId, teamSourceId: null })),
      ].map((assignment) => [assignment.employeeRecordId, assignment]),
    ).values(),
  ];
  const assessment = await assessPlanningOccurrences({
    orgId: input.orgId,
    jobId: input.jobId,
    occurrences: [
      {
        originalStartLocal: visit.original_start_local ?? visit.id,
        timeKind: visit.time_kind,
        startAt: visit.start_at,
        endAt: visit.end_at,
        startDate: visit.start_date,
        endDateExclusive: visit.end_date_exclusive,
        dstResolution: 'exact',
      },
    ],
    assignments: crew,
    excludeOccurrenceId: visit.id,
  });
  if (!assessment) return { success: false, error: 'load_failed' };
  const capacityConflicts = assessment.conflicts.filter((conflict) => conflict.kind !== 'qualification');
  const refusal = rejectUnacknowledgedConflicts(
    { conflicts: capacityConflicts, assessmentFingerprint: assessment.capacityFingerprint },
    input.acknowledgement,
  );
  if (refusal) return refusal;
  return {
    success: true,
    currentUserIds,
    visitAssessment: {
      visitId: visit.id,
      visitVersion: visit.version,
      capacitySnapshot: assessment.capacitySnapshot,
      capacityFingerprint: assessment.capacityFingerprint,
      qualificationSnapshot: assessment.qualificationSnapshot,
      qualificationFingerprint: assessment.qualificationFingerprint,
      overrideReason: capacityConflicts.length > 0 ? input.acknowledgement.overrideReason : null,
    },
  };
}

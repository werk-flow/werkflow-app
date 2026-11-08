import 'server-only';

// The capacity check of the job's legacy visit. A person added to the job
// team reaches that visit while it has not started, and the job's schedule
// columns move it (data-model.md, "Job team and visit plan"), so a team change
// on the job page and a job saved with a date and people assess that visit as
// every planning write does. An internal server helper: it takes the admin
// client from its authorized caller and is never exported from a 'use server'
// module.

import type { ActionFailure } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { normalizeJobPlannedTime } from '@/lib/jobs/types';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import {
  rejectUnacknowledgedConflicts,
  type ConflictAcknowledgement,
  type PlanningWarningFailure,
} from './conflict-acknowledgement';
import { assessPlanningOccurrences } from './server';
import {
  legacyVisitWindow,
  sameLegacyVisitSchedule,
  type JobSchedule,
  type VisitWindow,
} from './legacy-visit-window';
import type { MaterializedOccurrence, PlanningAssignmentDraft } from './types';

/** The assessment of one visit with its people, and the reason a capacity conflict needed. */
type VisitAssessmentRecord = {
  capacitySnapshot: Json;
  capacityFingerprint: string;
  qualificationSnapshot: Json;
  qualificationFingerprint: string;
  overrideReason: string | null;
};

/** What the team write records for the visit it changes, with the reason a conflict needed. */
export type JobVisitAssessment = VisitAssessmentRecord & {
  visitId: string;
  visitVersion: number;
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

/** The rule of app_private.sync_legacy_job_assignment: a visit that started is history. */
function hasWindowStarted(window: VisitWindow): boolean {
  return window.startAt
    ? new Date(window.startAt).getTime() <= Date.now()
    : !window.startDate || window.startDate <= getBusinessTodayIso();
}

/** The job's legacy visit in any status, with its people; undefined when there is none. */
async function loadLegacyVisit(admin: AdminClient, orgId: string, jobId: string) {
  const { data: visit, error } = await admin
    .from('planning_occurrences')
    .select(
      'id, version, status, time_kind, start_at, end_at, start_date, end_date_exclusive, original_start_local, assignments:planning_occurrence_assignments!planning_occurrence_assignments_occurrence_id_fkey(employee_record_id, team_source_id)',
    )
    .eq('organization_id', orgId)
    .eq('legacy_source_job_id', jobId)
    .maybeSingle();
  if (error) {
    logReadFailure('loadLegacyVisit: visit failed', { code: error.code });
    return null;
  }
  return visit ?? undefined;
}

type LegacyVisit = NonNullable<Awaited<ReturnType<typeof loadLegacyVisit>>>;

function windowOf(visit: LegacyVisit): VisitWindow {
  return {
    timeKind: visit.time_kind,
    startAt: visit.start_at,
    endAt: visit.end_at,
    startDate: visit.start_date,
    endDateExclusive: visit.end_date_exclusive,
  };
}

/** The current team and the personnel records of the people a change adds or removes; a new job has no team. */
async function loadTeamChange(input: {
  admin: AdminClient;
  orgId: string;
  jobId: string | null;
  nextUserIds: string[];
}) {
  const { jobId } = input;
  const { data: currentRows, error } = jobId
    ? await readCompleteRows(
        (from, to) =>
          input.admin
            .from('job_assignments')
            .select('user_id')
            .eq('organization_id', input.orgId)
            .eq('job_id', jobId)
            .order('user_id')
            .range(from, to),
        LIST_ROW_CAP,
      )
    : { data: [], error: null };
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

type TeamChange = NonNullable<Awaited<ReturnType<typeof loadTeamChange>>>;

/** The people a visit keeps after the team change, and the people it gains. */
function crewAfterChange(
  assignments: LegacyVisit['assignments'],
  change: Pick<TeamChange, 'addedRecordIds' | 'removedRecordIds'>,
): PlanningAssignmentDraft[] {
  const removed = new Set(change.removedRecordIds);
  return [
    ...new Map(
      [
        ...assignments
          .filter((assignment) => !removed.has(assignment.employee_record_id))
          .map((assignment) => ({
            employeeRecordId: assignment.employee_record_id,
            teamSourceId: assignment.team_source_id,
          })),
        ...change.addedRecordIds.map((employeeRecordId) => ({ employeeRecordId, teamSourceId: null })),
      ].map((assignment) => [assignment.employeeRecordId, assignment]),
    ).values(),
  ];
}

/**
 * The calendar's capacity check of one visit with its people. A capacity
 * conflict needs a reason confirmed for this exact assessment; a
 * qualification gap keeps its own override on the job.
 */
async function assessVisit(input: {
  orgId: string;
  jobId: string | null;
  occurrence: MaterializedOccurrence;
  crew: PlanningAssignmentDraft[];
  excludeOccurrenceId: string | undefined;
  acknowledgement: ConflictAcknowledgement;
}): Promise<
  { success: true; assessment: VisitAssessmentRecord } | PlanningWarningFailure | ActionFailure<'load_failed'>
> {
  const assessment = await assessPlanningOccurrences({
    orgId: input.orgId,
    jobId: input.jobId,
    occurrences: [input.occurrence],
    assignments: input.crew,
    ...(input.excludeOccurrenceId ? { excludeOccurrenceId: input.excludeOccurrenceId } : {}),
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
    assessment: {
      capacitySnapshot: assessment.capacitySnapshot,
      capacityFingerprint: assessment.capacityFingerprint,
      qualificationSnapshot: assessment.qualificationSnapshot,
      qualificationFingerprint: assessment.qualificationFingerprint,
      overrideReason: capacityConflicts.length > 0 ? input.acknowledgement.overrideReason : null,
    },
  };
}

/**
 * The capacity assessment of the job's unstarted legacy visit with the people
 * the new team leaves on it. Null visit assessment when the change adds nobody
 * to a visit.
 */
export async function assessJobTeamChange(input: {
  admin: AdminClient;
  orgId: string;
  jobId: string;
  nextUserIds: string[];
  acknowledgement: ConflictAcknowledgement;
}): Promise<JobTeamAssessmentResult> {
  const [legacyVisit, change] = await Promise.all([
    loadLegacyVisit(input.admin, input.orgId, input.jobId),
    loadTeamChange(input),
  ]);
  if (legacyVisit === null || change === null) return { success: false, error: 'load_failed' };
  const { currentUserIds } = change;
  const visit =
    legacyVisit && legacyVisit.status === 'scheduled' && !hasWindowStarted(windowOf(legacyVisit))
      ? legacyVisit
      : undefined;
  if (!visit || change.addedRecordIds.length === 0) {
    return { success: true, currentUserIds, visitAssessment: null };
  }

  const assessed = await assessVisit({
    orgId: input.orgId,
    jobId: input.jobId,
    occurrence: {
      ...windowOf(visit),
      originalStartLocal: visit.original_start_local ?? visit.id,
      dstResolution: 'exact',
    },
    crew: crewAfterChange(visit.assignments, change),
    excludeOccurrenceId: visit.id,
    acknowledgement: input.acknowledgement,
  });
  if (!assessed.success) return assessed;
  return {
    success: true,
    currentUserIds,
    visitAssessment: { ...assessed.assessment, visitId: visit.id, visitVersion: visit.version },
  };
}

/**
 * What a job save records for the legacy visit it plans, as
 * app_private.record_job_visit_assessment compares and stores it: the visit's
 * people and time as assessed, and the assessment with its reason.
 */
type JobPlanAssessment = {
  employee_record_ids: string[];
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date_exclusive: string | null;
  capacity_snapshot: Json;
  capacity_fingerprint: string;
  qualification_snapshot: Json;
  qualification_fingerprint: string;
  override_reason: string | null;
};

export type JobPlanAssessmentResult =
  | { success: true; planAssessment: JobPlanAssessment | null }
  | PlanningWarningFailure
  | ActionFailure<'load_failed'>;

/**
 * The capacity assessment of the legacy visit a job create or edit leaves.
 * The schedule trigger creates or moves that visit when the schedule changes,
 * and the team trigger puts each added person on it while it has not started.
 * Null plan assessment when the save leaves no such visit with people, or
 * neither moves it nor adds anyone to it.
 */
export async function assessJobPlan(input: {
  admin: AdminClient;
  orgId: string;
  /** Null for a job the save creates. */
  jobId: string | null;
  /** The stored schedule; null for a job the save creates. */
  storedSchedule: JobSchedule | null;
  schedule: JobSchedule;
  /** The team after the save; null when the save keeps it. */
  nextUserIds: string[] | null;
  acknowledgement: ConflictAcknowledgement;
}): Promise<JobPlanAssessmentResult> {
  const nothing = { success: true, planAssessment: null } as const;
  const window = legacyVisitWindow(input.schedule);
  if (!window) return nothing;
  const { jobId, nextUserIds } = input;
  const [legacyVisit, change] = await Promise.all([
    jobId ? loadLegacyVisit(input.admin, input.orgId, jobId) : undefined,
    nextUserIds
      ? loadTeamChange({ admin: input.admin, orgId: input.orgId, jobId, nextUserIds })
      : { currentUserIds: [], addedRecordIds: [], removedRecordIds: [] },
  ]);
  if (legacyVisit === null || change === null) return { success: false, error: 'load_failed' };

  const scheduleChanged =
    !input.storedSchedule || !sameLegacyVisitSchedule(input.storedSchedule, input.schedule);
  // An unchanged schedule leaves the visit where and as it is.
  if (!scheduleChanged && legacyVisit?.status !== 'scheduled') return nothing;
  const visitWindow = scheduleChanged || !legacyVisit ? window : windowOf(legacyVisit);
  if (hasWindowStarted(visitWindow)) return nothing;
  const crew = crewAfterChange(legacyVisit?.assignments ?? [], change);
  if (crew.length === 0 || (!scheduleChanged && change.addedRecordIds.length === 0)) return nothing;

  const assessed = await assessVisit({
    orgId: input.orgId,
    jobId,
    occurrence: {
      ...visitWindow,
      originalStartLocal:
        legacyVisit?.original_start_local ??
        legacyVisit?.id ??
        `${input.schedule.plannedDate}T${normalizeJobPlannedTime(input.schedule.plannedTime) ?? '00:00'}`,
      dstResolution: 'exact',
    },
    crew,
    excludeOccurrenceId: legacyVisit?.id,
    acknowledgement: input.acknowledgement,
  });
  if (!assessed.success) return assessed;
  return {
    success: true,
    planAssessment: {
      employee_record_ids: crew.map((assignment) => assignment.employeeRecordId),
      start_at: visitWindow.startAt,
      end_at: visitWindow.endAt,
      start_date: visitWindow.startDate,
      end_date_exclusive: visitWindow.endDateExclusive,
      capacity_snapshot: assessed.assessment.capacitySnapshot,
      capacity_fingerprint: assessed.assessment.capacityFingerprint,
      qualification_snapshot: assessed.assessment.qualificationSnapshot,
      qualification_fingerprint: assessed.assessment.qualificationFingerprint,
      override_reason: assessed.assessment.overrideReason,
    },
  };
}

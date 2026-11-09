import 'server-only';

// The capacity check of a handover: every visit the handover moves, with the
// people it will have, as every planning write checks a visit it gives a
// person (calendar-and-resource-planning.md, "Capacity"). Capacity is one
// assessment of the whole handover; each job's qualification snapshot reads
// its own requirements. A capacity conflict needs one reason for the whole
// handover, and so does a qualification gap, as on a calendar
// reassignment, confirmed for exactly these assessments. An internal server
// helper: its caller authorizes and passes the admin client.

import { createHash } from 'node:crypto';
import type { ActionFailure } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { formatBerlinLocalDateTime, getBusinessTodayIso } from '@/lib/date-time/berlin';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import {
  rejectUnacknowledgedConflicts,
  type ConflictAcknowledgement,
  type PlanningWarningFailure,
} from '@/lib/planning/conflict-acknowledgement';
import { assessPlanningOccurrences } from '@/lib/planning/server';
import type { MaterializedOccurrence, PlanningAssignmentDraft } from '@/lib/planning/types';
import { z } from '@/lib/zod';
import { OPEN_JOB_STATUSES } from './open-work';

const movedVisitSchema = z.object({
  id: z.string(),
  version: z.number(),
  job_id: z.string(),
  time_kind: z.enum(['timed', 'all_day']),
  start_at: z.string().nullable(),
  end_at: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date_exclusive: z.string().nullable(),
  crew: z.array(z.object({ employee_record_id: z.string(), team_source_id: z.string().nullable() })),
});
type MovedVisit = z.infer<typeof movedVisitSchema>;

/** What the handover function compares and stores for one job: its assessment and the visits it moves. */
type JobHandoverAssessment = {
  jobId: string;
  capacitySnapshot: Json;
  capacityFingerprint: string;
  qualificationSnapshot: Json;
  qualificationFingerprint: string;
  visits: Array<{ occurrenceId: string; version: number; employeeRecordIds: string[] }>;
};

export type HandoverAssessmentResult =
  | { success: true; assessments: JobHandoverAssessment[] }
  | PlanningWarningFailure
  | ActionFailure<'load_failed'>;

function berlinStartDate(visit: MovedVisit): string | null {
  return visit.start_at ? formatBerlinLocalDateTime(visit.start_at).slice(0, 10) : visit.start_date;
}

/**
 * The scheduled visits of the leaver on the handed-over jobs that have not
 * started and start on or after the handover date, with all their people.
 */
async function readMovedVisits(
  admin: AdminClient,
  organizationId: string,
  input: { employeeRecordId: string; handoverFrom: string; jobIds: string[] },
): Promise<MovedVisit[] | null> {
  const now = new Date().toISOString();
  const today = getBusinessTodayIso();
  const read = await readInBatches(input.jobIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('planning_occurrences')
          .select(
            'id, version, job_id, time_kind, start_at, end_at, start_date, end_date_exclusive, crew:planning_occurrence_assignments!planning_occurrence_assignments_occurrence_id_fkey(employee_record_id, team_source_id), mine:planning_occurrence_assignments!planning_occurrence_assignments_occurrence_id_fkey!inner(employee_record_id), job:jobs!planning_occurrences_job_id_fkey!inner(status)',
          )
          .eq('organization_id', organizationId)
          .eq('status', 'scheduled')
          .in('job_id', [...batch])
          .eq('mine.employee_record_id', input.employeeRecordId)
          .in('job.status', [...OPEN_JOB_STATUSES])
          .or(`start_at.gt.${now},start_date.gt.${today}`)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );
  if (read.error) {
    logReadFailure('readMovedVisits: visits failed', { code: read.error.code ?? 'unknown' });
    return null;
  }
  const parsed = z.array(movedVisitSchema).safeParse(read.data);
  if (!parsed.success) {
    logReadFailure('readMovedVisits: visits failed', { code: 'unexpected_shape' });
    return null;
  }
  return parsed.data.filter((visit) => {
    const date = berlinStartDate(visit);
    return date !== null && date >= input.handoverFrom;
  });
}

/** The visit's people after the handover: without the leaver, with the target. */
function crewAfterHandover(visit: MovedVisit, leaverId: string, targetId: string): PlanningAssignmentDraft[] {
  return [
    ...new Map(
      [
        ...visit.crew
          .filter((member) => member.employee_record_id !== leaverId)
          .map((member) => ({
            employeeRecordId: member.employee_record_id,
            teamSourceId: member.team_source_id,
          })),
        { employeeRecordId: targetId, teamSourceId: null },
      ].map((assignment) => [assignment.employeeRecordId, assignment]),
    ).values(),
  ];
}

/** The visits as the assessment takes them, each keyed by its id: unique, where two may share a local start. */
function assessedOccurrences(visits: readonly MovedVisit[]): MaterializedOccurrence[] {
  return visits.map((visit) => ({
    originalStartLocal: visit.id,
    timeKind: visit.time_kind,
    startAt: visit.start_at,
    endAt: visit.end_at,
    startDate: visit.start_date,
    endDateExclusive: visit.end_date_exclusive,
    dstResolution: 'exact',
  }));
}

/** The planning assessment of the visits with their people after the handover, none of them counted twice. */
function assessVisits(
  organizationId: string,
  jobId: string | null,
  visits: readonly MovedVisit[],
  crews: Crews,
) {
  return assessPlanningOccurrences({
    orgId: organizationId,
    jobId,
    occurrences: assessedOccurrences(visits),
    assignments: [],
    assignmentsByOriginalStartLocal: crews,
    excludeOccurrenceIds: visits.map((visit) => visit.id),
  });
}

type Crews = ReadonlyMap<string, PlanningAssignmentDraft[]>;

/**
 * The assessment of every visit a handover moves. Capacity is assessed over
 * the whole handover at once, so two jobs that go to one person on one day
 * count together; each job keeps its own qualification snapshot. A capacity
 * conflict the manager has not confirmed for exactly this assessment refuses
 * the handover with the conflicts to show.
 */
export async function assessHandover(input: {
  admin: AdminClient;
  organizationId: string;
  employeeRecordId: string;
  handoverFrom: string;
  rows: ReadonlyArray<{ jobId: string; targetEmployeeRecordId: string }>;
  acknowledgement: ConflictAcknowledgement;
}): Promise<HandoverAssessmentResult> {
  const visits = await readMovedVisits(input.admin, input.organizationId, {
    employeeRecordId: input.employeeRecordId,
    handoverFrom: input.handoverFrom,
    jobIds: input.rows.map((row) => row.jobId),
  });
  if (!visits) return { success: false, error: 'load_failed' };
  const targetOfJob = new Map(input.rows.map((row) => [row.jobId, row.targetEmployeeRecordId]));
  const crews: Crews = new Map(
    visits.map((visit) => [
      visit.id,
      crewAfterHandover(visit, input.employeeRecordId, targetOfJob.get(visit.job_id) ?? ''),
    ]),
  );
  const jobIds = [...new Set(visits.map((visit) => visit.job_id))].toSorted();
  const [capacity, ...qualifications] = await Promise.all([
    assessVisits(input.organizationId, null, visits, crews),
    ...jobIds.map((jobId) =>
      assessVisits(
        input.organizationId,
        jobId,
        visits.filter((visit) => visit.job_id === jobId),
        crews,
      ),
    ),
  ]);
  if (!capacity || qualifications.some((assessment) => !assessment)) {
    return { success: false, error: 'load_failed' };
  }
  // Capacity over the whole handover, qualification gaps per job: one reason
  // confirms exactly these assessments, as a calendar reassignment needs one.
  const jobQualifications = qualifications.flatMap((assessment) => (assessment ? [assessment] : []));
  const refusal = rejectUnacknowledgedConflicts(
    {
      conflicts: [
        ...capacity.conflicts.filter((conflict) => conflict.kind !== 'qualification'),
        ...jobQualifications.flatMap((job) =>
          job.conflicts.filter((conflict) => conflict.kind === 'qualification'),
        ),
      ],
      assessmentFingerprint: createHash('sha256')
        .update(
          [
            capacity.capacityFingerprint,
            ...jobQualifications.map((job) => job.qualificationFingerprint),
          ].join('\n'),
        )
        .digest('hex'),
    },
    input.acknowledgement,
  );
  if (refusal) return refusal;
  const assessments = jobIds.flatMap((jobId, index): JobHandoverAssessment[] => {
    const qualification = qualifications[index];
    if (!qualification) return [];
    return [
      {
        jobId,
        capacitySnapshot: capacity.capacitySnapshot,
        capacityFingerprint: capacity.capacityFingerprint,
        qualificationSnapshot: qualification.qualificationSnapshot,
        qualificationFingerprint: qualification.qualificationFingerprint,
        visits: visits
          .filter((visit) => visit.job_id === jobId)
          .map((visit) => ({
            occurrenceId: visit.id,
            version: visit.version,
            employeeRecordIds: (crews.get(visit.id) ?? []).map((member) => member.employeeRecordId),
          })),
      },
    ];
  });
  return { success: true, assessments };
}

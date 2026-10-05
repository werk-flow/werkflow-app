import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { addLocalMonthsClamped } from './date-time';
import { materializeSeries } from './recurrence';
import type { CreatePlanningEntryInput } from './schemas';
import { rejectUnacknowledgedConflicts } from './conflict-acknowledgement';
import { assessPlanningOccurrences, expandPlanningTeamsForDates } from './server';
import type {
  MaterializedOccurrence,
  PlanningActionFailure,
  PlanningAssignmentDraft,
  PlanningSeriesDraft,
} from './types';

type OccurrenceAssignment = PlanningAssignmentDraft & { occurrenceOriginalStartLocal: string };

/** The arguments every function that materializes a new planning entry takes. */
export type PreparedPlanningCreation = {
  success: true;
  series:
    | (PlanningSeriesDraft & {
        segmentStartLocal: string;
        segmentEndBeforeLocal: null;
        generatedThroughLocal: string | null;
      })
    | null;
  occurrences: ReturnType<typeof serializeOccurrence>[];
  assignments: OccurrenceAssignment[];
  capacitySnapshot: Json;
  capacityFingerprint: string;
  qualificationSnapshot: Json;
  qualificationFingerprint: string;
};

function buildSeriesDraft(input: CreatePlanningEntryInput): PlanningSeriesDraft {
  const recurrence = input.recurrence ?? {
    frequency: 'daily' as const,
    interval: 1,
    weekdays: null,
    monthDay: null,
    occurrenceCount: 1,
    untilLocalDate: null,
  };
  return {
    entryKind: input.entryKind,
    internalType: input.internalType,
    jobId: input.jobId,
    title: input.title,
    description: input.description,
    location: input.location,
    timeKind: input.timeKind,
    startsAtLocal: input.startsAtLocal,
    durationMinutes: input.durationMinutes,
    durationDays: input.durationDays,
    timezone: 'Europe/Berlin',
    ...recurrence,
  };
}

function serializeOccurrence(occurrence: MaterializedOccurrence, input: CreatePlanningEntryInput) {
  return {
    ...occurrence,
    jobId: input.jobId,
    entryKind: input.entryKind,
    internalType: input.internalType,
    title: input.title,
    description: input.description,
    location: input.location,
  };
}

/**
 * Materializes a new entry for the caller's organization, expands its teams
 * and assesses capacity and qualifications. A conflict the caller has not
 * confirmed with the current fingerprint is a failure. The caller has already
 * established identity and the manager role.
 */
export async function preparePlanningCreation(
  input: CreatePlanningEntryInput,
  organizationId: string,
): Promise<PreparedPlanningCreation | PlanningActionFailure> {
  const draft = buildSeriesDraft(input);
  const horizon = addLocalMonthsClamped(input.startsAtLocal.slice(0, 10), 18);
  const occurrences = materializeSeries(draft, horizon);
  const assignments: OccurrenceAssignment[] = [];
  const assignmentsByOriginalStartLocal = new Map<string, PlanningAssignmentDraft[]>();
  const teamAssignmentsByDate = await expandPlanningTeamsForDates({
    admin: createSupabaseAdminClient(),
    orgId: organizationId,
    teamIds: [...new Set(input.teamIds)],
    localDates: occurrences.map((occurrence) => occurrence.originalStartLocal.slice(0, 10)),
  });
  if (!teamAssignmentsByDate) {
    return { success: false, error: 'team_load_failed' };
  }
  for (const occurrence of occurrences) {
    const occurrenceAssignments: PlanningAssignmentDraft[] = [
      ...new Map(
        [
          ...input.assignmentDrafts,
          ...(teamAssignmentsByDate.get(occurrence.originalStartLocal.slice(0, 10)) ?? []),
        ].map((assignment) => [assignment.employeeRecordId, assignment]),
      ).values(),
    ];
    assignments.push(
      ...occurrenceAssignments.map((assignment) => ({
        ...assignment,
        occurrenceOriginalStartLocal: occurrence.originalStartLocal,
      })),
    );
    assignmentsByOriginalStartLocal.set(occurrence.originalStartLocal, occurrenceAssignments);
  }
  const assessment = await assessPlanningOccurrences({
    orgId: organizationId,
    jobId: input.jobId,
    occurrences,
    assignments: [],
    assignmentsByOriginalStartLocal,
  });
  if (!assessment) {
    return { success: false, error: 'assessment_failed' };
  }
  const conflictRejection = rejectUnacknowledgedConflicts(assessment, {
    overrideReason: input.overrideReason ?? null,
    assessmentFingerprint: input.assessmentFingerprint ?? null,
  });
  if (conflictRejection) return conflictRejection;
  return {
    success: true,
    series: input.recurrence
      ? {
          ...draft,
          segmentStartLocal: input.startsAtLocal,
          segmentEndBeforeLocal: null,
          generatedThroughLocal: occurrences.at(-1)?.originalStartLocal ?? null,
        }
      : null,
    occurrences: occurrences.map((occurrence) => serializeOccurrence(occurrence, input)),
    assignments,
    capacitySnapshot: assessment.capacitySnapshot,
    capacityFingerprint: assessment.capacityFingerprint,
    qualificationSnapshot: assessment.qualificationSnapshot,
    qualificationFingerprint: assessment.qualificationFingerprint,
  };
}

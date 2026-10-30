import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import type { ParsedPlanningCalendarInput } from './schemas';
import { expandPlanningTeamsForDates } from './server';
import type { MaterializedOccurrence, PlanningAssignmentDraft } from './types';

type SourceAssignmentRow = { employee_record_id: string; team_source_id: string | null };

/**
 * The direct assignments an edit selects, by employee record or by member user id, checked against
 * the organization. `assignments` is null when the edit keeps the current assignments.
 */
export async function resolveSelectedPlanningAssignments(
  admin: AdminClient,
  orgId: string,
  request: ParsedPlanningCalendarInput,
): Promise<ActionResult<{ assignments: PlanningAssignmentDraft[] | null }>> {
  if (request.selectedEmployeeRecordIds) {
    const recordIds = [...new Set(request.selectedEmployeeRecordIds)];
    const { data: records, error: recordsError } = await readInBatches(recordIds, (batch) =>
      admin
        .from('employee_records')
        .select('id')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    );
    if (recordsError) logError('Failed to load selected employee records', recordsError);
    if (recordsError || records.length !== recordIds.length) {
      return { success: false as const, error: 'employee_not_found' };
    }
    return {
      success: true as const,
      assignments: recordIds.map((employeeRecordId) => ({ employeeRecordId, teamSourceId: null })),
    };
  }
  if (request.selectedUserIds) {
    const userIds = [...new Set(request.selectedUserIds)];
    const { data: records, error: recordsError } = await readInBatches(userIds, (batch) =>
      admin
        .from('employee_records')
        .select('id')
        .eq('organization_id', orgId)
        .in('user_id', [...batch]),
    );
    if (recordsError) logError('Failed to load selected member records', recordsError);
    if (recordsError || records.length !== userIds.length) {
      return { success: false as const, error: 'member_not_found' };
    }
    return {
      success: true as const,
      assignments: records.map((record) => ({ employeeRecordId: record.id, teamSourceId: null })),
    };
  }
  return { success: true as const, assignments: null };
}

/** The teams of an occurrence's assignment rows, and the people assigned without a team. */
export function splitSourceAssignments(rows: SourceAssignmentRow[]): {
  teamIds: string[];
  directAssignments: PlanningAssignmentDraft[];
} {
  return {
    teamIds: [
      ...new Set(
        rows.flatMap((assignment) => (assignment.team_source_id ? [assignment.team_source_id] : [])),
      ),
    ],
    directAssignments: rows
      .filter((assignment) => !assignment.team_source_id)
      .map((assignment) => ({
        employeeRecordId: assignment.employee_record_id,
        teamSourceId: null,
      })),
  };
}

/**
 * Each occurrence's assignments by its original start: the direct people plus the members of each
 * team on the occurrence's date, one entry per person. Null when the team read failed.
 */
export async function assignmentsPerOccurrence(input: {
  admin: AdminClient;
  orgId: string;
  teamIds: string[];
  directAssignments: PlanningAssignmentDraft[];
  occurrences: MaterializedOccurrence[];
}): Promise<Map<string, PlanningAssignmentDraft[]> | null> {
  const teamAssignmentsByDate = await expandPlanningTeamsForDates({
    admin: input.admin,
    orgId: input.orgId,
    teamIds: input.teamIds,
    localDates: input.occurrences.map((occurrence) => occurrence.originalStartLocal.slice(0, 10)),
  });
  if (!teamAssignmentsByDate) return null;
  const assignmentsByOriginalStartLocal = new Map<string, PlanningAssignmentDraft[]>();
  for (const occurrence of input.occurrences) {
    assignmentsByOriginalStartLocal.set(occurrence.originalStartLocal, [
      ...new Map(
        [
          ...input.directAssignments,
          ...(teamAssignmentsByDate.get(occurrence.originalStartLocal.slice(0, 10)) ?? []),
        ].map((assignment) => [assignment.employeeRecordId, assignment]),
      ).values(),
    ]);
  }
  return assignmentsByOriginalStartLocal;
}

/** The assignment rows of the occurrences, each tied to its occurrence by the original start. */
export function assignmentRowsFor(
  occurrences: MaterializedOccurrence[],
  assignmentsByOriginalStartLocal: ReadonlyMap<string, PlanningAssignmentDraft[]>,
): Array<PlanningAssignmentDraft & { occurrenceOriginalStartLocal: string }> {
  return occurrences.flatMap((occurrence) =>
    (assignmentsByOriginalStartLocal.get(occurrence.originalStartLocal) ?? []).map((assignment) => ({
      ...assignment,
      occurrenceOriginalStartLocal: occurrence.originalStartLocal,
    })),
  );
}

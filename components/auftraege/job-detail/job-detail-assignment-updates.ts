import { calculatePlannedWorkingMinutes } from '@/lib/jobs/planned-working';
import type { Job, JobWithDetails } from '@/lib/jobs/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';

type JobMemberLookup = Map<string, OrgMemberOption>;

/** Adds the just-assigned members to the shown job until the next server read replaces them. */
export function appendOptimisticJobAssignments(
  current: JobWithDetails,
  successfulIds: string[],
  memberLookup: JobMemberLookup,
): JobWithDetails {
  const existingIds = new Set(current.assignments.map((assignment) => assignment.userId));
  const nextAssignments = [
    ...current.assignments,
    ...successfulIds
      .filter((userId) => !existingIds.has(userId))
      .map((userId) => {
        const member = memberLookup.get(userId);
        return {
          id: `temp-${current.id}-${userId}`,
          jobId: current.id,
          userId,
          assignedBy: current.createdBy,
          assignedAt: new Date().toISOString(),
          firstName: member?.firstName ?? null,
          lastName: member?.lastName ?? null,
          email: null,
          avatarPath: null,
        };
      }),
  ];

  return {
    ...current,
    assignments: nextAssignments,
    plannedWorkingMinutes: calculatePlannedWorkingMinutes(
      current.estimatedDurationMinutes,
      nextAssignments.length,
    ),
  };
}

export function removeJobAssignment(current: JobWithDetails, userId: string): JobWithDetails {
  const nextAssignments = current.assignments.filter((assignment) => assignment.userId !== userId);

  return {
    ...current,
    assignments: nextAssignments,
    plannedWorkingMinutes: calculatePlannedWorkingMinutes(
      current.estimatedDurationMinutes,
      nextAssignments.length,
    ),
  };
}

/** Applies a saved edit: the job fields plus the selection made in the edit dialog. */
export function replaceJobAssignmentsAfterEdit(
  current: JobWithDetails,
  updatedJob: Job,
  selectedIds: Set<string>,
  memberLookup: JobMemberLookup,
): JobWithDetails {
  const assignmentLookup = new Map(current.assignments.map((assignment) => [assignment.userId, assignment]));
  const assignments = [...selectedIds].map((userId) => {
    const existing = assignmentLookup.get(userId);
    if (existing) return existing;
    const member = memberLookup.get(userId);
    return {
      id: `temp-${current.id}-${userId}`,
      jobId: current.id,
      userId,
      assignedBy: current.createdBy,
      assignedAt: new Date().toISOString(),
      firstName: member?.firstName ?? null,
      lastName: member?.lastName ?? null,
      email: null,
      avatarPath: null,
    };
  });

  return { ...current, ...updatedJob, assignments };
}

import 'server-only';

// The checks of an unpark into the schedule, before its one database call.
// An internal server helper: it takes the admin client from its authorized
// caller and is never exported from a 'use server' module.

import type { ActionFailure } from '@/lib/action-result';
import { assignmentApprovalSchema, planningApprovalSchema } from '@/lib/jobs/action-schemas';
import type { QualificationWarningResult } from '@/lib/jobs/types';
import { prepareJobUpdate } from '@/lib/jobs/update-preparation';
import {
  planningAcknowledgement,
  type PlanningWarningFailure,
} from '@/lib/planning/conflict-acknowledgement';
import { assessJobPlan } from '@/lib/planning/job-team-assessment';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

export const unparkScheduleInputSchema = z.object({
  jobId: uuidSchema,
  blockerVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(1000),
  schedule: z.object({
    plannedDate: z.string().date(),
    plannedTime: z.string().max(5),
    estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
    selectedUserIds: z.array(uuidSchema).max(100),
  }),
  assignmentApproval: assignmentApprovalSchema.nullish(),
  planningApproval: planningApprovalSchema,
});

type UnparkScheduleArguments =
  Database['public']['Functions']['unpark_job_into_schedule_with_visit_assessment']['Args'];

/**
 * Checks the schedule write of an unpark as a job edit, then runs the
 * calendar's capacity check on the visit it plans: unpark_job_into_schedule
 * puts every person of the team on that visit. A qualification or planning
 * warning returns before anything is written, so the job stays parked.
 */
export async function prepareUnparkIntoSchedule({
  admin,
  orgId,
  actorId,
  input,
}: {
  admin: AdminClient;
  orgId: string;
  actorId: string;
  input: z.output<typeof unparkScheduleInputSchema>;
}): Promise<
  | { success: true; arguments: UnparkScheduleArguments }
  | QualificationWarningResult
  | PlanningWarningFailure
  | ActionFailure
> {
  const { jobId, schedule } = input;
  const prepared = await prepareJobUpdate({
    admin,
    orgId,
    actorId,
    jobId,
    input: {
      plannedDate: schedule.plannedDate,
      plannedTime: schedule.plannedTime,
      ...(schedule.estimatedDurationMinutes !== undefined
        ? { estimatedDurationMinutes: schedule.estimatedDurationMinutes }
        : {}),
      selectedUserIds: schedule.selectedUserIds,
      assignmentApproval: input.assignmentApproval,
    },
  });
  if (!prepared.success) return prepared;
  const plan = await assessJobPlan({
    admin,
    orgId,
    jobId,
    ...prepared.plan,
    wholeTeamJoinsVisit: true,
    acknowledgement: planningAcknowledgement(input.planningApproval),
  });
  if (!plan.success) return plan;
  return {
    success: true,
    arguments: rpcArgs('unpark_job_into_schedule_with_visit_assessment', {
      ...prepared.arguments,
      p_expected_blocker_version: input.blockerVersion,
      p_reason: input.reason,
      p_visit_assessment: plan.planAssessment,
    }),
  };
}

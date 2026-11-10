'use server';

import { revalidatePath } from 'next/cache';
import type { ActionFailure } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { resolveActionContext } from '@/lib/org/action-context';
import type { PlanningWarningFailure } from '@/lib/planning/conflict-acknowledgement';
import { planningAcknowledgement } from '@/lib/planning/conflict-acknowledgement';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { assessHandover } from './handover-assessment';
import { revalidatePersonnel } from './lifecycle-results';
import { handOverWorkInputSchema } from './open-work';

// The handover of a leaver's open work: per open job, a target person takes
// the leaver's visits from the handover date on and joins the job's team
// (supabase/migrations/20261129100000_hand_over_a_leavers_open_work.sql).

type HandOverWorkResult =
  | { success: true; data: { handedOver: number } }
  | PlanningWarningFailure
  | ActionFailure;

const handoverRefusal = writeRefusalFor(
  new Set([
    'forbidden',
    'employee_record_not_found',
    'invalid_handover_date',
    'invalid_handover',
    'job_not_found',
    'target_not_found',
    'invalid_target',
    'target_not_available',
    'target_without_login',
    'stale_handover',
    'stale_planning_occurrence',
  ]),
);

/** Hands each listed open job of the person to its target. Admin and Büro plan, so both may. */
export async function handOverPersonnelWork(input: unknown): Promise<HandOverWorkResult> {
  const parsed = handOverWorkInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveActionContext();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const { orgId, userId } = auth.context;
  const request = parsed.data;
  if (request.handoverFrom < getBusinessTodayIso()) return { success: false, error: 'invalid_handover_date' };

  const admin = createSupabaseAdminClient();
  const targetIds = [...new Set(request.rows.map((row) => row.targetEmployeeRecordId))];
  const records = await readInBatches([request.employeeRecordId, ...targetIds], (batch) =>
    admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  if (records.error) {
    logReadFailure('handOverPersonnelWork: employee records failed', {
      code: records.error.code ?? 'unknown',
    });
    return { success: false, error: 'load_failed' };
  }
  const inOrganization = new Set(records.data.map((record) => record.id));
  if (!inOrganization.has(request.employeeRecordId)) return { success: false, error: 'record_not_found' };
  if (targetIds.some((targetId) => !inOrganization.has(targetId))) {
    return { success: false, error: 'target_not_found' };
  }
  if (targetIds.includes(request.employeeRecordId)) return { success: false, error: 'invalid_target' };

  const assessed = await assessHandover({
    admin,
    organizationId: orgId,
    employeeRecordId: request.employeeRecordId,
    handoverFrom: request.handoverFrom,
    rows: request.rows,
    acknowledgement: planningAcknowledgement(request.planningApproval),
  });
  if (!assessed.success) return assessed;

  const { data, error } = await admin.rpc(
    'hand_over_personnel_work',
    rpcArgs('hand_over_personnel_work', {
      p_organization_id: orgId,
      p_actor_id: userId,
      p_employee_record_id: request.employeeRecordId,
      p_handover_from: request.handoverFrom,
      p_rows: request.rows,
      p_assessments: assessed.assessments,
      p_override_reason: request.planningApproval?.reason ?? null,
    }),
  );
  if (error) return handoverRefusal(error, 'mutation_failed', 'handOverPersonnelWork: handover failed');
  revalidatePersonnel();
  revalidatePath('/auftraege', 'layout');
  revalidatePath('/mitarbeiter', 'layout');
  return { success: true, data: { handedOver: data } };
}

'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { endWorkLeadSchema, nameWorkLeadSchema } from './work-lead-types';

// Raised by name_work_lead and end_work_lead under the target's row lock.
const workLeadRefusal = writeRefusalFor(
  new Set(['work_lead_member_not_eligible', 'work_lead_changed', 'work_lead_target_not_found']),
);

/** A refusal of the database's own manager check is the caller's refusal. */
function writeFailure(error: { message: string }, label: string) {
  if (error.message === 'work_lead_not_authorized')
    return { success: false, error: 'not_authorized' } as const;
  return workLeadRefusal(error, 'save_failed', label);
}

/** The project or job column a write names; the other stays null. */
function targetColumns(input: { targetType: 'project' | 'job'; targetId: string }) {
  return {
    p_project_id: input.targetType === 'project' ? input.targetId : null,
    p_job_id: input.targetType === 'job' ? input.targetId : null,
  };
}

/**
 * Admin and Büro name a member of the organization as the „Projektleitung“
 * of a project or standalone job. The same call ends the open holding the
 * caller saw (`expectedLeadId`); a holding changed meanwhile is refused.
 */
export async function nameWorkLead(rawInput: {
  targetType: 'project' | 'job';
  targetId: string;
  userId: string;
  expectedLeadId: string | null;
}): Promise<ActionResult> {
  const parsed = nameWorkLeadSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };

  const { error } = await createSupabaseAdminClient().rpc(
    'name_work_lead',
    rpcArgs('name_work_lead', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      ...targetColumns(parsed.data),
      p_lead_user_id: parsed.data.userId,
      p_expected_lead_id: parsed.data.expectedLeadId,
    }),
  );
  if (error) return writeFailure(error, 'nameWorkLead: name_work_lead failed');
  revalidatePath('/auftraege', 'layout');
  return { success: true };
}

/** Admin and Büro end the open „Projektleitung“ they saw; a repeat changes nothing. */
export async function endWorkLead(rawInput: {
  targetType: 'project' | 'job';
  targetId: string;
  expectedLeadId: string;
}): Promise<ActionResult> {
  const parsed = endWorkLeadSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };

  const { error } = await createSupabaseAdminClient().rpc(
    'end_work_lead',
    rpcArgs('end_work_lead', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      ...targetColumns(parsed.data),
      p_expected_lead_id: parsed.data.expectedLeadId,
    }),
  );
  if (error) return writeFailure(error, 'endWorkLead: end_work_lead failed');
  revalidatePath('/auftraege', 'layout');
  return { success: true };
}

'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import type { ActionFailure } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { authorizeResponsibilityForTarget } from '@/lib/responsibilities/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { optionalFormText, parseFormData } from '@/lib/validation/form-data';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { requireAuth } from './access';
import { failureCode, parseStrictInteger, refuseNonManager } from './action-support';
import { readApprovalTargets } from './decision-reads';
import type { TimeAccountActionResult } from './messages';

// The decisions on an adjustment request and on a period finding. Four eyes:
// the proposer of an adjustment never decides it but may withdraw it while it
// is open, and a decision about a person follows the caller's time-approval
// holder scope. The database functions check these rules again.

const id = uuidSchema.optional();
const text = optionalFormText;
const decideTimeAccountAdjustmentFormSchema = z.object({
  requestId: id,
  expectedVersion: text(12),
  decision: text(40),
  reason: text(2000),
});
const withdrawTimeAccountAdjustmentFormSchema = z.object({ requestId: id, expectedVersion: text(12) });
const decidePeriodFindingFormSchema = z.object({
  findingId: id,
  periodId: id,
  decision: text(40),
  reason: text(2000),
});

/**
 * The refusal when the caller may not decide a time-account matter of one
 * personnel record of their organization: outside their time-approval holder
 * scope, or their own record. The database function checks the same rule again.
 */
async function refuseOutsideApprovalScope<Refusal extends string>(
  context: { orgId: string; userId: string },
  employeeRecordId: string,
  refusal: Refusal,
): Promise<ActionFailure<'responsibility_load_failed' | Refusal> | null> {
  const targets = await readApprovalTargets(context.orgId, [employeeRecordId]);
  if (!targets) return { success: false, error: 'responsibility_load_failed' };
  const target = targets.get(employeeRecordId);
  if (!target) return { success: false, error: refusal };
  const authorization = await authorizeResponsibilityForTarget({
    organizationId: context.orgId,
    responsibility: 'time_approval',
    actorUserId: context.userId,
    targetUserId: target.userId,
    targetRole: target.role,
  });
  if (authorization.success) return null;
  return {
    success: false,
    error: authorization.error === 'responsibility_load_failed' ? 'responsibility_load_failed' : refusal,
  };
}

export async function decideTimeAccountAdjustment(
  formInput: FormData,
): Promise<TimeAccountActionResult<'decideAdjustment'>> {
  const formData = parseFormData(formInput, decideTimeAccountAdjustmentFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  const refusal = await refuseNonManager(context);
  if (refusal) return refusal;
  const requestId = String(formData.get('requestId') ?? '');
  const expectedVersion = parseStrictInteger(formData.get('expectedVersion'));
  const decision = String(formData.get('decision') ?? '');
  const reason = String(formData.get('reason') ?? '');
  if (!requestId || expectedVersion === null || (decision !== 'approved' && decision !== 'rejected'))
    return { success: false, error: 'invalid_input' };
  if (!reason.trim()) return { success: false, error: 'reason_required' };
  const admin = createSupabaseAdminClient();
  const { data: request, error: requestError } = await admin
    .from('time_account_adjustment_requests')
    .select('employee_record_id, requested_by')
    .eq('organization_id', context.orgId)
    .eq('id', requestId)
    .maybeSingle();
  if (requestError) {
    logError('decideTimeAccountAdjustment: request read failed', requestError);
    return { success: false, error: 'decision_failed' };
  }
  if (!request) return { success: false, error: 'request_not_found' };
  // Four eyes: whoever proposed an adjustment decides nothing about it.
  if (request.requested_by === context.userId) return { success: false, error: 'own_proposal' };
  const scopeRefusal = await refuseOutsideApprovalScope(
    context,
    request.employee_record_id,
    'not_responsible_or_self_approval',
  );
  if (scopeRefusal) return scopeRefusal;
  const { error } = await admin.rpc('decide_time_account_adjustment', {
    p_organization_id: context.orgId,
    p_request_id: requestId,
    p_expected_version: expectedVersion,
    p_decision: decision,
    p_reason: reason,
    p_actor_id: context.userId,
    p_operation_id: randomUUID(),
  });
  if (error)
    return {
      success: false,
      error: failureCode(
        'decideAdjustment',
        'decision_failed',
        'decideTimeAccountAdjustment: decide_time_account_adjustment failed',
        error,
      ),
    };
  revalidatePath('/zeiterfassung/einstellungen');
  revalidatePath('/einstellungen/zeiterfassung');
  revalidatePath('/zeiterfassung/zeitkonto');
  return { success: true };
}

export async function decidePeriodFinding(
  formInput: FormData,
): Promise<TimeAccountActionResult<'decideFinding'>> {
  const formData = parseFormData(formInput, decidePeriodFindingFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  const refusal = await refuseNonManager(context);
  if (refusal) return refusal;
  const findingId = String(formData.get('findingId') ?? '');
  const periodId = String(formData.get('periodId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const reason = String(formData.get('reason') ?? 'Geprüft');
  if (
    !findingId ||
    !periodId ||
    (decision !== 'approved' && decision !== 'rejected' && decision !== 'acknowledged') ||
    !reason.trim()
  )
    return { success: false, error: 'invalid_input' };
  const admin = createSupabaseAdminClient();
  const { data: finding, error: findingError } = await admin
    .from('time_period_findings')
    .select('employee_record_id')
    .eq('organization_id', context.orgId)
    .eq('id', findingId)
    .maybeSingle();
  if (findingError) {
    logError('decidePeriodFinding: finding read failed', findingError);
    return { success: false, error: 'decision_failed' };
  }
  if (!finding) return { success: false, error: 'finding_not_found' };
  // An organization-wide finding names no person; the database asks only for the holder.
  if (finding.employee_record_id) {
    const scopeRefusal = await refuseOutsideApprovalScope(context, finding.employee_record_id, 'forbidden');
    if (scopeRefusal) return scopeRefusal;
  }
  const { error } = await admin.rpc('decide_time_period_finding', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_finding_id: findingId,
    p_decision: decision,
    p_reason: reason,
    p_operation_id: randomUUID(),
  });
  if (error)
    return {
      success: false,
      error: failureCode(
        'decideFinding',
        'decision_failed',
        'decidePeriodFinding: decide_time_period_finding failed',
        error,
      ),
    };
  revalidatePath(`/zeiterfassung/perioden/${periodId}`);
  return { success: true };
}

/** Stored as the reason of a withdrawal; the proposer types none. */
const WITHDRAWAL_REASON = 'Zurückgezogen';

export async function withdrawTimeAccountAdjustment(
  formInput: FormData,
): Promise<TimeAccountActionResult<'withdrawAdjustment'>> {
  const formData = parseFormData(formInput, withdrawTimeAccountAdjustmentFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  if (context.role !== 'admin' && context.role !== 'buero') return { success: false, error: 'forbidden' };
  const requestId = String(formData.get('requestId') ?? '');
  const expectedVersion = parseStrictInteger(formData.get('expectedVersion'));
  if (!requestId || expectedVersion === null) return { success: false, error: 'invalid_input' };
  const admin = createSupabaseAdminClient();
  const { data: request, error: requestError } = await admin
    .from('time_account_adjustment_requests')
    .select('requested_by')
    .eq('organization_id', context.orgId)
    .eq('id', requestId)
    .maybeSingle();
  if (requestError) {
    logError('withdrawTimeAccountAdjustment: request read failed', requestError);
    return { success: false, error: 'withdraw_failed' };
  }
  if (!request) return { success: false, error: 'request_not_found' };
  if (request.requested_by !== context.userId) return { success: false, error: 'not_proposer' };
  const { error } = await admin.rpc('withdraw_time_account_adjustment', {
    p_organization_id: context.orgId,
    p_request_id: requestId,
    p_expected_version: expectedVersion,
    p_reason: WITHDRAWAL_REASON,
    p_actor_id: context.userId,
    p_operation_id: randomUUID(),
  });
  if (error)
    return {
      success: false,
      error: failureCode(
        'withdrawAdjustment',
        'withdraw_failed',
        'withdrawTimeAccountAdjustment: withdraw_time_account_adjustment failed',
        error,
      ),
    };
  revalidatePath('/zeiterfassung/einstellungen');
  revalidatePath('/einstellungen/zeiterfassung');
  return { success: true };
}

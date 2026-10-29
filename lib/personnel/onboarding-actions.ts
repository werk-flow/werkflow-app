'use server';

import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import {
  createOnboardingPlanInputSchema,
  publishTemplateInputSchema,
  saveRequirementInputSchema,
  toTemplateRpcItems,
} from './lifecycle';
import {
  hashRequest,
  lifecycleFailureCode,
  requireManagerRecord,
  revalidatePersonnel,
  type LifecycleResult,
} from './lifecycle-action-context';
import { toTemplateSummaries, type PersonnelOnboardingTemplateSummary } from './lifecycle-rows';

export async function createPersonnelOnboardingPlan(
  input: unknown,
): Promise<LifecycleResult<{ planId: string }>> {
  const parsed = createOnboardingPlanInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireManagerRecord(parsed.data.employeeRecordId);
  if (!context.success) return context;
  const request = parsed.data;
  const { data, error } = await context.admin.rpc(
    'create_personnel_onboarding_plan',
    rpcArgs('create_personnel_onboarding_plan', {
      p_actor_id: context.actorId,
      p_organization_id: context.organizationId,
      p_employee_record_id: request.employeeRecordId,
      p_template_version_id: request.templateVersionId,
      p_name: request.name,
      p_target_start_date: request.targetStartDate,
      p_operation_id: request.operationId,
      p_request_hash: hashRequest(request),
    }),
  );
  if (error || !data) return { success: false, error: lifecycleFailureCode(error) };
  revalidatePersonnel();
  return { success: true, data: { planId: data } };
}

export async function savePersonnelOnboardingRequirement(
  input: unknown,
): Promise<LifecycleResult<{ requirementId: string }>> {
  const parsed = saveRequirementInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const admin = createSupabaseAdminClient();
  const { data: plan, error: planError } = await loggedRead(
    'savePersonnelOnboardingRequirement: personnel_onboarding_plans read failed',
    admin
      .from('personnel_onboarding_plans')
      .select('employee_record_id')
      .eq('id', parsed.data.planId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (planError) return { success: false, error: 'load_failed' };
  if (!plan) return { success: false, error: 'plan_not_found' };
  const request = parsed.data;
  const { data, error } = await admin.rpc(
    'save_personnel_onboarding_requirement',
    rpcArgs('save_personnel_onboarding_requirement', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_plan_id: request.planId,
      p_requirement_id: request.requirementId,
      p_expected_version: request.expectedVersion,
      p_requirement_type: request.requirementType,
      p_title: request.title,
      p_description: request.description,
      p_is_required: request.isRequired,
      p_blocks_access: request.blocksAccess,
      p_owner_employee_record_id: request.ownerEmployeeRecordId,
      p_due_date: request.dueDate,
      p_state: request.state,
      p_blocker_reason: request.blockerReason,
      p_operation_id: request.operationId,
      p_request_hash: hashRequest(request),
    }),
  );
  if (error || !data) return { success: false, error: lifecycleFailureCode(error) };
  revalidatePersonnel();
  return { success: true, data: { requirementId: data } };
}

export async function publishPersonnelOnboardingTemplate(
  input: unknown,
): Promise<LifecycleResult<{ versionId: string }>> {
  const parsed = publishTemplateInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (auth.context.role !== 'admin') return { success: false, error: 'not_authorized' };
  const admin = createSupabaseAdminClient();
  const request = parsed.data;
  const items = toTemplateRpcItems(request.items);
  const { data, error } = await admin.rpc(
    'publish_personnel_onboarding_template',
    rpcArgs('publish_personnel_onboarding_template', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_template_id: request.templateId,
      p_expected_version: request.expectedVersion,
      p_name: request.name,
      p_description: request.description,
      p_items: items,
      p_operation_id: request.operationId,
      p_request_hash: hashRequest(request),
    }),
  );
  if (error || !data) {
    logError('Failed to publish personnel onboarding template', error);
    return { success: false, error: lifecycleFailureCode(error) };
  }
  revalidatePersonnel();
  return { success: true, data: { versionId: data } };
}

export async function getPersonnelOnboardingTemplates(): Promise<
  LifecycleResult<PersonnelOnboardingTemplateSummary[]>
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('personnel_onboarding_templates')
    .select(
      'id, name, description, state, current_version_number, version, personnel_onboarding_template_versions!inner(id, version_number)',
    )
    .eq('organization_id', auth.context.orgId)
    .order('name');
  if (error) {
    logError('Failed to load personnel onboarding templates', error);
    return { success: false, error: 'load_failed' };
  }
  return { success: true, data: toTemplateSummaries(data ?? []) };
}

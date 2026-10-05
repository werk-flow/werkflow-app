'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { isValidIsoDate } from '@/lib/calendar/date-range';
import {
  resolveEffectiveResponsibility,
  type ResponsibilityAssignment,
  type ResponsibilityConfiguration,
} from './resolution';
import { loadResponsibilityRuntimeState } from './server';
import type { OrganizationResponsibility, ResponsibilityConfigurationMode } from './types';
import { logError } from '@/lib/logging';
import { Constants } from '@/lib/supabase/database.types';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// Boundary schemas: the owner's arguments arrive from the network unchecked.
const responsibilitySchema = z.enum(Constants.public.Enums.organization_responsibility);
const configurationSchema = z.object({
  responsibility: responsibilitySchema,
  mode: z.enum(Constants.public.Enums.responsibility_configuration_mode),
  employeeRecordIds: z.array(uuidSchema).max(1000),
});
const appliedConfigurationSchema = configurationSchema.extend({
  expectedConfigurationId: uuidSchema.nullable(),
});
const delegationSchema = z.object({
  responsibility: responsibilitySchema,
  delegatorEmployeeRecordId: uuidSchema,
  substituteEmployeeRecordId: uuidSchema,
  validFrom: z.string().max(10),
  validUntil: z.string().max(10),
  note: z.string().max(2000),
});

export type ResponsibilityPreview = {
  expectedConfigurationId: string | null;
  responsibility: OrganizationResponsibility;
  mode: ResponsibilityConfigurationMode;
  businessDate: string;
  effectiveHolderIds: string[];
  gainedHolderIds: string[];
  lostHolderIds: string[];
};

function normalizeDatabaseError(message: string): string {
  const knownCodes = [
    'responsibility_configuration_changed',
    'responsibility_requires_active_holder',
    'responsibility_holder_not_active_member',
    'responsibility_configuration_admin_only',
    'responsibility_delegation_invalid_dates',
    'responsibility_delegator_not_current_holder',
    'responsibility_substitute_not_active_member',
    'responsibility_delegation_same_person',
    'responsibility_delegation_overlap',
    'responsibility_delegation_not_found',
    'responsibility_delegation_invalid_revocation_date',
  ];
  return knownCodes.find((code) => message.includes(code)) ?? 'save_failed';
}

/** Responsibility settings belong to the organization owner alone, not to every admin. */
async function requireOwner(): Promise<
  ActionResult<{ context: { orgId: string; userId: string; admin: AdminClient } }>
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { orgId, userId } = auth.context;
  const admin = createSupabaseAdminClient();
  const { data: organization, error } = await admin
    .from('organizations')
    .select('admin_id')
    .eq('id', orgId)
    .single();

  if (error || !organization) {
    return { success: false, error: 'organization_not_found' };
  }
  if (organization.admin_id !== userId) {
    return { success: false, error: 'not_authorized' };
  }
  return { success: true, context: { orgId, userId, admin } };
}

function refreshResponsibilitySurfaces(): void {
  revalidatePath('/einstellungen/mitarbeiter');
  revalidatePath('/mitarbeiter');
  revalidatePath('/zeiterfassung');
}

export async function previewResponsibilityConfiguration(rawInput: {
  responsibility: OrganizationResponsibility;
  mode: ResponsibilityConfigurationMode;
  employeeRecordIds: string[];
}): Promise<ActionResult<{ preview: ResponsibilityPreview }>> {
  const parsedInput = configurationSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const owner = await requireOwner();
  if (!owner.success) return owner;

  const state = await loadResponsibilityRuntimeState(owner.context.orgId);
  if (!state) return { success: false, error: 'load_failed' };

  const selectedIds = Array.from(new Set(input.employeeRecordIds));
  if (input.mode === 'selected' && selectedIds.length === 0) {
    return { success: false, error: 'responsibility_requires_active_holder' };
  }
  if (
    selectedIds.some(
      (employeeRecordId) =>
        !state.members.some((member) => member.active && member.employeeRecordId === employeeRecordId),
    )
  ) {
    return { success: false, error: 'responsibility_holder_not_active_member' };
  }

  const previewBaseTime = Date.now();
  const actionTime = new Date(previewBaseTime).toISOString();
  const businessDate = getBusinessTodayIso();
  const current = resolveEffectiveResponsibility({
    responsibility: input.responsibility,
    actionTime,
    businessDate,
    ...state,
  });
  const previewConfigurationId = `preview-${input.responsibility}`;
  const assignments: ResponsibilityAssignment[] =
    input.mode === 'selected'
      ? selectedIds.map((employeeRecordId, index) => ({
          id: `preview-assignment-${index}`,
          configurationId: previewConfigurationId,
          employeeRecordId,
          source: 'direct',
          roleSnapshot: null,
        }))
      : state.members.flatMap((member, index) => {
          if (!member.active || (member.role !== 'admin' && member.role !== 'buero')) {
            return [];
          }
          return [
            {
              id: `preview-assignment-${index}`,
              configurationId: previewConfigurationId,
              employeeRecordId: member.employeeRecordId,
              source: 'role_default' as const,
              roleSnapshot: member.role,
            },
          ];
        });
  // Advance the synthetic version and resolver timestamps by one millisecond
  // each so the proposed version wins without depending on equal timestamps.
  const previewConfiguration: ResponsibilityConfiguration = {
    id: previewConfigurationId,
    responsibility: input.responsibility,
    mode: input.mode,
    effectiveFrom: new Date(previewBaseTime + 1).toISOString(),
    createdAt: new Date(previewBaseTime + 1).toISOString(),
    assignments,
  };
  const proposed = resolveEffectiveResponsibility({
    responsibility: input.responsibility,
    actionTime: new Date(previewBaseTime + 2).toISOString(),
    businessDate,
    members: state.members,
    configurations: [...state.configurations, previewConfiguration],
    delegations: state.delegations,
  });

  const currentIds = new Set(current.holders.map((holder) => holder.employeeRecordId));
  const proposedIds = new Set(proposed.holders.map((holder) => holder.employeeRecordId));

  return {
    success: true,
    preview: {
      expectedConfigurationId: current.configurationId,
      responsibility: input.responsibility,
      mode: input.mode,
      businessDate,
      effectiveHolderIds: Array.from(proposedIds),
      gainedHolderIds: Array.from(proposedIds).filter(
        (employeeRecordId) => !currentIds.has(employeeRecordId),
      ),
      lostHolderIds: Array.from(currentIds).filter((employeeRecordId) => !proposedIds.has(employeeRecordId)),
    },
  };
}

export async function applyResponsibilityConfiguration(rawInput: {
  responsibility: OrganizationResponsibility;
  mode: ResponsibilityConfigurationMode;
  employeeRecordIds: string[];
  expectedConfigurationId: string | null;
}): Promise<ActionResult> {
  const parsedInput = appliedConfigurationSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const owner = await requireOwner();
  if (!owner.success) return owner;

  const { error } = await owner.context.admin.rpc(
    'apply_responsibility_configuration',
    rpcArgs('apply_responsibility_configuration', {
      p_organization_id: owner.context.orgId,
      p_responsibility: input.responsibility,
      p_mode: input.mode,
      p_employee_record_ids: Array.from(new Set(input.employeeRecordIds)),
      p_actor_id: owner.context.userId,
      p_expected_configuration_id: input.expectedConfigurationId,
    }),
  );
  if (error) {
    logError('Failed to apply responsibility configuration:', error);
    return { success: false, error: normalizeDatabaseError(error.message) };
  }

  refreshResponsibilitySurfaces();
  return { success: true };
}

export async function createResponsibilityDelegation(rawInput: {
  responsibility: OrganizationResponsibility;
  delegatorEmployeeRecordId: string;
  substituteEmployeeRecordId: string;
  validFrom: string;
  validUntil: string;
  note: string;
}): Promise<ActionResult> {
  const parsedInput = delegationSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const owner = await requireOwner();
  if (!owner.success) return owner;
  if (
    !isValidIsoDate(input.validFrom) ||
    !isValidIsoDate(input.validUntil) ||
    input.validUntil < input.validFrom
  ) {
    return { success: false, error: 'responsibility_delegation_invalid_dates' };
  }

  const { error } = await owner.context.admin.rpc('create_responsibility_delegation', {
    p_organization_id: owner.context.orgId,
    p_responsibility: input.responsibility,
    p_delegator_employee_record_id: input.delegatorEmployeeRecordId,
    p_substitute_employee_record_id: input.substituteEmployeeRecordId,
    p_valid_from: input.validFrom,
    p_valid_until: input.validUntil,
    p_note: input.note,
    p_actor_id: owner.context.userId,
  });
  if (error) {
    logError('Failed to create responsibility delegation:', error);
    return { success: false, error: normalizeDatabaseError(error.message) };
  }

  refreshResponsibilitySurfaces();
  return { success: true };
}

export async function endResponsibilityDelegation(rawDelegationId: string): Promise<ActionResult> {
  const parsedDelegationId = uuidSchema.safeParse(rawDelegationId);
  if (!parsedDelegationId.success) return { success: false, error: 'invalid_input' };
  const delegationId = parsedDelegationId.data;
  const owner = await requireOwner();
  if (!owner.success) return owner;

  // The RPC checks the actor against the delegation's own organization; this
  // read binds the delegation to the active organization first.
  const { data: delegation, error: delegationError } = await owner.context.admin
    .from('organization_responsibility_delegations')
    .select('id')
    .eq('organization_id', owner.context.orgId)
    .eq('id', delegationId)
    .maybeSingle();
  if (delegationError) {
    logError('Failed to load responsibility delegation:', delegationError);
    return { success: false, error: 'save_failed' };
  }
  if (!delegation) return { success: false, error: 'responsibility_delegation_not_found' };

  const { error } = await owner.context.admin.rpc('end_responsibility_delegation', {
    p_delegation_id: delegationId,
    p_revoked_from: getBusinessTodayIso(),
    p_actor_id: owner.context.userId,
  });
  if (error) {
    logError('Failed to end responsibility delegation:', error);
    return { success: false, error: normalizeDatabaseError(error.message) };
  }

  refreshResponsibilitySurfaces();
  return { success: true };
}

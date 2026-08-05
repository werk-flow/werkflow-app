'use server';

import { revalidatePath, updateTag } from 'next/cache';

import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  resolveEffectiveResponsibility,
  type ResponsibilityAssignment,
  type ResponsibilityConfiguration,
} from './resolution';
import { loadResponsibilityRuntimeState } from './server';
import type {
  OrganizationResponsibility,
  ResponsibilityConfigurationMode,
} from './types';

type ActionResult = { success: true } | { success: false; error: string };

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

async function requireOwner() {
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
    return { success: false as const, error: 'organization_not_found' };
  }
  if (organization.admin_id !== userId) {
    return { success: false as const, error: 'not_authorized' };
  }
  return { success: true as const, context: { orgId, userId, admin } };
}

function refreshResponsibilitySurfaces(organizationId: string): void {
  updateTag(CACHE_TAGS.responsibilities(organizationId));
  revalidatePath('/einstellungen/mitarbeiter');
  revalidatePath('/mitarbeiter');
  revalidatePath('/zeiterfassung');
  revalidatePath('/kalender');
}

export async function previewResponsibilityConfiguration(input: {
  responsibility: OrganizationResponsibility;
  mode: ResponsibilityConfigurationMode;
  employeeRecordIds: string[];
}): Promise<
  | { success: true; preview: ResponsibilityPreview }
  | { success: false; error: string }
> {
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
        !state.members.some(
          (member) => member.active && member.employeeRecordId === employeeRecordId
        )
    )
  ) {
    return { success: false, error: 'responsibility_holder_not_active_member' };
  }

  const actionTime = new Date().toISOString();
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
          if (
            !member.active ||
            (member.role !== 'admin' && member.role !== 'buero')
          ) {
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
  const previewConfiguration: ResponsibilityConfiguration = {
    id: previewConfigurationId,
    responsibility: input.responsibility,
    mode: input.mode,
    effectiveFrom: new Date(Date.now() + 1).toISOString(),
    createdAt: new Date(Date.now() + 1).toISOString(),
    assignments,
  };
  const proposed = resolveEffectiveResponsibility({
    responsibility: input.responsibility,
    actionTime: new Date(Date.now() + 2).toISOString(),
    businessDate,
    members: state.members,
    configurations: [...state.configurations, previewConfiguration],
    delegations: state.delegations,
  });

  const currentIds = new Set(
    current.holders.map((holder) => holder.employeeRecordId)
  );
  const proposedIds = new Set(
    proposed.holders.map((holder) => holder.employeeRecordId)
  );

  return {
    success: true,
    preview: {
      expectedConfigurationId: current.configurationId,
      responsibility: input.responsibility,
      mode: input.mode,
      businessDate,
      effectiveHolderIds: Array.from(proposedIds),
      gainedHolderIds: Array.from(proposedIds).filter(
        (employeeRecordId) => !currentIds.has(employeeRecordId)
      ),
      lostHolderIds: Array.from(currentIds).filter(
        (employeeRecordId) => !proposedIds.has(employeeRecordId)
      ),
    },
  };
}

export async function applyResponsibilityConfiguration(input: {
  responsibility: OrganizationResponsibility;
  mode: ResponsibilityConfigurationMode;
  employeeRecordIds: string[];
  expectedConfigurationId: string | null;
}): Promise<ActionResult> {
  const owner = await requireOwner();
  if (!owner.success) return owner;

  const { error } = await owner.context.admin.rpc(
    'apply_responsibility_configuration',
    {
      p_organization_id: owner.context.orgId,
      p_responsibility: input.responsibility,
      p_mode: input.mode,
      p_employee_record_ids: Array.from(new Set(input.employeeRecordIds)),
      p_actor_id: owner.context.userId,
      p_expected_configuration_id: input.expectedConfigurationId,
    }
  );
  if (error) {
    console.error('Failed to apply responsibility configuration:', error);
    return { success: false, error: normalizeDatabaseError(error.message) };
  }

  refreshResponsibilitySurfaces(owner.context.orgId);
  return { success: true };
}

export async function createResponsibilityDelegation(input: {
  responsibility: OrganizationResponsibility;
  delegatorEmployeeRecordId: string;
  substituteEmployeeRecordId: string;
  validFrom: string;
  validUntil: string;
  note: string;
}): Promise<ActionResult> {
  const owner = await requireOwner();
  if (!owner.success) return owner;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)) {
    return { success: false, error: 'responsibility_delegation_invalid_dates' };
  }

  const { error } = await owner.context.admin.rpc(
    'create_responsibility_delegation',
    {
      p_organization_id: owner.context.orgId,
      p_responsibility: input.responsibility,
      p_delegator_employee_record_id: input.delegatorEmployeeRecordId,
      p_substitute_employee_record_id: input.substituteEmployeeRecordId,
      p_valid_from: input.validFrom,
      p_valid_until: input.validUntil,
      p_note: input.note,
      p_actor_id: owner.context.userId,
    }
  );
  if (error) {
    console.error('Failed to create responsibility delegation:', error);
    return { success: false, error: normalizeDatabaseError(error.message) };
  }

  refreshResponsibilitySurfaces(owner.context.orgId);
  return { success: true };
}

export async function endResponsibilityDelegation(
  delegationId: string
): Promise<ActionResult> {
  const owner = await requireOwner();
  if (!owner.success) return owner;

  const { error } = await owner.context.admin.rpc(
    'end_responsibility_delegation',
    {
      p_delegation_id: delegationId,
      p_revoked_from: getBusinessTodayIso(),
      p_actor_id: owner.context.userId,
    }
  );
  if (error) {
    console.error('Failed to end responsibility delegation:', error);
    return { success: false, error: normalizeDatabaseError(error.message) };
  }

  refreshResponsibilitySurfaces(owner.context.orgId);
  return { success: true };
}


'use server';

import type { ActionResult } from '@/lib/action-result';
import { resolveActionContext } from '@/lib/org/action-context';
import {
  getOrganizationCodeValidationError,
  getOrganizationNameValidationError,
  normalizeOrganizationCode,
  normalizeOrganizationName,
  type OrganizationSettingsValues,
} from '@/lib/org/schemas';
import {
  isDuplicateName,
  organizationSettingsConflict,
  writeOrganizationSettings,
} from '@/lib/org/settings-checks';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';

export type UpdateOrganizationSettingsResult = ActionResult<
  { name: string; uniqueCode: string },
  | 'not_authenticated'
  | 'org_not_found'
  | 'not_authorized'
  | 'name_required'
  | 'name_too_short'
  | 'name_too_long'
  | 'name_taken'
  | 'code_required'
  | 'code_invalid'
  | 'code_taken'
  | 'no_changes'
  | 'update_failed'
>;

// The raw shape only; the named validators below return the stable error codes.
const settingsInputSchema = z.object({ name: z.string(), uniqueCode: z.string() });

export async function updateOrganizationSettings(
  input: OrganizationSettingsValues,
): Promise<UpdateOrganizationSettingsResult> {
  const parsedInput = settingsInputSchema.safeParse(input);
  const auth = await resolveActionContext();
  if (!auth.success) {
    return { success: false, error: auth.error === 'not_authenticated' ? auth.error : 'org_not_found' };
  }
  const { userId, orgId: activeOrgId } = auth.context;
  if (!parsedInput.success) {
    return { success: false, error: 'name_required' };
  }
  const { name, uniqueCode } = parsedInput.data;

  const nameValidationError = getOrganizationNameValidationError(name);
  if (nameValidationError) {
    return { success: false, error: nameValidationError };
  }

  const codeValidationError = getOrganizationCodeValidationError(uniqueCode);
  if (codeValidationError) {
    return { success: false, error: codeValidationError };
  }

  const normalizedName = normalizeOrganizationName(name);
  const normalizedCode = normalizeOrganizationCode(uniqueCode);
  const admin = createSupabaseAdminClient();
  const { data: organization, error: organizationError } = await admin
    .from('organizations')
    .select('id, name, unique_code, admin_id')
    .eq('id', activeOrgId)
    .single();

  if (organizationError || !organization) {
    return { success: false, error: 'org_not_found' };
  }

  if (organization.admin_id !== userId) {
    return { success: false, error: 'not_authorized' };
  }

  const nameUnchanged = isDuplicateName(organization.name, normalizedName);
  const codeUnchanged = organization.unique_code === normalizedCode;

  if (nameUnchanged && codeUnchanged) {
    return { success: false, error: 'no_changes' };
  }

  const change = { userId, organizationId: activeOrgId, normalizedName, normalizedCode };
  const conflict = await organizationSettingsConflict(admin, change);
  if (conflict) return conflict;

  return writeOrganizationSettings(admin, change);
}

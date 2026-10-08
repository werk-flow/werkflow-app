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
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging';
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

function isDuplicateName(existingName: string, nextName: string): boolean {
  return (
    normalizeOrganizationName(existingName).toLocaleLowerCase() ===
    normalizeOrganizationName(nextName).toLocaleLowerCase()
  );
}

function mapUniqueViolation(errorMessage: string): 'name_taken' | 'code_taken' | null {
  if (errorMessage.includes('organizations_unique_code_key') || errorMessage.includes('unique_code')) {
    return 'code_taken';
  }

  if (errorMessage.includes('organizations_admin_id_normalized_name_key')) {
    return 'name_taken';
  }

  return null;
}

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

  const { data: siblingOrganizations, error: siblingOrganizationsError } = await admin
    .from('organizations')
    .select('id, name')
    .eq('admin_id', userId)
    .neq('id', activeOrgId);

  if (siblingOrganizationsError) {
    logError('updateOrganizationSettings: duplicate name check failed', siblingOrganizationsError);
    return { success: false, error: 'update_failed' };
  }

  const hasDuplicateName = (siblingOrganizations ?? []).some((sibling) =>
    isDuplicateName(sibling.name, normalizedName),
  );

  if (hasDuplicateName) {
    return { success: false, error: 'name_taken' };
  }

  const { data: existingCode, error: existingCodeError } = await admin
    .from('organizations')
    .select('id')
    .eq('unique_code', normalizedCode)
    .neq('id', activeOrgId)
    .maybeSingle();

  if (existingCodeError) {
    logError('updateOrganizationSettings: code uniqueness check failed', existingCodeError);
    return { success: false, error: 'update_failed' };
  }

  if (existingCode) {
    return { success: false, error: 'code_taken' };
  }

  const { data: updatedOrganization, error: updateError } = await admin
    .from('organizations')
    .update({
      name: normalizedName,
      unique_code: normalizedCode,
      updated_at: new Date().toISOString(),
    })
    .eq('id', activeOrgId)
    .select('name, unique_code')
    .single();

  if (updateError || !updatedOrganization) {
    if (updateError?.code === '23505') {
      const mappedError = mapUniqueViolation(updateError.message);

      if (mappedError) {
        return { success: false, error: mappedError };
      }
    }

    logError('updateOrganizationSettings: organization write failed', updateError);
    return { success: false, error: 'update_failed' };
  }

  return {
    success: true,
    name: updatedOrganization.name,
    uniqueCode: updatedOrganization.unique_code,
  };
}

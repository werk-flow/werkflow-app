'use server';

import { cookies } from 'next/headers';
import { updateTag } from 'next/cache';

import { CACHE_TAGS, getAuthenticatedUser } from '@/lib/data/cached';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import {
  getOrganizationCodeValidationError,
  getOrganizationNameValidationError,
  normalizeOrganizationCode,
  normalizeOrganizationName,
  type OrganizationSettingsValues,
} from '@/lib/org/schemas';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export type UpdateOrganizationSettingsResult =
  | { success: true; name: string; uniqueCode: string }
  | {
      success: false;
      error:
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
        | 'update_failed';
    };

type MemberRow = {
  user_id: string;
};

function isDuplicateName(
  existingName: string,
  nextName: string
): boolean {
  return (
    normalizeOrganizationName(existingName).toLocaleLowerCase() ===
    normalizeOrganizationName(nextName).toLocaleLowerCase()
  );
}

function mapUniqueViolation(errorMessage: string): 'name_taken' | 'code_taken' | null {
  if (
    errorMessage.includes('organizations_unique_code_key') ||
    errorMessage.includes('unique_code')
  ) {
    return 'code_taken';
  }

  if (errorMessage.includes('organizations_admin_id_normalized_name_key')) {
    return 'name_taken';
  }

  return null;
}

export async function updateOrganizationSettings(
  input: OrganizationSettingsValues
): Promise<UpdateOrganizationSettingsResult> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  const nameValidationError = getOrganizationNameValidationError(input.name);
  if (nameValidationError) {
    return { success: false, error: nameValidationError };
  }

  const codeValidationError = getOrganizationCodeValidationError(input.uniqueCode);
  if (codeValidationError) {
    return { success: false, error: codeValidationError };
  }

  const normalizedName = normalizeOrganizationName(input.name);
  const normalizedCode = normalizeOrganizationCode(input.uniqueCode);
  const admin = createSupabaseAdminClient();
  const cookieStore = await cookies();
  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);

  if (!activeOrgId) {
    return { success: false, error: 'org_not_found' };
  }

  const { data: organization, error: organizationError } = await admin
    .from('organizations')
    .select('id, name, unique_code, admin_id')
    .eq('id', activeOrgId)
    .single();

  if (organizationError || !organization) {
    return { success: false, error: 'org_not_found' };
  }

  if (organization.admin_id !== user.id) {
    return { success: false, error: 'not_authorized' };
  }

  const nameUnchanged = isDuplicateName(organization.name, normalizedName);
  const codeUnchanged = organization.unique_code === normalizedCode;

  if (nameUnchanged && codeUnchanged) {
    return { success: false, error: 'no_changes' };
  }

  const { data: siblingOrganizations, error: siblingOrganizationsError } =
    await admin
      .from('organizations')
      .select('id, name')
      .eq('admin_id', user.id)
      .neq('id', activeOrgId);

  if (siblingOrganizationsError) {
    console.error(
      'Error checking sibling organizations for duplicate names:',
      siblingOrganizationsError
    );
    return { success: false, error: 'update_failed' };
  }

  const hasDuplicateName = (siblingOrganizations ?? []).some((sibling) =>
    isDuplicateName(sibling.name, normalizedName)
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
    console.error('Error checking organization code uniqueness:', existingCodeError);
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

    console.error('Error updating organization settings:', updateError);
    return { success: false, error: 'update_failed' };
  }

  const { data: members, error: membersError } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', activeOrgId);

  if (membersError) {
    console.error(
      'Error fetching organization members for cache invalidation:',
      membersError
    );
  }

  const memberIds = Array.from(
    new Set((members ?? []).map((member: MemberRow) => member.user_id))
  );

  for (const memberId of memberIds) {
    updateTag(CACHE_TAGS.memberships(memberId));
  }

  return {
    success: true,
    name: updatedOrganization.name,
    uniqueCode: updatedOrganization.unique_code,
  };
}

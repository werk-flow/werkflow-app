import 'server-only';

// The uniqueness checks and the write of updateOrganizationSettings
// (lib/org/settings-actions.ts). The action establishes the caller and checks
// that the caller is the organization's admin before it calls them; this
// module is not a 'use server' file, so its parameters never become public
// action arguments.

import type { ActionFailure } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { normalizeOrganizationName } from '@/lib/org/schemas';
import type { AdminClient } from '@/lib/supabase/admin';
import type { UpdateOrganizationSettingsResult } from './settings-actions';

type OrganizationSettingsChange = {
  userId: string;
  organizationId: string;
  normalizedName: string;
  normalizedCode: string;
};

export function isDuplicateName(existingName: string, nextName: string): boolean {
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

/**
 * The refusal when another organization of the same admin has the name, or
 * any other organization has the code; null when both are free.
 */
export async function organizationSettingsConflict(
  admin: AdminClient,
  change: OrganizationSettingsChange,
): Promise<ActionFailure<'name_taken' | 'code_taken' | 'update_failed'> | null> {
  const { data: siblingOrganizations, error: siblingOrganizationsError } = await admin
    .from('organizations')
    .select('id, name')
    .eq('admin_id', change.userId)
    .neq('id', change.organizationId);

  if (siblingOrganizationsError) {
    logError('updateOrganizationSettings: duplicate name check failed', siblingOrganizationsError);
    return { success: false, error: 'update_failed' };
  }

  const hasDuplicateName = (siblingOrganizations ?? []).some((sibling) =>
    isDuplicateName(sibling.name, change.normalizedName),
  );

  if (hasDuplicateName) {
    return { success: false, error: 'name_taken' };
  }

  const { data: existingCode, error: existingCodeError } = await admin
    .from('organizations')
    .select('id')
    .eq('unique_code', change.normalizedCode)
    .neq('id', change.organizationId)
    .maybeSingle();

  if (existingCodeError) {
    logError('updateOrganizationSettings: code uniqueness check failed', existingCodeError);
    return { success: false, error: 'update_failed' };
  }

  if (existingCode) {
    return { success: false, error: 'code_taken' };
  }
  return null;
}

/** Writes the new name and code; a unique violation that raced the checks maps to its field. */
export async function writeOrganizationSettings(
  admin: AdminClient,
  change: OrganizationSettingsChange,
): Promise<UpdateOrganizationSettingsResult> {
  const { data: updatedOrganization, error: updateError } = await admin
    .from('organizations')
    .update({
      name: change.normalizedName,
      unique_code: change.normalizedCode,
      updated_at: new Date().toISOString(),
    })
    .eq('id', change.organizationId)
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

'use server';

import { cookies } from 'next/headers';
import { z } from '@/lib/zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isUserSubscribed } from '@/lib/subscription/helpers';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import { generateUniqueOrgCode } from './generate-code';
import { CURRENT_ORG_COOKIE, CURRENT_ORG_MAX_AGE } from './cookies';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import { getOrganizationNameValidationError, normalizeOrganizationName } from '@/lib/org/schemas';
import { rpcArgs } from '@/lib/supabase/rpc-args';

/**
 * Sets the active organization cookie. `resolveActiveOrgId` re-checks
 * membership on every read, so this only refuses obviously wrong input early
 * and never stores a foreign organization for a stranger (SI-007).
 */
export async function setActiveOrgCookie(orgId: string): Promise<void> {
  const parsedOrgId = uuidSchema.safeParse(orgId);
  const user = await getAuthenticatedUser();
  if (!user) throw new Error('not_authenticated');
  if (!parsedOrgId.success) throw new Error('not_a_member');
  const memberships = await getCachedMemberships(user.id);
  if (!memberships.some((membership) => membership.orgId === parsedOrgId.data))
    throw new Error('not_a_member');

  const cookieStore = await cookies();
  cookieStore.set(CURRENT_ORG_COOKIE, parsedOrgId.data, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: CURRENT_ORG_MAX_AGE,
    path: '/',
  });
}

export type CreateOrganizationResult = {
  success: boolean;
  organizationId?: string;
  error?: string;
};

const organizationNameInputSchema = z.string();

/**
 * Creates a new organization and adds the current user as admin
 */
export async function createOrganization(name: string): Promise<CreateOrganizationResult> {
  const parsedName = organizationNameInputSchema.safeParse(name);
  if (!parsedName.success) {
    return { success: false, error: 'name_required' };
  }
  const normalizedName = normalizeOrganizationName(parsedName.data);
  const nameValidationError = getOrganizationNameValidationError(parsedName.data);

  if (nameValidationError) {
    return { success: false, error: nameValidationError };
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  // Verify subscription is active
  const subscribed = await isUserSubscribed(user.id);
  if (!subscribed) {
    return { success: false, error: 'subscription_required' };
  }

  // Use admin client for database operations (bypasses RLS)
  const admin = createSupabaseAdminClient();

  try {
    const { data: existingOrganizations, error: existingOrganizationsError } = await admin
      .from('organizations')
      .select('id, name')
      .eq('admin_id', user.id);

    if (existingOrganizationsError) {
      logError('createOrganization: duplicate name check failed', existingOrganizationsError);
      return { success: false, error: 'organization_creation_failed' };
    }

    const hasDuplicateName = (existingOrganizations ?? []).some(
      (organization) =>
        normalizeOrganizationName(organization.name).toLocaleLowerCase() ===
        normalizedName.toLocaleLowerCase(),
    );

    if (hasDuplicateName) {
      return { success: false, error: 'name_taken' };
    }

    const uniqueCode = await generateUniqueOrgCode();

    // One transaction: the organization, its settings with the first break
    // policy entry, and through the insert triggers the owner membership, the
    // owner's personnel record and the inventory defaults, or nothing.
    const { data: organizationId, error: createError } = await admin.rpc(
      'create_organization_with_defaults',
      rpcArgs('create_organization_with_defaults', {
        p_admin_id: user.id,
        p_name: normalizedName,
        p_unique_code: uniqueCode,
      }),
    );

    if (createError || !organizationId) {
      if (createError?.message.includes('name_taken')) {
        return { success: false, error: 'name_taken' };
      }
      logError('createOrganization: organization write failed', createError);
      if (createError?.message.includes('member_creation_failed')) {
        return { success: false, error: 'member_creation_failed' };
      }
      return { success: false, error: 'organization_creation_failed' };
    }

    // Set the org cookie to the new organization
    const cookieStore = await cookies();
    cookieStore.set(CURRENT_ORG_COOKIE, organizationId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: CURRENT_ORG_MAX_AGE,
      path: '/',
    });

    return { success: true, organizationId };
  } catch (error) {
    logError('createOrganization: unexpected failure', error);
    return { success: false, error: 'unexpected_error' };
  }
}

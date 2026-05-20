'use server';

import { cookies } from 'next/headers';
import { updateTag } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isUserSubscribed } from '@/lib/subscription/helpers';
import { generateUniqueOrgCode } from './generate-code';
import { CURRENT_ORG_COOKIE, CURRENT_ORG_MAX_AGE } from './cookies';
import { getAuthenticatedUser, CACHE_TAGS } from '@/lib/data/cached';
import {
  getOrganizationNameValidationError,
  normalizeOrganizationName,
} from '@/lib/org/schemas';
import { buildBreakPolicyHistoryEntry } from '@/lib/time-tracking/settings';

/**
 * Sets the active organization cookie
 */
export async function setActiveOrgCookie(orgId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(CURRENT_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: CURRENT_ORG_MAX_AGE,
    path: '/'
  });
}

/**
 * Reads the active organization ID from the httpOnly cookie.
 * Used by client-side self-hydration since document.cookie cannot
 * access httpOnly cookies.
 */
export async function getActiveOrgCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(CURRENT_ORG_COOKIE)?.value ?? null;
}

export type CreateOrganizationResult = {
  success: boolean;
  organizationId?: string;
  error?: string;
};

/**
 * Creates a new organization and adds the current user as admin
 */
export async function createOrganization(
  name: string
): Promise<CreateOrganizationResult> {
  const normalizedName = normalizeOrganizationName(name);
  const nameValidationError = getOrganizationNameValidationError(name);

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
    const { data: existingOrganizations, error: existingOrganizationsError } =
      await admin
        .from('organizations')
        .select('id, name')
        .eq('admin_id', user.id);

    if (existingOrganizationsError) {
      console.error(
        'Error checking existing organizations for duplicate names:',
        existingOrganizationsError
      );
      return { success: false, error: 'organization_creation_failed' };
    }

    const hasDuplicateName = (existingOrganizations ?? []).some(
      (organization) =>
        normalizeOrganizationName(organization.name).toLocaleLowerCase() ===
        normalizedName.toLocaleLowerCase()
    );

    if (hasDuplicateName) {
      return { success: false, error: 'name_taken' };
    }

    // Generate unique code
    const uniqueCode = await generateUniqueOrgCode();

    // Create organization using admin client (no INSERT policy for organizations)
    const { data: org, error: orgError } = await admin
      .from('organizations')
      .insert({
        name: normalizedName,
        admin_id: user.id,
        unique_code: uniqueCode
      })
      .select('id, created_at')
      .single();

    if (orgError) {
      if (
        orgError.code === '23505' &&
        orgError.message.includes('organizations_admin_id_normalized_name_key')
      ) {
        return { success: false, error: 'name_taken' };
      }

      console.error('Error creating organization:', orgError);
      return { success: false, error: 'organization_creation_failed' };
    }

    const { error: settingsError } = await admin
      .from('organization_settings')
      .insert({
        organization_id: org.id,
        break_mode: 'manual',
        auto_break_threshold_minutes: 360,
        auto_break_duration_minutes: 30,
        break_policy_history: [
          buildBreakPolicyHistoryEntry(
            {
              breakMode: 'manual',
              autoBreakThresholdMinutes: 360,
              autoBreakDurationMinutes: 30,
            },
            org.created_at
          ),
        ],
      });

    if (settingsError) {
      console.error('Error creating organization settings:', settingsError);
      await admin.from('organizations').delete().eq('id', org.id);
      return { success: false, error: 'organization_creation_failed' };
    }

    // Note: The database trigger 'add_admin_membership' automatically creates
    // the admin member when an organization is inserted. We verify it was created.
    const { data: member, error: memberError } = await admin
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', org.id)
      .single();

    if (memberError || !member) {
      console.error('Error verifying admin membership:', memberError);
      // Try to clean up the organization
      await admin.from('organizations').delete().eq('id', org.id);
      return { success: false, error: 'member_creation_failed' };
    }

    // Set the org cookie to the new organization
    const cookieStore = await cookies();
    cookieStore.set(CURRENT_ORG_COOKIE, org.id, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: CURRENT_ORG_MAX_AGE,
      path: '/'
    });

    updateTag(CACHE_TAGS.memberships(user.id));

    return { success: true, organizationId: org.id };
  } catch (error) {
    console.error('Unexpected error creating organization:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type JoinOrganizationResult = {
  success: boolean;
  organizationId?: string;
  error?: string;
};

/**
 * Joins an existing organization by unique code
 */
export async function joinOrganization(
  code: string
): Promise<JoinOrganizationResult> {
  // Validate input
  const trimmedCode = code.trim().toUpperCase();
  if (!trimmedCode) {
    return { success: false, error: 'code_required' };
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  const admin = createSupabaseAdminClient();

  try {
    // Find organization by unique code using admin client
    // (user might not be a member yet, so RLS would block this)
    const { data: org, error: orgError } = await admin
      .from('organizations')
      .select('id, admin_id, name')
      .eq('unique_code', trimmedCode)
      .single();

    if (orgError || !org) {
      return { success: false, error: 'invalid_code' };
    }

    // Check if user is already a member of this organization
    const { data: existingMembership } = await admin
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', org.id)
      .single();

    if (existingMembership) {
      return { success: false, error: 'already_member' };
    }

    // Get user's existing memberships to check admin_id compatibility
    const { data: existingMemberships, error: membershipsError } = await admin
      .from('organization_members')
      .select('organization_id, organizations(admin_id)')
      .eq('user_id', user.id);

    if (membershipsError) {
      console.error('Error fetching existing memberships:', membershipsError);
      return { success: false, error: 'unexpected_error' };
    }

    // If user has existing memberships, check admin_id compatibility
    if (existingMemberships && existingMemberships.length > 0) {
      // Get the admin_id from the first membership's organization
      const firstMembership = existingMemberships[0];
      const existingOrg = firstMembership.organizations as unknown as {
        admin_id: string;
      };
      const existingAdminId = existingOrg?.admin_id;

      if (existingAdminId && existingAdminId !== org.admin_id) {
        return { success: false, error: 'admin_mismatch' };
      }
    }

    // Insert membership with 'employee' role using admin client (no INSERT policy)
    const { error: insertError } = await admin
      .from('organization_members')
      .insert({
        user_id: user.id,
        organization_id: org.id,
        role: 'employee'
      });

    if (insertError) {
      console.error('Error inserting membership:', insertError);
      return { success: false, error: 'join_failed' };
    }

    // Set the org cookie to the newly joined organization
    const cookieStore = await cookies();
    cookieStore.set(CURRENT_ORG_COOKIE, org.id, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: CURRENT_ORG_MAX_AGE,
      path: '/'
    });

    updateTag(CACHE_TAGS.memberships(user.id));
    updateTag(CACHE_TAGS.memberCount(org.id));

    return { success: true, organizationId: org.id };
  } catch (error) {
    console.error('Unexpected error joining organization:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

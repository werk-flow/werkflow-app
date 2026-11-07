'use server';

import { cookies } from 'next/headers';
import { updateTag } from 'next/cache';
import type { ActionResult } from '@/lib/action-result';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { discardStorageObjects, listStorageObjectPaths } from '@/lib/storage/r2';
import { readOrganizationDeletionScope } from '@/lib/org/deletion-scope';
import { CURRENT_ORG_COOKIE, CURRENT_ORG_MAX_AGE } from '@/lib/org/cookies';
import { resolveActionContext } from '@/lib/org/action-context';
import { CACHE_TAGS } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';

/** A success names the organization to switch to, or null when none remains. */
export type DeleteOrgResult = ActionResult<{ nextOrgId: string | null }>;

const confirmationNameSchema = z.string();

const deleteRefusal = writeRefusalFor(
  new Set(['org_not_found', 'not_authorized', 'name_mismatch', 'has_time_records']),
);

/** Every stored file of the organization; null when the listing fails. */
async function listOrganizationFiles(organizationId: string): Promise<string[] | null> {
  try {
    return await listStorageObjectPaths({ organizationId, prefix: `${organizationId}/` });
  } catch (error) {
    logError('deleteOrganization: stored file listing failed', error);
    return null;
  }
}

/**
 * Removes the files of a deleted organization. No row references them any
 * more, so the folder is listed again: an upload finalized after the first
 * list goes too. A failed list or removal is logged and leaves orphaned
 * objects, never a second error for a finished deletion.
 */
async function discardOrganizationFiles(organizationId: string, listed: readonly string[]): Promise<void> {
  const late = (await listOrganizationFiles(organizationId)) ?? [];
  await discardStorageObjects({ organizationId, paths: [...new Set([...listed, ...late])] });
}

/**
 * Delete an organization and all its associated data.
 *
 * Rules:
 * - Only the admin can delete the organization
 * - The confirmation name must match the organization name exactly
 * - Recorded working time or a closed period refuses the deletion, here and
 *   again in delete_organization under its lock
 * - Storage is not transactional, so the database decides first: the action
 *   lists the organization's stored files, delete_organization deletes the
 *   organization row, and only then do the listed files go. A refusal leaves
 *   every file in place; a failed file removal after the row went is logged
 *   and leaves orphaned objects, the lesser failure
 * - The foreign key cascade removes the memberships, invites and all other
 *   organization data in the same statement as the organization row
 * - Users who lose their only org will be redirected to onboarding on next login
 */
export async function deleteOrganization(confirmationName: string): Promise<DeleteOrgResult> {
  const parsedConfirmation = confirmationNameSchema.safeParse(confirmationName);
  try {
    const auth = await resolveActionContext();
    if (!auth.success) {
      return { success: false, error: auth.error === 'not_authenticated' ? auth.error : 'org_not_found' };
    }
    const { userId, orgId: activeOrgId } = auth.context;

    const admin = createSupabaseAdminClient();
    const cookieStore = await cookies();

    const { data: org, error: orgError } = await admin
      .from('organizations')
      .select('id, name, admin_id')
      .eq('id', activeOrgId)
      .single();

    if (orgError || !org) {
      return { success: false, error: 'org_not_found' };
    }

    // Only admin can delete the organization
    if (org.admin_id !== userId) {
      return { success: false, error: 'not_authorized' };
    }

    // Verify the confirmation name matches exactly
    if (!parsedConfirmation.success || parsedConfirmation.data.trim() !== org.name) {
      return { success: false, error: 'name_mismatch' };
    }

    // The database repeats this check under its lock.
    const scope = await readOrganizationDeletionScope(activeOrgId);
    if (!scope.success) return scope;
    if (scope.scope.retainsTimeRecords) return { success: false, error: 'has_time_records' };

    // Listed while the rows still name the organization: without the list,
    // the deletion would knowingly leave every file behind.
    const paths = await listOrganizationFiles(activeOrgId);
    if (!paths) return { success: false, error: 'delete_org_failed' };

    // One statement: the cascade removes the memberships, invites and every
    // other organization row with it, or nothing. Deleting the memberships
    // first was refused by the owner-membership guard.
    const { error: orgDeleteError } = await admin.rpc('delete_organization', {
      p_organization_id: activeOrgId,
      p_actor_id: userId,
      p_confirmation_name: parsedConfirmation.data.trim(),
    });
    if (orgDeleteError) {
      return deleteRefusal(
        orgDeleteError,
        'delete_org_failed',
        'deleteOrganization: organization delete failed',
      );
    }

    await discardOrganizationFiles(activeOrgId, paths);

    // Get the user's remaining organizations using admin client
    // (to bypass RLS - the org we just deleted might affect RLS queries)
    const { data: remainingMemberships, error: remainingError } = await admin
      // tenant-scope: cross-organization-by-design — the signed-in user's remaining memberships pick the next active organization
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId);

    if (remainingError) {
      logError('deleteOrganization: remaining memberships read failed', remainingError);
    }

    const remainingOrgs = remainingMemberships ?? [];
    const nextOrgId = remainingOrgs[0]?.organization_id ?? null;

    // Update the org cookie with proper options (matching other actions)
    if (nextOrgId) {
      // Set to the next available org
      cookieStore.set(CURRENT_ORG_COOKIE, nextOrgId, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: CURRENT_ORG_MAX_AGE,
        path: '/',
      });
    } else {
      // Clear the cookie if no orgs remain
      cookieStore.set(CURRENT_ORG_COOKIE, '', {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      });
    }

    updateTag(CACHE_TAGS.memberCount(activeOrgId));

    return { success: true, nextOrgId };
  } catch (error) {
    logError('deleteOrganization: unexpected failure', error);
    return { success: false, error: 'unexpected_error' };
  }
}

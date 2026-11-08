'use server';

import { cookies } from 'next/headers';
import { updateTag } from 'next/cache';
import type { ActionResult } from '@/lib/action-result';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { listStorageObjectPaths } from '@/lib/storage/r2';
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
  new Set(['org_not_found', 'not_authorized', 'name_mismatch', 'has_time_records', 'has_retained_documents']),
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
 * Queues each object that reached the prefix after the first listing, such as
 * a signed upload that landed during the deletion; no row names it. The
 * organization is already gone, so a failure is logged and the deletion stands.
 */
async function queueLateFiles(
  admin: AdminClient,
  organizationId: string,
  listed: readonly string[],
): Promise<void> {
  const paths = await listOrganizationFiles(organizationId);
  if (!paths) return;
  const known = new Set(listed);
  const late = paths.filter((path) => !known.has(path));
  if (late.length === 0) return;
  const { error } = await admin.rpc('queue_storage_purge', {
    p_organization_id: organizationId,
    p_paths: late,
  });
  if (error) logError('deleteOrganization: late file queueing failed', error);
}

/**
 * True only when a read confirms the organization row is gone. A failed call
 * can still have committed, when only its response was lost: then the
 * deletion finished and its files are queued.
 */
async function organizationIsGone(admin: AdminClient, organizationId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('organizations')
    .select('id')
    .eq('id', organizationId)
    .maybeSingle();
  return !error && !data;
}

/**
 * Delete an organization and all its associated data.
 *
 * Rules:
 * - Only the admin can delete the organization
 * - The confirmation name must match the organization name exactly
 * - Recorded working time, a closed period or a document inside its
 *   retention period refuses the deletion, here and again in
 *   delete_organization under its lock
 * - Storage is not transactional, so no file goes at once: the action lists
 *   the organization's stored files, and delete_organization_with_files
 *   deletes the organization row and queues the listed files and every file a
 *   row names, in one transaction. The scheduled purge deletes them after
 *   the backup window. A refusal queues no file
 * - After the deletion the action lists the prefix again and queues each
 *   object that landed after the first listing
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
    const [refusal] = scope.scope.retentionRefusals;
    if (refusal) return { success: false, error: refusal };

    // Listed while the organization still exists: without the list, the
    // deletion would knowingly leave every object without a row behind.
    const paths = await listOrganizationFiles(activeOrgId);
    if (!paths) return { success: false, error: 'delete_org_failed' };

    // One transaction: the cascade removes the memberships, invites and every
    // other organization row, and the files are queued, or nothing happens.
    // Deleting the memberships first was refused by the owner-membership guard.
    const { error: orgDeleteError } = await admin.rpc('delete_organization_with_files', {
      p_organization_id: activeOrgId,
      p_actor_id: userId,
      p_confirmation_name: parsedConfirmation.data.trim(),
      p_storage_paths: paths,
    });
    if (orgDeleteError && !(await organizationIsGone(admin, activeOrgId))) {
      return deleteRefusal(
        orgDeleteError,
        'delete_org_failed',
        'deleteOrganization: organization delete failed',
      );
    }
    await queueLateFiles(admin, activeOrgId, paths);

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

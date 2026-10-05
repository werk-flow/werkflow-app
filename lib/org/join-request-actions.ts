'use server';

// Joining an organization by its code (owner decision 2026-10-02): the code
// creates a join request, and an Admin or Büro user of that organization
// approves or declines it. Only the approval creates the membership, through
// the database function `approve_organization_join_request`. Invite links
// stay immediate (app/api/redeem-invite, app/auth/callback).

import { updateTag } from 'next/cache';
import { z } from '@/lib/zod';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { CACHE_TAGS, getAuthenticatedUser } from '@/lib/data/cached';
import { isJsonRecord } from '@/lib/supabase/json';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { normalizeOrganizationCode } from '@/lib/org/schemas';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import type { OwnJoinRequest } from './types';

// A signed-in user may guess this many wrong organization codes per hour.
const JOIN_FAILURE_LIMIT = 10;
const JOIN_FAILURE_WINDOW_MS = 60 * 60 * 1000;
// Generated codes have six characters; older hand-made codes are longer. A
// longer input cannot be a code and is refused without a lookup.
const MAX_CODE_LENGTH = 32;

const joinCodeSchema = z.string().transform(normalizeOrganizationCode);

type RequestJoinFailureCode =
  | 'code_required'
  | 'invalid_code'
  | 'too_many_attempts'
  | 'already_member'
  | 'admin_mismatch'
  | 'not_authenticated'
  | 'unexpected_error';

export type RequestOrganizationJoinResult =
  | { success: true; request: OwnJoinRequest }
  | ActionFailure<RequestJoinFailureCode>
  | (ActionFailure<'request_pending'> & { request: OwnJoinRequest });

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** The caller's open request with its organization name, or null when none is open. */
async function readOpenRequest(
  admin: AdminClient,
  userId: string,
): Promise<{ request: OwnJoinRequest | null; failed: boolean }> {
  const { data: row, error } = await admin
    // tenant-scope: own-user-row — the caller's own open request, whichever organization it names
    .from('organization_join_requests')
    .select('id, organization_id, organizations(name)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) {
    logError('readOpenRequest: request read failed', error);
    return { request: null, failed: true };
  }
  if (!row) return { request: null, failed: false };
  const organization: unknown = row.organizations;
  const organizationName =
    isJsonRecord(organization) && typeof organization.name === 'string' ? organization.name : '';
  return {
    request: { id: row.id, organizationId: row.organization_id, organizationName, status: 'pending' },
    failed: false,
  };
}

/** Counts this hour's failed code guesses; null when the limit cannot be read. */
async function countRecentFailures(admin: AdminClient, userId: string): Promise<number | null> {
  const windowStart = new Date(Date.now() - JOIN_FAILURE_WINDOW_MS).toISOString();
  const { error: pruneError } = await admin
    .from('organization_join_attempts')
    .delete()
    .eq('user_id', userId)
    .lt('attempted_at', windowStart);
  const { count, error: countError } = await admin
    .from('organization_join_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('attempted_at', windowStart);
  if (pruneError || countError || count === null) {
    logError('countRecentFailures: join attempt read failed', pruneError ?? countError);
    return null;
  }
  return count;
}

/**
 * Asks to join the organization that owns `code`. Wrong codes count against
 * the caller's hourly limit; a limit that cannot be read refuses the attempt.
 * A caller with an open request gets that request back instead of a second one.
 */
export async function requestOrganizationJoin(code: string): Promise<RequestOrganizationJoinResult> {
  const parsedCode = joinCodeSchema.safeParse(code);
  if (!parsedCode.success || !parsedCode.data) return { success: false, error: 'code_required' };

  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };

  try {
    const admin = createSupabaseAdminClient();
    const recentFailures = await countRecentFailures(admin, user.id);
    if (recentFailures === null) return { success: false, error: 'unexpected_error' };
    if (recentFailures >= JOIN_FAILURE_LIMIT) return { success: false, error: 'too_many_attempts' };

    const { data: organization, error: organizationError } =
      parsedCode.data.length > MAX_CODE_LENGTH
        ? { data: null, error: null }
        : await admin
            .from('organizations')
            .select('id, admin_id, name')
            .eq('unique_code', parsedCode.data)
            .maybeSingle();
    if (organizationError) {
      logError('requestOrganizationJoin: code lookup failed', organizationError);
      return { success: false, error: 'unexpected_error' };
    }
    if (!organization) {
      const { error: attemptError } = await admin
        .from('organization_join_attempts')
        .insert({ user_id: user.id });
      if (attemptError) {
        logError('requestOrganizationJoin: join attempt write failed', attemptError);
        return { success: false, error: 'unexpected_error' };
      }
      return { success: false, error: 'invalid_code' };
    }

    const { data: memberships, error: membershipError } = await admin
      // tenant-scope: cross-organization-by-design — the caller's own memberships decide whether this organization fits
      .from('organization_members')
      .select('organization_id, organizations(admin_id)')
      .eq('user_id', user.id);
    if (membershipError) {
      logError('requestOrganizationJoin: membership read failed', membershipError);
      return { success: false, error: 'unexpected_error' };
    }
    if (memberships.some((membership) => membership.organization_id === organization.id)) {
      return { success: false, error: 'already_member' };
    }
    // All organizations of one person belong to the same owner.
    const otherOwner: unknown = memberships[0]?.organizations;
    if (isJsonRecord(otherOwner) && otherOwner.admin_id !== organization.admin_id) {
      return { success: false, error: 'admin_mismatch' };
    }

    const open = await readOpenRequest(admin, user.id);
    if (open.failed) return { success: false, error: 'unexpected_error' };
    if (open.request) return { success: false, error: 'request_pending', request: open.request };

    const { data: created, error: insertError } = await admin
      .from('organization_join_requests')
      .insert({ organization_id: organization.id, user_id: user.id })
      .select('id')
      .single();
    if (insertError) {
      // A parallel submit created the open request first (one open request per person).
      const raced = insertError.code === '23505' ? await readOpenRequest(admin, user.id) : null;
      if (raced?.request) return { success: false, error: 'request_pending', request: raced.request };
      logError('requestOrganizationJoin: request write failed', insertError);
      return { success: false, error: 'unexpected_error' };
    }

    return {
      success: true,
      request: {
        id: created.id,
        organizationId: organization.id,
        organizationName: organization.name,
        status: 'pending',
      },
    };
  } catch (error) {
    logError('requestOrganizationJoin: unexpected failure', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** The requester takes back their own open request. */
export async function withdrawOrganizationJoinRequest(requestId: string): Promise<ActionResult> {
  const parsedId = uuidSchema.safeParse(requestId);
  if (!parsedId.success) return { success: false, error: 'invalid_input' };

  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };

  const { data: rows, error } = await createSupabaseAdminClient()
    // tenant-scope: own-user-row — only the requester's own open request can be withdrawn
    .from('organization_join_requests')
    .update({ status: 'withdrawn', decided_at: new Date().toISOString() })
    .eq('id', parsedId.data)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .select('id');
  if (error) {
    logError('withdrawOrganizationJoinRequest: request write failed', error);
    return { success: false, error: 'unexpected_error' };
  }
  return rows.length > 0 ? { success: true } : { success: false, error: 'request_not_pending' };
}

/** Admin and Büro decide the requests of their active organization; the server resolves both. */
async function resolveApprover(): Promise<{ success: true; orgId: string; userId: string } | ActionFailure> {
  const auth = await resolveActionContext();
  if (!auth.success) return auth;
  if (auth.context.role !== 'admin' && auth.context.role !== 'buero') {
    return { success: false, error: 'not_authorized' };
  }
  return { success: true, orgId: auth.context.orgId, userId: auth.context.userId };
}

// The refusals the approval function raises, as stable error codes. A request
// that is gone or no longer open reads the same to the approver.
const APPROVAL_REFUSALS: Readonly<Record<string, string>> = {
  join_request_not_found: 'request_not_pending',
  join_request_not_pending: 'request_not_pending',
  admin_mismatch: 'admin_mismatch',
  not_authorized: 'not_authorized',
};

/** Approves an open request: the requester becomes an employee of the active organization. */
export async function approveOrganizationJoinRequest(requestId: string): Promise<ActionResult> {
  const parsedId = uuidSchema.safeParse(requestId);
  if (!parsedId.success) return { success: false, error: 'invalid_input' };
  const approver = await resolveApprover();
  if (!approver.success) return approver;

  const { error } = await createSupabaseAdminClient().rpc('approve_organization_join_request', {
    p_request_id: parsedId.data,
    p_organization_id: approver.orgId,
    p_approver_id: approver.userId,
  });
  if (error) {
    const refusal = Object.hasOwn(APPROVAL_REFUSALS, error.message)
      ? APPROVAL_REFUSALS[error.message]
      : undefined;
    if (refusal) return { success: false, error: refusal };
    logError('approveOrganizationJoinRequest: approval failed', error);
    return { success: false, error: 'unexpected_error' };
  }

  updateTag(CACHE_TAGS.memberCount(approver.orgId));
  return { success: true };
}

/** Declines an open request of the active organization; the requester may enter another code. */
export async function declineOrganizationJoinRequest(requestId: string): Promise<ActionResult> {
  const parsedId = uuidSchema.safeParse(requestId);
  if (!parsedId.success) return { success: false, error: 'invalid_input' };
  const approver = await resolveApprover();
  if (!approver.success) return approver;

  const { data: rows, error } = await createSupabaseAdminClient()
    .from('organization_join_requests')
    .update({ status: 'declined', decided_at: new Date().toISOString(), decided_by: approver.userId })
    .eq('id', parsedId.data)
    .eq('organization_id', approver.orgId)
    .eq('status', 'pending')
    .select('id');
  if (error) {
    logError('declineOrganizationJoinRequest: request write failed', error);
    return { success: false, error: 'unexpected_error' };
  }
  return rows.length > 0 ? { success: true } : { success: false, error: 'request_not_pending' };
}

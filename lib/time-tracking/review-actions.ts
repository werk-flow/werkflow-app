'use server';
import type { ActionFailure } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { readInBatches } from '@/lib/supabase/query-batches';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import {
  calendarEntryIdListSchema,
  optionalOrganizationIdSchema,
  reviewChangeRequestInputSchema,
  reviewEntriesInputSchema,
} from './action-schemas';
import type { OrgRole } from '@/lib/roles';
import {
  type ReviewEntryResult,
  type GetPendingSessionsResult,
  type ChangeRequest,
  type ReviewChangeRequestResult,
  type GetChangeRequestsResult,
  toChangeRequest,
} from './types';
import { canViewChangeRequest } from './change-request-visibility';
import { readPendingChangeRequestData } from './change-request-reader';
import { readPendingChangeRequestQueue, readPendingSessionQueue } from './approval-queue';
import {
  entriesTouchClosedTimePeriod,
  timeEntryBatchFailure,
  timeWriteFailure,
  touchesClosedTimePeriod,
} from './closed-periods';
import { isUuid } from '@/lib/validation/uuid';
import {
  authorizeResponsibilityForTarget,
  getEffectiveResponsibilityHolderForActor,
  loadResponsibilityRuntimeState,
} from '@/lib/responsibilities/server';
import { getCurrentOrgId, verifyCurrentMembership } from './action-access';

// The approval Server Actions: the pending queues, the review of pending
// entries and the decision on a change request.

// ============================================
// Review Actions
// ============================================

const REVIEW_BATCH_LIMIT = 1000;

/**
 * Approve or reject pending entries in one round trip: one session, one
 * calendar day or the whole approval backlog. Every entry must be pending and
 * belong to one organization the caller is a member of; the time_approval
 * responsibility is resolved once per target person at action time, so a
 * stale view never preserves authority. The database function applies the
 * decision to every entry or to none. Rejected entries stay in history with
 * status 'rejected'.
 */
export async function reviewEntries(
  entryIds: string[],
  decision: 'approved' | 'rejected',
): Promise<ReviewEntryResult> {
  try {
    const parsed = reviewEntriesInputSchema.safeParse({ entryIds, decision });
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }
    const ids = [...new Set(parsed.data.entryIds)];
    if (ids.length === 0 || ids.length > REVIEW_BATCH_LIMIT) {
      return { success: false, error: 'invalid_input' };
    }

    const admin = createSupabaseAdminClient();
    const { data: entries, error: entriesError } = await readInBatches(ids, (batch) =>
      // tenant-scope: by-id-then-verified — every entry must share one organization, whose membership and time_approval responsibility are verified before the write.
      admin
        .from('time_entries')
        .select('id, organization_id, user_id, status, timestamp')
        .in('id', [...batch]),
    );
    if (entriesError) {
      logReadFailure('reviewEntries: entries failed', entriesError);
      return { success: false, error: 'fetch_failed' };
    }
    if (entries.length !== ids.length) return { success: false, error: 'entry_not_found' };
    if (entries.some((entry) => entry.status !== 'pending')) {
      return { success: false, error: 'entry_not_pending' };
    }
    const organizationId = entries[0]?.organization_id;
    if (!organizationId || entries.some((entry) => entry.organization_id !== organizationId)) {
      return { success: false, error: 'invalid_input' };
    }

    const callerRole = await verifyCurrentMembership(organizationId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    const targetUserIds = [...new Set(entries.map((entry) => entry.user_id))];
    const { data: targetMembers, error: targetMembersError } = await readInBatches(targetUserIds, (batch) =>
      admin
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', organizationId)
        .in('user_id', [...batch]),
    );
    if (targetMembersError) {
      logReadFailure('reviewEntries: target memberships failed', targetMembersError);
      return { success: false, error: 'fetch_failed' };
    }
    const roleByUser = new Map(targetMembers.map((member) => [member.user_id, member.role as OrgRole]));
    // Resolve current stored responsibility at action time. A stale UI can
    // never preserve authority after a delegation expires.
    const authorizations = await Promise.all(
      targetUserIds.map(async (targetUserId) => {
        const targetRole = roleByUser.get(targetUserId);
        if (!targetRole) return { success: false as const, error: 'target_not_found' };
        return authorizeResponsibilityForTarget({
          organizationId,
          responsibility: 'time_approval',
          actorUserId: user.id,
          targetUserId,
          targetRole,
        });
      }),
    );
    const refusal = authorizations.find((authorization) => !authorization.success);
    if (refusal && !refusal.success) {
      return { success: false, error: refusal.error };
    }
    // An entry of a closed month keeps its review state until a reopen.
    if (
      await touchesClosedTimePeriod(
        admin,
        organizationId,
        entries.map((entry) => entry.timestamp),
      )
    ) {
      return { success: false, error: 'period_closed' };
    }

    // One transaction: the function re-checks every entry under lock and reviews all or none.
    const { data: reviewed, error: reviewError } = await admin.rpc(
      'review_time_entries',
      rpcArgs('review_time_entries', {
        p_actor_id: user.id,
        p_organization_id: organizationId,
        p_entry_ids: ids,
        p_decision: parsed.data.decision,
        p_authorized_user_ids: targetUserIds,
      }),
    );
    if (reviewError) return timeEntryBatchFailure('Error reviewing entries:', reviewError, 'update_failed');
    return { success: true, reviewed };
  } catch (error) {
    logError('Unexpected error in reviewEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// The attention counts (lib/attention/actions.ts) are the one counting pipeline behind
// every badge; they derive the time share from getPendingSessions/getPendingChangeRequests.

/**
 * Get pending sessions (entries grouped as pairs with user profile info)
 */
export async function getPendingSessions(organizationId?: string): Promise<GetPendingSessionsResult> {
  try {
    const parsed = optionalOrganizationIdSchema.safeParse(organizationId);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = parsed.data ?? (await getCurrentOrgId(user.id));
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const callerRole = await verifyCurrentMembership(orgId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    // The holder lookup answers null for "not responsible" and for a failed
    // read alike; a failed read must not look like an empty queue.
    if (!(await loadResponsibilityRuntimeState(orgId))) {
      return { success: false, error: 'responsibility_load_failed' };
    }
    const responsibilityHolder = await getEffectiveResponsibilityHolderForActor({
      organizationId: orgId,
      responsibility: 'time_approval',
      actorUserId: user.id,
    });
    if (!responsibilityHolder) {
      return { success: true, sessions: [] };
    }

    return await readPendingSessionQueue({
      admin: createSupabaseAdminClient(),
      organizationId: orgId,
      holder: responsibilityHolder,
    });
  } catch (error) {
    logError('Unexpected error in getPendingSessions:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Change Request Actions
// ============================================

/**
 * Get pending change requests for the organization (admin only)
 */
export async function getPendingChangeRequests(organizationId?: string): Promise<GetChangeRequestsResult> {
  try {
    const parsed = optionalOrganizationIdSchema.safeParse(organizationId);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = parsed.data ?? (await getCurrentOrgId(user.id));
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const callerRole = await verifyCurrentMembership(orgId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    if (callerRole !== 'admin') {
      return { success: false, error: 'not_authorized' };
    }

    return await readPendingChangeRequestQueue({ admin: createSupabaseAdminClient(), organizationId: orgId });
  } catch (error) {
    logError('Unexpected error in getPendingChangeRequests:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** The refusals of decide_entry_change_request (migration 20261004180400): each message is an action failure code. */
const CHANGE_REQUEST_DECISION_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_input',
  'request_not_found',
  'not_a_member',
  'not_authorized',
  'request_already_reviewed',
]);

/**
 * Review a change request (edit or delete) from a manager.
 *
 * IMMEDIATE EFFECT MODEL:
 * - Edits are applied immediately when requested, original_timestamp stores the pre-edit value
 * - Deletes mark entries as 'pending_delete' immediately
 *
 * On approval:
 * - Edit: Nothing to do, the edit is already applied
 * - Delete: Actually delete the entries (they're currently marked pending_delete)
 *
 * On rejection:
 * - Edit: Revert timestamp to original_timestamp
 * - Delete: Restore entries to 'approved' status
 */
export async function reviewChangeRequest(
  rawRequestId: string,
  rawAction: 'approve' | 'reject',
): Promise<ReviewChangeRequestResult> {
  try {
    const parsed = reviewChangeRequestInputSchema.safeParse({ requestId: rawRequestId, action: rawAction });
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const { requestId, action } = parsed.data;
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    // tenant-scope: by-id-then-verified — the caller must be an admin of the request's organization, and the decision function is scoped to that organization.
    const { data: request, error: requestError } = await admin
      .from('entry_change_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();

    if (requestError) {
      logReadFailure('reviewChangeRequest: request read failed', requestError);
      return { success: false, error: 'fetch_failed' };
    }
    if (!request) {
      return { success: false, error: 'request_not_found' };
    }

    const callerRole = await verifyCurrentMembership(request.organization_id);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    if (callerRole !== 'admin') {
      return { success: false, error: 'not_authorized' };
    }

    // Check request is still pending
    if (request.status !== 'pending') {
      return { success: false, error: 'request_already_reviewed' };
    }

    // Every decision except approving an already applied edit writes the entries.
    const writesEntries = action === 'reject' || request.change_type === 'delete';
    if (
      writesEntries &&
      (await entriesTouchClosedTimePeriod(
        admin,
        request.organization_id,
        [request.entry_id, request.paired_entry_id],
        [request.original_timestamp],
      ))
    ) {
      return { success: false, error: 'period_closed' };
    }

    // One transaction: the function re-checks the request and the caller's
    // role under lock, records the decision and applies it to the entries, or
    // changes nothing.
    const { data: updatedRequest, error: decisionError } = await admin.rpc(
      'decide_entry_change_request',
      rpcArgs('decide_entry_change_request', {
        p_actor_id: user.id,
        p_organization_id: request.organization_id,
        p_request_id: requestId,
        p_decision: action,
      }),
    );
    if (decisionError) {
      if (CHANGE_REQUEST_DECISION_REFUSALS.has(decisionError.message)) {
        return { success: false, error: decisionError.message };
      }
      return {
        success: false,
        error: timeWriteFailure(
          'reviewChangeRequest: decide_entry_change_request failed',
          decisionError,
          'update_failed',
        ),
      };
    }

    return { success: true, request: toChangeRequest(updatedRequest) };
  } catch (error) {
    logError('Unexpected error in reviewChangeRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Calendar Visualization Helpers
// ============================================

/**
 * Get pending change requests for a list of entry IDs
 * Used for calendar visualization to show edit/delete diffs
 */
export async function getChangeRequestsForEntries(
  entryIds: string[],
): Promise<{ success: true; requests: ChangeRequest[] } | ActionFailure> {
  const parsed = calendarEntryIdListSchema.safeParse(entryIds);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const persistedEntryIds = [...new Set(parsed.data)].filter(isUuid);
  if (persistedEntryIds.length === 0) {
    return { success: true, requests: [] };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    // Caller-supplied entry IDs are a filter, not an authorization: only
    // organizations the caller belongs to are queried, and employees see only
    // requests they raised or that concern their own entries (SI-002).
    const memberships = await getCachedMemberships(user.id);
    if (memberships.length === 0) {
      return { success: true, requests: [] };
    }
    const roleByOrganization = new Map(
      memberships.map((membership) => [membership.orgId, membership.role as OrgRole]),
    );

    const admin = createSupabaseAdminClient();

    const { requests, entryOwnerById, error } = await readPendingChangeRequestData(admin, persistedEntryIds, [
      ...roleByOrganization.keys(),
    ]);
    if (error) {
      logError('Error fetching change requests for entries');
      return { success: false, error: 'fetch_failed' };
    }

    const visible = requests.filter((request) =>
      canViewChangeRequest(
        {
          organizationId: request.organization_id,
          requestedBy: request.requested_by,
          entryUserId: entryOwnerById.get(request.entry_id) ?? null,
        },
        { userId: user.id, roleByOrganization },
      ),
    );

    return {
      success: true,
      requests: visible.map(toChangeRequest),
    };
  } catch (error) {
    logError('Unexpected error in getChangeRequestsForEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

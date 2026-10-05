import 'server-only';

// Server readers for join requests. The callers establish identity and, for
// the organization list, the Admin or Büro role before they call: the
// requester reads their own requests, approvers the open requests of their
// active organization.

import type { ActionFailure } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { formatProfileName } from '@/lib/members/profile-name';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { joinRequestStatusSchema } from './schemas';
import type { OwnJoinRequest, PendingJoinRequest } from './types';

/** The signed-in user's newest join request, or null when they never asked to join. */
export async function readOwnLatestJoinRequest(
  userId: string,
): Promise<{ success: true; request: OwnJoinRequest | null } | ActionFailure<'load_failed'>> {
  const admin = createSupabaseAdminClient();
  const { data: row, error } = await admin
    // tenant-scope: own-user-row — the signed-in user's own requests, whichever organization they name
    .from('organization_join_requests')
    .select('id, organization_id, status')
    .eq('user_id', userId)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logError('readOwnLatestJoinRequest: request read failed', error);
    return { success: false, error: 'load_failed' };
  }
  if (!row) return { success: true, request: null };

  const status = joinRequestStatusSchema.safeParse(row.status);
  const { data: organization, error: organizationError } = await admin
    .from('organizations')
    .select('name')
    .eq('id', row.organization_id)
    .maybeSingle();
  if (!status.success || organizationError || !organization) {
    logError('readOwnLatestJoinRequest: request facts unreadable', organizationError);
    return { success: false, error: 'load_failed' };
  }
  return {
    success: true,
    request: {
      id: row.id,
      organizationId: row.organization_id,
      organizationName: organization.name,
      status: status.data,
    },
  };
}

/** The open join requests of one organization, oldest first, with the requester's name and e-mail. */
export async function readPendingJoinRequests(
  organizationId: string,
): Promise<{ success: true; requests: PendingJoinRequest[] } | ActionFailure<'load_failed'>> {
  const admin = createSupabaseAdminClient();
  const { data: rows, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('organization_join_requests')
        .select('id, user_id, requested_at')
        .eq('organization_id', organizationId)
        .eq('status', 'pending')
        .order('requested_at', { ascending: true })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logError('readPendingJoinRequests: request read failed', error);
    return { success: false, error: 'load_failed' };
  }

  const { data: profiles, error: profileError } = await readInBatches(
    rows.map((row) => row.user_id),
    (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', [...batch]),
  );
  if (profileError) {
    logError('readPendingJoinRequests: profile read failed', profileError);
    return { success: false, error: 'load_failed' };
  }
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  return {
    success: true,
    requests: rows.map((row) => {
      const profile = profileById.get(row.user_id);
      return {
        id: row.id,
        name: profile ? formatProfileName(profile) : 'Unbekannt',
        email: profile?.email ?? null,
        requestedAt: row.requested_at,
      };
    }),
  };
}

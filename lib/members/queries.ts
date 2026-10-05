import 'server-only';

// Internal member reads for server pages and actions that have already
// established the caller's identity. This module is deliberately not a
// 'use server' file: exporting these helpers as Server Actions made the
// caller-supplied user ID a public parameter (SI-014).

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { OrgMemberInfo } from './actions';
import { logError } from '@/lib/logging';

export type OrgMembersRead = ActionResult<{ members: OrgMemberInfo[] }, 'load_failed'>;

/**
 * Members of one organization as seen by `userId`. The security-definer RPC
 * raises `not_authorized` unless `userId` is a member, so callers must pass
 * the verified session user, never an ID from the request. A failed read is
 * `load_failed`, never an empty member list.
 */
export async function getOrgMembersForUser(organizationId: string, userId: string): Promise<OrgMembersRead> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('get_org_members_for_user', {
    p_org_id: organizationId,
    p_user_id: userId,
  });

  if (error) {
    logError('Error fetching organization members:', error);
    return { success: false, error: 'load_failed' };
  }

  return { success: true, members: (data ?? []) as OrgMemberInfo[] };
}

type ProfileNameMap = Record<string, { firstName: string | null; lastName: string | null }>;

/**
 * Display names for user IDs the caller may see: current co-members of any of
 * the caller's organizations, plus people whose personnel record belongs to
 * one of those organizations (an exited member stays visible in the personnel
 * list). IDs outside that set are silently absent from the result (SI-015).
 */
export type ProfileNamesRead = ActionResult<{ profiles: ProfileNameMap }, 'load_failed'>;

export async function getProfileNamesVisibleTo(
  callerUserId: string,
  userIds: readonly string[],
): Promise<ProfileNamesRead> {
  const requested = [...new Set(userIds)].filter(Boolean);
  if (requested.length === 0) return { success: true, profiles: {} };

  // The caller-scoped RLS policy evaluates effective P1-24 access now. Do not
  // authorize this fresh read from cached memberships after an out-of-band revoke.
  const callerClient = await createSupabaseServerClient();
  const { data: callerMemberships, error: membershipError } = await callerClient
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', callerUserId);
  if (membershipError) {
    logReadFailure('getProfileNamesVisibleTo: caller memberships failed', membershipError);
    return { success: false, error: 'load_failed' };
  }
  // A caller without a membership sees no names: that is the visibility rule, not a failure.
  if (callerMemberships.length === 0) return { success: true, profiles: {} };

  const admin = createSupabaseAdminClient();
  const organizationIds = callerMemberships.map((membership) => membership.organization_id);
  const [coMembersResult, personnelResult] = await Promise.all([
    readInBatches(requested, (batch) =>
      admin
        .from('organization_members')
        .select('user_id')
        .in('organization_id', organizationIds)
        .in('user_id', [...batch]),
    ),
    readInBatches(requested, (batch) =>
      admin
        .from('employee_records')
        .select('user_id')
        .in('organization_id', organizationIds)
        .in('user_id', [...batch]),
    ),
  ]);
  const visibilityError = coMembersResult.error ?? personnelResult.error;
  if (visibilityError) {
    logReadFailure('getProfileNamesVisibleTo: visibility read failed', visibilityError);
    return { success: false, error: 'load_failed' };
  }

  const visibleIds = new Set<string>([
    ...coMembersResult.data.map((row) => row.user_id),
    ...personnelResult.data.map((row) => row.user_id).filter((id): id is string => typeof id === 'string'),
  ]);
  visibleIds.add(callerUserId);
  const lookup = requested.filter((id) => visibleIds.has(id));
  if (lookup.length === 0) return { success: true, profiles: {} };

  const { data: profiles, error } = await readInBatches(lookup, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', [...batch]),
  );
  if (error) {
    logReadFailure('getProfileNamesVisibleTo: profile read failed', error);
    return { success: false, error: 'load_failed' };
  }

  const map: ProfileNameMap = {};
  for (const profile of profiles) {
    map[profile.id] = { firstName: profile.first_name, lastName: profile.last_name };
  }
  return { success: true, profiles: map };
}

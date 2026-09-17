import 'server-only';

// Internal member reads for server pages and actions that have already
// established the caller's identity. This module is deliberately not a
// 'use server' file: exporting these helpers as Server Actions made the
// caller-supplied user ID a public parameter (SI-014).

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { OrgMemberInfo } from './actions';

/**
 * Members of one organization as seen by `userId`. The security-definer RPC
 * raises `not_authorized` unless `userId` is a member, so callers must pass
 * the verified session user, never an ID from the request.
 */
export async function getOrgMembersForUser(
  organizationId: string,
  userId: string
): Promise<OrgMemberInfo[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('get_org_members_for_user', {
    p_org_id: organizationId,
    p_user_id: userId
  });

  if (error) {
    console.error('Error fetching organization members:', error);
    return [];
  }

  return (data ?? []) as OrgMemberInfo[];
}

export type ProfileNameMap = Record<
  string,
  { firstName: string | null; lastName: string | null }
>;

/**
 * Display names for user IDs the caller may see: current co-members of any of
 * the caller's organizations, plus people whose personnel record belongs to
 * one of those organizations (an exited member stays visible in the personnel
 * list). IDs outside that set are silently absent from the result (SI-015).
 */
export async function getProfileNamesVisibleTo(
  callerUserId: string,
  userIds: readonly string[]
): Promise<ProfileNameMap> {
  const requested = [...new Set(userIds)].filter(Boolean);
  if (requested.length === 0) return {};

  // The caller-scoped RLS policy evaluates effective P1-24 access now. Do not
  // authorize this fresh read from cached memberships after an out-of-band revoke.
  const callerClient = await createSupabaseServerClient();
  const { data: callerMemberships, error: membershipError } = await callerClient
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', callerUserId);
  if (membershipError || !callerMemberships?.length) return {};

  const admin = createSupabaseAdminClient();
  const organizationIds = callerMemberships.map((membership) => membership.organization_id);
  const [coMembersResult, personnelResult] = await Promise.all([
    admin
      .from('organization_members')
      .select('user_id')
      .in('organization_id', organizationIds)
      .in('user_id', requested),
    admin
      .from('employee_records')
      .select('user_id')
      .in('organization_id', organizationIds)
      .in('user_id', requested),
  ]);
  if (coMembersResult.error || personnelResult.error) return {};

  const visibleIds = new Set<string>([
    ...(coMembersResult.data ?? []).map((row) => row.user_id),
    ...(personnelResult.data ?? [])
      .map((row) => row.user_id)
      .filter((id): id is string => typeof id === 'string'),
  ]);
  visibleIds.add(callerUserId);
  const lookup = requested.filter((id) => visibleIds.has(id));
  if (lookup.length === 0) return {};

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, first_name, last_name')
    .in('id', lookup);
  if (error || !profiles) return {};

  const map: ProfileNameMap = {};
  for (const profile of profiles) {
    map[profile.id] = { firstName: profile.first_name, lastName: profile.last_name };
  }
  return map;
}

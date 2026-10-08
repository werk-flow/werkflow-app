import { cookies } from 'next/headers';

import type { ActionFailure } from '@/lib/action-result';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import type { OrgRole } from '@/lib/members/actions';
import type { UserOrg } from '@/lib/org/types';
import { isManagerRole } from '@/lib/roles';

// The one owner of a caller's organization context in Server Actions and route
// handlers (docs/technical/security.md, "Add a Server Action or route
// handler"). Identity comes from the verified session, the organization and
// the role from the current operational membership read of this request.
// lib/security/server-action-authorization.test.ts accepts these two
// functions and the named wrappers built on them as an organization check.

export type ActionContext = {
  userId: string;
  orgId: string;
  role: OrgRole;
  isManagerOrAbove: boolean;
};

type ActionContextResult<Code extends string> =
  | { success: true; context: ActionContext }
  | ActionFailure<Code>;

/** The cookie that names the active organization. It is a hint, never an authority. */
export const CURRENT_ORG_COOKIE = 'current_org_id';

/**
 * The active membership: the one the stored cookie names when the caller is
 * still a member of it, otherwise the first current membership.
 */
export function selectActiveMembership(
  memberships: readonly UserOrg[],
  storedOrgId: string | undefined,
): UserOrg | null {
  return memberships.find((membership) => membership.orgId === storedOrgId) ?? memberships[0] ?? null;
}

function contextOf(userId: string, orgId: string, role: OrgRole): ActionContext {
  return { userId, orgId, role, isManagerOrAbove: isManagerRole(role) };
}

/**
 * The signed-in caller in the active organization. The organization and the
 * role come from one membership read; the cookie only selects among them.
 */
export async function resolveActionContext(): Promise<
  ActionContextResult<'not_authenticated' | 'no_active_org'>
> {
  const [user, cookieStore] = await Promise.all([getAuthenticatedUser(), cookies()]);
  if (!user) return { success: false, error: 'not_authenticated' };

  const memberships = await getCachedMemberships(user.id);
  const membership = selectActiveMembership(memberships, cookieStore.get(CURRENT_ORG_COOKIE)?.value);
  if (!membership) return { success: false, error: 'no_active_org' };

  return { success: true, context: contextOf(user.id, membership.orgId, membership.role) };
}

async function membershipContext(
  userId: string,
  organizationId: string,
): Promise<ActionContextResult<'not_a_member'>> {
  const memberships = await getCachedMemberships(userId);
  const membership = memberships.find((entry) => entry.orgId === organizationId);
  if (!membership) return { success: false, error: 'not_a_member' };
  return { success: true, context: contextOf(userId, organizationId, membership.role) };
}

/**
 * The signed-in caller in a named organization: one taken from a parsed
 * argument or from a row the action loaded. A caller who is not a current
 * member of it is refused.
 */
export async function resolveActionContextFor(
  organizationId: string,
): Promise<ActionContextResult<'not_authenticated' | 'not_a_member'>> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  return membershipContext(user.id, organizationId);
}

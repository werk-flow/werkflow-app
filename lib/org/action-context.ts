import { cookies } from 'next/headers';

import type { ActionFailure } from '@/lib/action-result';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import type { OrgRole } from '@/lib/members/actions';
import { resolveActiveOrgId } from '@/lib/org/cookies';

export type ActionContext = {
  userId: string;
  orgId: string;
  role: OrgRole;
};

/** The signed-in user's identity and role in the active organization, from the current membership read. */
export async function resolveActionContext(): Promise<
  { success: true; context: ActionContext } | ActionFailure
> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };

  const cookieStore = await cookies();
  const orgId = await resolveActiveOrgId(cookieStore, user.id);
  if (!orgId) return { success: false, error: 'no_active_org' };

  const memberships = await getCachedMemberships(user.id);
  const membership = memberships.find((entry) => entry.orgId === orgId);
  if (!membership) return { success: false, error: 'not_a_member' };

  return {
    success: true,
    context: { userId: user.id, orgId, role: membership.role },
  };
}

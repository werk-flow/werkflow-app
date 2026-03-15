import { cookies } from 'next/headers';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import type { OrgRole } from './types';
import { MANAGER_ROLES } from './types';

export type AuthContext = {
  userId: string;
  orgId: string;
  role: OrgRole;
  isManagerOrAbove: boolean;
};

type AuthResult =
  | { success: true; context: AuthContext }
  | { success: false; error: string };

/**
 * Shared auth + org + role resolution for all jobs/projects/clients actions.
 * Uses cached helpers to avoid redundant network roundtrips.
 */
export async function authenticateAndAuthorize(): Promise<AuthResult> {
  const [user, cookieStore] = await Promise.all([
    getAuthenticatedUser(),
    cookies()
  ]);

  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  const orgId = await resolveActiveOrgId(cookieStore, user.id);

  if (!orgId) {
    return { success: false, error: 'no_active_org' };
  }

  const memberships = await getCachedMemberships(user.id);
  const membership = memberships.find((m) => m.orgId === orgId);

  if (!membership) {
    return { success: false, error: 'not_a_member' };
  }

  const role = membership.role as OrgRole;

  return {
    success: true,
    context: {
      userId: user.id,
      orgId,
      role,
      isManagerOrAbove: MANAGER_ROLES.includes(role),
    },
  };
}

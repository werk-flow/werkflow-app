import { cookies } from 'next/headers';
import { resolveActiveMembership } from '@/lib/org/cookies';
import { getAuthenticatedUser } from '@/lib/data/cached';
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
 * Resolves the organization and role from one fresh membership snapshot.
 */
export async function authenticateAndAuthorize(): Promise<AuthResult> {
  const [user, cookieStore] = await Promise.all([
    getAuthenticatedUser(),
    cookies()
  ]);

  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  const membership = await resolveActiveMembership(cookieStore, user.id);

  if (!membership) {
    return { success: false, error: 'no_active_org' };
  }

  const role = membership.role as OrgRole;

  return {
    success: true,
    context: {
      userId: user.id,
      orgId: membership.orgId,
      role,
      isManagerOrAbove: MANAGER_ROLES.includes(role),
    },
  };
}

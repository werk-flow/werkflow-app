import type { User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import { CURRENT_ORG_COOKIE, selectActiveMembership } from '@/lib/org/action-context';
import type { UserOrg } from '@/lib/org/types';

/** The signed-in caller of a page and the membership the page renders for. */
export type PageMembership = {
  user: User;
  /** The active membership with its role; null when the caller belongs to no current organization. */
  membership: UserOrg | null;
};

/**
 * The page-side twin of `resolveActionContext`: the verified user and the
 * active membership, with the role from the same membership read. A page
 * without a session redirects to the login; the page decides what a caller
 * without an organization or with the wrong role sees.
 */
export async function resolvePageMembership(): Promise<PageMembership> {
  const [user, cookieStore] = await Promise.all([getAuthenticatedUser(), cookies()]);
  if (!user) redirect('/login');
  const memberships = await getCachedMemberships(user.id);
  return {
    user,
    membership: selectActiveMembership(memberships, cookieStore.get(CURRENT_ORG_COOKIE)?.value),
  };
}

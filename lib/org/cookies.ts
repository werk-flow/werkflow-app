import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';
import { getCachedMemberships } from '@/lib/data/cached';
import { CURRENT_ORG_COOKIE, selectActiveMembership } from '@/lib/org/action-context';

export { CURRENT_ORG_COOKIE };
export const CURRENT_ORG_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Resolve the active org ID from the cookie, falling back to the user's
 * first membership when the cookie is missing or stale.
 * Use this in server components / pages instead of reading the cookie directly.
 */
export async function resolveActiveOrgId(
  cookieStore: ReadonlyRequestCookies,
  userId: string,
): Promise<string | null> {
  const memberships = await getCachedMemberships(userId);
  return selectActiveMembership(memberships, cookieStore.get(CURRENT_ORG_COOKIE)?.value)?.orgId ?? null;
}

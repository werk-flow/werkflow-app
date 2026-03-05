import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';
import { getCachedMemberships } from '@/lib/data/cached';

export const CURRENT_ORG_COOKIE = 'current_org_id';
export const CURRENT_ORG_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Resolve the active org ID from the cookie, falling back to the user's
 * first membership when the cookie is missing or stale.
 * Use this in server components / pages instead of reading the cookie directly.
 */
export async function resolveActiveOrgId(
  cookieStore: ReadonlyRequestCookies,
  userId: string
): Promise<string | null> {
  const stored = cookieStore.get(CURRENT_ORG_COOKIE)?.value;
  const memberships = await getCachedMemberships(userId);

  if (stored && memberships.some((m) => m.orgId === stored)) {
    return stored;
  }

  return memberships[0]?.orgId ?? null;
}


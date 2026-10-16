import { cookies } from 'next/headers';

import type { ActionFailure } from '@/lib/action-result';
import { getAuthenticatedUser, getCachedMemberships, getCachedPrestartMemberships } from '@/lib/data/cached';
import type { OrgRole } from '@/lib/roles';
import { CURRENT_ORG_COOKIE } from '@/lib/org/action-context';

// The owner of the self-service caller context: an employee acting on their
// own personnel items, who may still be in prestart. lib/org/action-context.ts
// resolves operational memberships only; this module adds the prestart ones
// and never grants a prestart caller a role.
// lib/security/server-action-authorization.test.ts accepts both exports as an
// organization check.

/** An operational member carries a role; a prestart employee acts only on their own items. */
type SelfServiceContext = { userId: string; orgId: string } & (
  | { prestart: false; role: OrgRole }
  | { prestart: true; role: null }
);

type SelfServiceContextResult =
  | { success: true; context: SelfServiceContext }
  | ActionFailure<'not_authenticated' | 'not_a_member'>;

/** Operational memberships first, so they win over a prestart one in the same organization. */
async function selfServiceCandidates(userId: string): Promise<SelfServiceContext[]> {
  const [operational, prestart] = await Promise.all([
    getCachedMemberships(userId),
    getCachedPrestartMemberships(userId),
  ]);
  return [
    ...operational.map((membership) => ({
      userId,
      orgId: membership.orgId,
      prestart: false as const,
      role: membership.role,
    })),
    ...prestart.map((membership) => ({
      userId,
      orgId: membership.orgId,
      prestart: true as const,
      role: null,
    })),
  ];
}

/**
 * The self-service caller in the active organization. The cookie selects
 * among operational and prestart memberships; without a cookie, only a caller
 * with exactly one such membership resolves.
 */
export async function resolveSelfServiceContext(): Promise<SelfServiceContextResult> {
  const [user, cookieStore] = await Promise.all([getAuthenticatedUser(), cookies()]);
  if (!user) return { success: false, error: 'not_authenticated' };
  const candidates = await selfServiceCandidates(user.id);
  const stored = cookieStore.get(CURRENT_ORG_COOKIE)?.value;
  const selected = stored
    ? candidates.find((candidate) => candidate.orgId === stored)
    : candidates.length === 1
      ? candidates[0]
      : undefined;
  if (!selected) return { success: false, error: 'not_a_member' };
  return { success: true, context: selected };
}

/** The self-service caller in a named organization taken from a loaded row. */
export async function resolveSelfServiceContextFor(
  organizationId: string,
): Promise<SelfServiceContextResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const candidates = await selfServiceCandidates(user.id);
  const selected = candidates.find((candidate) => candidate.orgId === organizationId);
  if (!selected) return { success: false, error: 'not_a_member' };
  return { success: true, context: selected };
}

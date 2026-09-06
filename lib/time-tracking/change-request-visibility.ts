import type { OrgRole } from '@/lib/jobs/types';

export type ChangeRequestVisibilityFacts = {
  organizationId: string;
  requestedBy: string;
  entryUserId: string | null;
};

/**
 * A pending change request is visible to managers of its organization and to
 * the person it concerns (the requester or the entry owner). Caller-supplied
 * entry IDs never widen this: an ID from another organization matches no
 * membership and is dropped (SI-002).
 */
export function canViewChangeRequest(
  facts: ChangeRequestVisibilityFacts,
  caller: { userId: string; roleByOrganization: ReadonlyMap<string, OrgRole> }
): boolean {
  const role = caller.roleByOrganization.get(facts.organizationId);
  if (!role) return false;
  if (role === 'admin' || role === 'buero') return true;
  return facts.requestedBy === caller.userId || facts.entryUserId === caller.userId;
}

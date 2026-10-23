import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { resolveActionContextFor } from '@/lib/org/action-context';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import { getEffectiveResponsibilityHolderForActor } from '@/lib/responsibilities/server';
import { uuidSchema } from '@/lib/validation/uuid';

export type TimeApprovalHolderResult = ActionResult<{ holder: EffectiveResponsibilityHolder | null }>;

/**
 * The caller's own `time_approval` holder in an organization, or null when the
 * caller holds none: a surface that offers a review of recorded time asks
 * `canApproveEntries` with it, the predicate the server's
 * `authorizeResponsibilityForTarget` asks before it writes.
 */
export async function getTimeApprovalHolder(organizationId: string): Promise<TimeApprovalHolderResult> {
  const parsed = uuidSchema.safeParse(organizationId);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const caller = await resolveActionContextFor(parsed.data);
  if (!caller.success) return caller;
  const holder = await getEffectiveResponsibilityHolderForActor({
    organizationId: parsed.data,
    responsibility: 'time_approval',
    actorUserId: caller.context.userId,
  });
  return { success: true, holder };
}

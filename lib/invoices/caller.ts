import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { resolveActionContext, type ActionContext } from '@/lib/org/action-context';

/**
 * The caller of an invoice action: signed in, in the active organization,
 * Admin or Büro. The database function checks the actor again.
 */
export async function officeCaller(): Promise<{ success: true; context: ActionContext } | ActionFailure> {
  const caller = await resolveActionContext();
  if (!caller.success) return caller;
  if (!caller.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  return caller;
}

import 'server-only';

import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import {
  getEffectiveResponsibilityHolderForActor,
  loadResponsibilityRuntimeState,
} from '@/lib/responsibilities/server';

type TimeAccountContext = Extract<
  Awaited<ReturnType<typeof authenticateAndAuthorize>>,
  { success: true }
>['context'];

/** The verified caller with current membership; a missing session goes to the login. */
export async function requireAuth(): Promise<TimeAccountContext> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) redirect('/login');
  return auth.context;
}

/**
 * Whether the caller manages periods and accounts. A failed responsibility
 * read is its own failure, never "not responsible" and never access.
 */
type TimeAccountManagement = ActionResult<{ canManage: boolean }, 'responsibility_load_failed'>;

/** Admin, Büro and effective `time_approval` holders manage periods and accounts. */
export async function readTimeAccountManagement(context: {
  orgId: string;
  userId: string;
  isManagerOrAbove: boolean;
}): Promise<TimeAccountManagement> {
  if (context.isManagerOrAbove) return { success: true, canManage: true };
  // The holder lookup answers null for "not responsible" and for a failed
  // read alike; the request-memoized state read tells them apart.
  if (!(await loadResponsibilityRuntimeState(context.orgId)))
    return { success: false, error: 'responsibility_load_failed' };
  const holder = await getEffectiveResponsibilityHolderForActor({
    organizationId: context.orgId,
    responsibility: 'time_approval',
    actorUserId: context.userId,
  });
  return { success: true, canManage: Boolean(holder) };
}

import 'server-only';

import { logReadFailure } from '@/lib/data/read-request-cache';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { WorkArtifactTarget } from '@/lib/work-artifacts/types';

/**
 * The work a member leads as „Projektleitung“, from the database's one rule
 * (`app_private.work_lead_scope`): the projects they lead, and every job they
 * lead by its own holding or through its project's. A holding counts while it
 * is open and the member still belongs to the organization with effective
 * access and has not left.
 */
const scopeSchema = z.object({ projectIds: z.array(uuidSchema), jobIds: z.array(uuidSchema) });

export type WorkLeadScope = {
  projectIds: ReadonlySet<string>;
  jobIds: ReadonlySet<string>;
};

/**
 * The caller's lead scope, read fresh on each call: an authorization fact is
 * never kept beyond its check. Null when it could not be read, which never
 * counts as access.
 */
export async function getWorkLeadScope(
  context: Pick<ActionContext, 'orgId' | 'userId'>,
): Promise<WorkLeadScope | null> {
  const { data, error } = await createSupabaseAdminClient().rpc('read_work_lead_scope', {
    p_organization_id: context.orgId,
    p_user_id: context.userId,
  });
  const scope = scopeSchema.safeParse(data);
  if (error || !scope.success) {
    logReadFailure('getWorkLeadScope: read_work_lead_scope failed', error);
    return null;
  }
  return { projectIds: new Set(scope.data.projectIds), jobIds: new Set(scope.data.jobIds) };
}

/** Whether the scope covers the job, or, for project-level work, the project. */
function workLeadCovers(scope: WorkLeadScope, target: WorkArtifactTarget): boolean {
  return target.targetType === 'job'
    ? scope.jobIds.has(target.targetId)
    : scope.projectIds.has(target.targetId);
}

/**
 * Whether the caller leads the work. `load_failed` when the rule could not be
 * read: the caller sees that the check could not run, never a refusal.
 */
export async function isWorkLeadOf(
  context: Pick<ActionContext, 'orgId' | 'userId'>,
  target: WorkArtifactTarget,
): Promise<boolean | 'load_failed'> {
  const scope = await getWorkLeadScope(context);
  return scope ? workLeadCovers(scope, target) : 'load_failed';
}

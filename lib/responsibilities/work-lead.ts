import 'server-only';

import { logReadFailure, memoizeRequestRead } from '@/lib/data/read-request-cache';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * The work a member leads as „Projektleitung“, from the database's one rule
 * (`app_private.work_lead_scope`): the projects they lead, and every job they
 * lead by its own holding or through its project's. A holding counts while it
 * is open and the member still belongs to the organization with effective
 * access and has not left.
 */
export type WorkLeadScope = {
  projectIds: ReadonlySet<string>;
  jobIds: ReadonlySet<string>;
};

export type WorkLeadTarget = { targetType: 'job' | 'project'; targetId: string };

const readWorkLeadScope = memoizeRequestRead(
  async function readWorkLeadScope(organizationId: string, userId: string): Promise<WorkLeadScope | null> {
    const { data, error } = await createSupabaseAdminClient().rpc('work_lead_scope', {
      p_organization_id: organizationId,
      p_user_id: userId,
    });
    if (error) {
      logReadFailure('readWorkLeadScope: work_lead_scope failed', error);
      return null;
    }
    const projectIds = new Set<string>();
    const jobIds = new Set<string>();
    for (const row of data) {
      if (row.job_id) jobIds.add(row.job_id);
      else if (row.project_id) projectIds.add(row.project_id);
    }
    return { projectIds, jobIds };
  },
  { outsideRequest: 'fresh' },
);

/** The caller's lead scope; null when it could not be read, which never counts as access. */
export function getWorkLeadScope(context: Pick<ActionContext, 'orgId' | 'userId'>): Promise<WorkLeadScope | null> {
  return readWorkLeadScope(context.orgId, context.userId);
}

/** Whether the scope covers the job, or, for project-level work, the project. */
export function workLeadCovers(scope: WorkLeadScope, target: WorkLeadTarget): boolean {
  return target.targetType === 'job' ? scope.jobIds.has(target.targetId) : scope.projectIds.has(target.targetId);
}

/**
 * Whether the caller leads the work. `load_failed` when the rule could not be
 * read: the caller sees that the check could not run, never a refusal.
 */
export async function isWorkLeadOf(
  context: Pick<ActionContext, 'orgId' | 'userId'>,
  target: WorkLeadTarget,
): Promise<boolean | 'load_failed'> {
  const scope = await getWorkLeadScope(context);
  return scope ? workLeadCovers(scope, target) : 'load_failed';
}

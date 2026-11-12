import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { readJobAssignmentOfUser, readOrganizationJob } from '@/lib/jobs/job-access-reads';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { WorkArtifactTarget } from './types';

/**
 * Whether the caller may read and write Arbeitsnachweise of a job or project:
 * the target belongs to the caller's organization, and a field worker is
 * assigned to the job, or to a job of the project. A failed read is never a
 * refusal: the caller sees that the check could not run.
 */
export async function authorizeWorkArtifactTarget(
  context: ActionContext,
  target: WorkArtifactTarget,
): Promise<ActionResult<object, 'not_authorized' | 'load_failed'>> {
  const admin = createSupabaseAdminClient();
  const allowed = { success: true } as const;
  const refused = { success: false, error: 'not_authorized' } as const;
  const loadFailed = { success: false, error: 'load_failed' } as const;
  if (target.targetType === 'job') {
    const { data: job, error: jobError } = await readOrganizationJob(context.orgId, target.targetId);
    if (jobError) return loadFailed;
    if (!job) return refused;
    if (context.isManagerOrAbove) return allowed;
    const { data: assignment, error: assignmentError } = await readJobAssignmentOfUser(
      context.orgId,
      target.targetId,
      context.userId,
    );
    if (assignmentError) return loadFailed;
    return assignment ? allowed : refused;
  }
  const { data: project, error: projectError } = await loggedRead(
    'authorizeWorkArtifactTarget: projects read failed',
    admin
      .from('projects')
      .select('id')
      .eq('id', target.targetId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (projectError) return loadFailed;
  if (!project) return refused;
  if (context.isManagerOrAbove) return allowed;
  const { data: assignedJob, error: assignedJobError } = await loggedRead(
    'authorizeWorkArtifactTarget: jobs read failed',
    admin
      .from('jobs')
      .select('job_assignments!inner(id)')
      .eq('project_id', target.targetId)
      .eq('organization_id', context.orgId)
      .eq('job_assignments.user_id', context.userId)
      .limit(1)
      .maybeSingle(),
  );
  if (assignedJobError) return loadFailed;
  return assignedJob ? allowed : refused;
}

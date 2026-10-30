import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import type { AuthContext } from '@/lib/jobs/auth';
import { readJobAssignmentOfUser, readOrganizationJob } from '@/lib/jobs/job-access-reads';
import type { AdminClient } from '@/lib/supabase/admin';

// The object permission of the material Server Actions in `./actions`: the
// job or project inside the caller's organization, and whether the caller
// may act on it. The callers establish the context first.

/** The job of the caller's organization; an employee needs an assignment to it. */
export async function getJobContext(
  context: AuthContext,
  jobId: string,
): Promise<ActionResult<{ job: { id: string; project_id: string | null } }>> {
  const { data: job, error } = await readOrganizationJob(context.orgId, jobId);
  if (error) return { success: false, error: 'load_failed' };
  if (!job) {
    return { success: false, error: 'job_not_found' };
  }

  if (!context.isManagerOrAbove) {
    const { data: assignment, error: assignmentError } = await readJobAssignmentOfUser(
      context.orgId,
      jobId,
      context.userId,
    );
    if (assignmentError) return { success: false, error: 'load_failed' };

    if (!assignment) {
      return { success: false, error: 'not_authorized' };
    }
  }

  return { success: true, job };
}

/** The project of the caller's organization; only the office acts on a project. */
export async function getProjectContext(
  admin: AdminClient,
  context: AuthContext,
  projectId: string,
): Promise<ActionResult<{ project: { id: string } }>> {
  const { data, error } = await loggedRead(
    'getProjectContext: projects read failed',
    admin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );

  const project = data;
  if (error) return { success: false, error: 'load_failed' };
  if (!project) {
    return { success: false, error: 'project_not_found' };
  }

  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  return { success: true, project };
}

'use server';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { getWorkLeadScope, type WorkLeadScope } from '@/lib/responsibilities/work-lead';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { getWorkArtifacts } from '@/lib/work-artifacts/actions';
import type { WorkArtifactSummary } from '@/lib/work-artifacts/types';
import type { LedInstruction, LedProjectOverview } from './work-lead-types';
import type { WorkExecutionState } from '@/lib/work-lifecycle/types';

/** How many jobs' Arbeitsnachweise read at once. */
const ARTIFACT_READ_CONCURRENCY = 4;

type LedJobRow = {
  id: string;
  job_number: string | null;
  title: string;
  description: string | null;
  execution_state: WorkExecutionState | null;
  planned_date: string | null;
};

/** The project and its jobs the scope covers; null when a read failed. */
async function readLedJobs(orgId: string, projectId: string, scope: WorkLeadScope) {
  const admin = createSupabaseAdminClient();
  const [project, jobs] = await Promise.all([
    loggedRead(
      'getLedProjectOverview: projects read failed',
      admin
        .from('projects')
        .select('id, name, project_number')
        .eq('organization_id', orgId)
        .eq('id', projectId)
        .maybeSingle(),
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select('id, job_number, title, description, execution_state, planned_date')
          .eq('organization_id', orgId)
          .eq('project_id', projectId)
          .order('planned_date', { ascending: true, nullsFirst: false })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);
  if (project.error || jobs.error) return null;
  const ledJobs: LedJobRow[] = jobs.data.filter((job) => scope.jobIds.has(job.id));
  return { project: project.data, jobs: ledJobs };
}

/** The instructions of the jobs, in their order, without who changed them; null when the read failed. */
async function readLedInstructions(orgId: string, jobIds: string[]) {
  const instructions = await readInBatches(jobIds, (batch) =>
    createSupabaseAdminClient()
      .from('job_instruction_items')
      .select('id, job_id, content, requirement_state, is_completed, sort_order')
      .eq('organization_id', orgId)
      .in('job_id', [...batch]),
  );
  if (instructions.error) return null;
  const byJob = new Map<string, LedInstruction[]>();
  for (const item of instructions.data.toSorted((left, right) => left.sort_order - right.sort_order)) {
    if (!item.job_id) continue;
    const list = byJob.get(item.job_id) ?? [];
    list.push({
      id: item.id,
      content: item.content,
      required: item.requirement_state === 'required',
      completed: item.is_completed,
    });
    byJob.set(item.job_id, list);
  }
  return byJob;
}

/** The Arbeitsnachweise of each job, through the lead-aware reader; null when one read failed. */
async function readLedArtifacts(jobIds: string[]): Promise<WorkArtifactSummary[][] | null> {
  const artifacts: WorkArtifactSummary[][] = [];
  for (let start = 0; start < jobIds.length; start += ARTIFACT_READ_CONCURRENCY) {
    const chunk = jobIds.slice(start, start + ARTIFACT_READ_CONCURRENCY);
    const results = await Promise.all(chunk.map((id) => getWorkArtifacts({ targetType: 'job', targetId: id })));
    for (const result of results) {
      if (!result.success) return null;
      artifacts.push(result.artifacts);
    }
  }
  return artifacts;
}

/**
 * Every job of a project the caller leads, in the lead's projection, with the
 * project's own Arbeitsnachweise. Only the project's current lead reads it; a
 * job that names its own lead stays out.
 */
export async function getLedProjectOverview(
  rawProjectId: string,
): Promise<ActionResult<{ overview: LedProjectOverview }>> {
  const parsed = uuidSchema.safeParse(rawProjectId);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const projectId = parsed.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const scope = await getWorkLeadScope(auth.context);
  if (!scope) return { success: false, error: 'load_failed' };
  if (!scope.projectIds.has(projectId)) return { success: false, error: 'not_authorized' };

  const led = await readLedJobs(auth.context.orgId, projectId, scope);
  if (!led) return { success: false, error: 'load_failed' };
  if (!led.project) return { success: false, error: 'not_authorized' };
  const jobIds = led.jobs.map((job) => job.id);
  const [instructions, projectArtifacts, jobArtifacts] = await Promise.all([
    readLedInstructions(auth.context.orgId, jobIds),
    getWorkArtifacts({ targetType: 'project', targetId: projectId }),
    readLedArtifacts(jobIds),
  ]);
  if (!instructions || !projectArtifacts.success || !jobArtifacts) return { success: false, error: 'load_failed' };

  return {
    success: true,
    overview: {
      projectId: led.project.id,
      projectNumber: led.project.project_number,
      name: led.project.name,
      projectArtifacts: projectArtifacts.artifacts,
      jobs: led.jobs.map((job, index) => ({
        id: job.id,
        jobNumber: job.job_number,
        title: job.title,
        requestedOutcome: job.description,
        executionState: job.execution_state,
        plannedDate: job.planned_date,
        instructions: instructions.get(job.id) ?? [],
        artifacts: jobArtifacts[index] ?? [],
      })),
    },
  };
}

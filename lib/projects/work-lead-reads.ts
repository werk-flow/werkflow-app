import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead, logReadFailure } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { getWorkLeadScope } from '@/lib/responsibilities/work-lead';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, mapInWindows, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { getWorkArtifacts } from '@/lib/work-artifacts/actions';
import type { WorkArtifactSummary } from '@/lib/work-artifacts/types';
import {
  workLeadTargetSchema,
  type LedInstruction,
  type LedProjectOverview,
  type WorkLeadHolding,
  type WorkLeadPanel,
  type WorkLeadTarget,
} from './work-lead-types';

const UNKNOWN_PERSON = 'Unbekannte Person';

function joinedName(person: { first_name: string | null; last_name: string | null }): string | null {
  return [person.first_name, person.last_name].filter(Boolean).join(' ') || null;
}

/**
 * The leads' personnel records and the names of the leads and of who named or
 * ended them, from their profiles first; null when a read failed.
 */
async function readHoldingNames(orgId: string, employeeRecordIds: string[], actorIds: string[]) {
  const admin = createSupabaseAdminClient();
  const records = await readInBatches(employeeRecordIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  if (records.error) {
    logReadFailure('getWorkLead: employee_records read failed', records.error);
    return null;
  }
  const leadUserIds = records.data.flatMap((record) => (record.user_id ? [record.user_id] : []));
  const profiles = await readInBatches([...new Set([...actorIds, ...leadUserIds])], (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', [...batch]),
  );
  if (profiles.error) {
    logReadFailure('getWorkLead: profiles read failed', profiles.error);
    return null;
  }
  const profileNames = new Map(profiles.data.map((profile) => [profile.id, joinedName(profile)]));
  return {
    records: new Map(
      records.data.map((record) => [
        record.id,
        {
          userId: record.user_id,
          name: (record.user_id ? profileNames.get(record.user_id) : null) ?? joinedName(record),
        },
      ]),
    ),
    actorNames: profileNames,
  };
}

/**
 * The lead of a project or standalone job with its history, for Admin and
 * Büro, who name and end it.
 */
export async function getWorkLead(
  rawTarget: WorkLeadTarget,
): Promise<ActionResult<{ panel: WorkLeadPanel }>> {
  const parsed = workLeadTargetSchema.safeParse(rawTarget);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const { orgId } = auth.context;
  const target = parsed.data;

  const admin = createSupabaseAdminClient();
  const rows = await readCompleteRows(
    (from, to) =>
      admin
        .from('work_leads')
        .select('id, employee_record_id, started_at, started_by, ended_at, ended_by')
        .eq('organization_id', orgId)
        .eq(target.targetType === 'job' ? 'job_id' : 'project_id', target.targetId)
        .order('started_at', { ascending: false })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (rows.error) {
    logReadFailure('getWorkLead: work_leads read failed', rows.error);
    return { success: false, error: 'load_failed' };
  }
  const names = await readHoldingNames(
    orgId,
    [...new Set(rows.data.map((row) => row.employee_record_id))],
    [...new Set(rows.data.flatMap((row) => [row.started_by, row.ended_by].filter((id) => id !== null)))],
  );
  if (!names) return { success: false, error: 'load_failed' };

  const history = rows.data.map((row): WorkLeadHolding => {
    const record = names.records.get(row.employee_record_id);
    return {
      id: row.id,
      userId: record?.userId ?? null,
      name: record?.name ?? UNKNOWN_PERSON,
      startedAt: row.started_at,
      startedByName: row.started_by ? (names.actorNames.get(row.started_by) ?? null) : null,
      endedAt: row.ended_at,
      endedByName: row.ended_by ? (names.actorNames.get(row.ended_by) ?? null) : null,
    };
  });
  return {
    success: true,
    panel: { current: history.find((holding) => holding.endedAt === null) ?? null, history },
  };
}

/** The instructions of the jobs in their order, without who changed them; null when the read failed. */
async function readLedInstructions(orgId: string, jobIds: string[]) {
  const admin = createSupabaseAdminClient();
  // A batch of jobs may hold more items than one response, so each batch reads page by page.
  const items = await readInBatches(jobIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('job_instruction_items')
          .select('id, job_id, content, requirement_state, is_completed, sort_order')
          .eq('organization_id', orgId)
          .in('job_id', [...batch])
          .order('job_id')
          .order('sort_order')
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );
  if (items.error) {
    logReadFailure('getLedProjectOverview: job_instruction_items read failed', items.error);
    return null;
  }
  const byJob = new Map<string, LedInstruction[]>();
  for (const item of items.data) {
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

/**
 * Every job of a project the caller leads as its „Projektleitung“, in the
 * lead's projection, with the project's own Arbeitsnachweise. Only the
 * project's current lead reads it; a job that names its own lead stays out.
 * The Arbeitsnachweise come through their own reader, which applies the lead
 * rule and the draft visibility again.
 */
export async function getLedProjectOverview(
  rawProjectNumber: string,
): Promise<ActionResult<{ overview: LedProjectOverview }>> {
  if (rawProjectNumber.length === 0 || rawProjectNumber.length > 300) {
    return { success: false, error: 'not_authorized' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { orgId } = auth.context;
  const admin = createSupabaseAdminClient();

  const [project, scope] = await Promise.all([
    loggedRead(
      'getLedProjectOverview: projects read failed',
      admin
        .from('projects')
        .select('id, name, project_number')
        .eq('organization_id', orgId)
        .eq('project_number', rawProjectNumber)
        .maybeSingle(),
    ),
    getWorkLeadScope(auth.context),
  ]);
  if (project.error || !scope) return { success: false, error: 'load_failed' };
  if (!project.data || !scope.projectIds.has(project.data.id))
    return { success: false, error: 'not_authorized' };
  const projectId = project.data.id;

  const jobs = await readCompleteRows(
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
  );
  if (jobs.error) {
    logReadFailure('getLedProjectOverview: jobs read failed', jobs.error);
    return { success: false, error: 'load_failed' };
  }
  const ledJobs = jobs.data.filter((job) => scope.jobIds.has(job.id));
  const jobIds = ledJobs.map((job) => job.id);
  const [instructions, projectArtifacts, jobArtifacts] = await Promise.all([
    readLedInstructions(orgId, jobIds),
    getWorkArtifacts({ targetType: 'project', targetId: projectId }),
    mapInWindows(
      jobIds,
      (id) => getWorkArtifacts({ targetType: 'job', targetId: id }),
      (result) => !result.success,
    ),
  ]);
  if (!instructions || !projectArtifacts.success) return { success: false, error: 'load_failed' };
  // The windows stop after a failed read, so a job without a result is a failure too.
  const artifactsByJob = new Map<string, WorkArtifactSummary[]>();
  for (const [index, jobId] of jobIds.entries()) {
    const result = jobArtifacts[index];
    if (!result?.success) return { success: false, error: 'load_failed' };
    artifactsByJob.set(jobId, result.artifacts);
  }

  return {
    success: true,
    overview: {
      projectId,
      projectNumber: project.data.project_number,
      name: project.data.name,
      projectArtifacts: projectArtifacts.artifacts,
      jobs: ledJobs.map((job) => ({
        id: job.id,
        jobNumber: job.job_number,
        title: job.title,
        requestedOutcome: job.description,
        executionState: job.execution_state,
        plannedDate: job.planned_date,
        instructions: instructions.get(job.id) ?? [],
        artifacts: artifactsByJob.get(job.id) ?? [],
      })),
    },
  };
}

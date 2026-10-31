import 'server-only';

// The due reviews of parked work (work blockers) behind the attention Server
// Actions in `./actions`. Deciding a review happens on the work surface.

import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { ActionContext } from '@/lib/org/action-context';
import type { Tables } from '@/lib/supabase/database.types';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { logError } from '@/lib/logging';
import { recordDisplayNames, workTargetHref, workTargetLabel } from './task-labels';
import type { AttentionTask } from './types';

type ParkingReviewRow = Pick<
  Tables<'work_blockers'>,
  | 'id'
  | 'job_id'
  | 'project_id'
  | 'instruction_item_id'
  | 'kind'
  | 'next_review_date'
  | 'responsible_employee_record_id'
  | 'version'
>;
type ParkingInstructionRow = Pick<
  Tables<'job_instruction_items'>,
  'id' | 'content' | 'job_id' | 'project_id'
>;

export async function deriveParkingReviewTasks(
  context: ActionContext,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { tasks: [], failed: false };
  }
  const admin = createSupabaseAdminClient();
  const businessToday = getBusinessTodayIso();
  // Complete and deterministically ordered: every due review surfaces.
  const { data: contexts, error: contextError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('work_blockers')
        .select(
          'id, job_id, project_id, instruction_item_id, kind, next_review_date, responsible_employee_record_id, version',
        )
        .eq('organization_id', context.orgId)
        .eq('state', 'open')
        .lte('next_review_date', businessToday)
        .order('next_review_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (contextError) {
    logError('Failed to load parking review contexts', contextError);
    return { tasks: [], failed: true };
  }
  if (!contexts.length) return { tasks: [], failed: false };

  const instructionIds = contexts.flatMap((row) =>
    row.instruction_item_id ? [row.instruction_item_id] : [],
  );
  const instructionsResult = await readInBatches(instructionIds, (batch) =>
    admin
      .from('job_instruction_items')
      .select('id, content, job_id, project_id')
      .eq('organization_id', context.orgId)
      .in('id', [...batch]),
  );
  if (instructionsResult.error) {
    logError('Failed to load blocker review instruction items', instructionsResult.error);
    return { tasks: [], failed: true };
  }
  const instructions = new Map((instructionsResult.data ?? []).map((row) => [row.id, row]));
  const references = await readParkingReviewReferences(admin, context.orgId, contexts, instructions);
  if (!references) return { tasks: [], failed: true };

  const tasks: AttentionTask[] = [];
  for (const row of contexts) {
    const task = toParkingReviewTask(row, instructions, references);
    if (!task) {
      logError('Work blocker review has no accessible target');
      return { tasks: [], failed: true };
    }
    tasks.push(task);
  }
  return { tasks, failed: false };
}

/** The jobs, projects and responsible people the due reviews name; null when a read failed. */
async function readParkingReviewReferences(
  admin: AdminClient,
  organizationId: string,
  contexts: ParkingReviewRow[],
  instructions: ReadonlyMap<string, ParkingInstructionRow>,
) {
  const jobIds = [
    ...new Set(
      contexts.flatMap((row) => {
        const instruction = row.instruction_item_id ? instructions.get(row.instruction_item_id) : null;
        return row.job_id ? [row.job_id] : instruction?.job_id ? [instruction.job_id] : [];
      }),
    ),
  ];
  const projectIds = [
    ...new Set(
      contexts.flatMap((row) => {
        const instruction = row.instruction_item_id ? instructions.get(row.instruction_item_id) : null;
        return row.project_id ? [row.project_id] : instruction?.project_id ? [instruction.project_id] : [];
      }),
    ),
  ];
  const responsibleIds = [
    ...new Set(
      contexts.flatMap((row) =>
        row.responsible_employee_record_id ? [row.responsible_employee_record_id] : [],
      ),
    ),
  ];
  const [jobsResult, projectsResult, recordsResult] = await Promise.all([
    readInBatches(jobIds, (batch) =>
      admin
        .from('jobs')
        .select('id, title, description, job_number')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(projectIds, (batch) =>
      admin
        .from('projects')
        .select('id, name, description, project_number')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(responsibleIds, (batch) =>
      admin
        .from('employee_records')
        .select('id, user_id, first_name, last_name')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
  ]);
  if (jobsResult.error || projectsResult.error || recordsResult.error) {
    logError(
      'Failed to load parking review references',
      jobsResult.error ?? projectsResult.error ?? recordsResult.error,
    );
    return null;
  }
  const userIds = (recordsResult.data ?? []).flatMap((row) => (row.user_id ? [row.user_id] : []));
  const profilesResult = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logError('Failed to load parking responsible profiles', profilesResult.error);
    return null;
  }
  return {
    nameByRecordId: recordDisplayNames(recordsResult.data ?? [], profilesResult.data ?? []),
    jobs: new Map((jobsResult.data ?? []).map((job) => [job.id, job])),
    projects: new Map((projectsResult.data ?? []).map((project) => [project.id, project])),
  };
}

/** The review task of one blocker, or null when it has no review date or no target the reads found. */
function toParkingReviewTask(
  row: ParkingReviewRow,
  instructions: ReadonlyMap<string, ParkingInstructionRow>,
  { nameByRecordId, jobs, projects }: NonNullable<Awaited<ReturnType<typeof readParkingReviewReferences>>>,
): AttentionTask | null {
  const instruction = row.instruction_item_id ? instructions.get(row.instruction_item_id) : null;
  const jobId = row.job_id ?? instruction?.job_id ?? null;
  const projectId = row.project_id ?? instruction?.project_id ?? null;
  const job = jobId ? jobs.get(jobId) : undefined;
  const project = projectId ? projects.get(projectId) : undefined;
  if (!row.next_review_date || (!job && !project)) return null;
  return {
    sourceType: 'work_blocker_review',
    sourceId: row.id,
    targetLabel: instruction ? instruction.content : workTargetLabel(job, project),
    targetHref: workTargetHref(job, project),
    blockerKind: row.kind,
    nextReviewDate: row.next_review_date,
    responsibleName: row.responsible_employee_record_id
      ? (nameByRecordId.get(row.responsible_employee_record_id) ?? null)
      : null,
    stateVersion: `review:${row.version}:${row.next_review_date}`,
  };
}

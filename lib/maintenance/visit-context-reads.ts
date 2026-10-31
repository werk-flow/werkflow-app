import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import type { ServiceManagerContext } from '@/lib/service-cases/manager-context';
import type { Tables } from '@/lib/supabase/database.types';
import { jsonRecordOrEmpty } from '@/lib/supabase/json';
import { readInBatches } from '@/lib/supabase/query-batches';

type ReplayEvent = Pick<Tables<'maintenance_due_work_events'>, 'maintenance_due_work_id' | 'request_payload'>;

/**
 * The job of an earlier visit request with the same idempotency key. It is a
 * replay only when it linked exactly the requested due items to one job.
 */
export async function readReplayedVisitJobNumber(
  context: ServiceManagerContext,
  replayEvents: ReplayEvent[],
  dueWorkIds: string[],
): Promise<ActionResult<{ jobNumber: string }>> {
  const replayDueIds = new Set(replayEvents.map((event) => event.maintenance_due_work_id));
  const replayJobIds = new Set(
    replayEvents.flatMap((event) => {
      const payload = jsonRecordOrEmpty(event.request_payload);
      return typeof payload.jobId === 'string' ? [payload.jobId] : [];
    }),
  );
  const replayMatches =
    replayDueIds.size === dueWorkIds.length &&
    dueWorkIds.every((dueWorkId) => replayDueIds.has(dueWorkId)) &&
    replayJobIds.size === 1;
  const replayJobId = [...replayJobIds][0];
  if (!replayMatches || !replayJobId) {
    return { success: false, error: 'maintenance_idempotency_conflict' };
  }
  const { data: replayJob, error: replayJobError } = await context.admin
    .from('jobs')
    .select('job_number')
    .eq('organization_id', context.organizationId)
    .eq('id', replayJobId)
    .single();
  if (replayJobError || !replayJob.job_number) {
    return { success: false, error: 'maintenance_visit_context_failed' };
  }
  return { success: true, jobNumber: replayJob.job_number };
}

type VisitPlan = Pick<Tables<'maintenance_plans'>, 'id' | 'plan_number' | 'client_id' | 'site_id'>;
type VisitRevision = Pick<
  Tables<'maintenance_plan_revisions'>,
  'id' | 'template_version_id' | 'planned_duration_minutes' | 'operational_instructions'
>;

/**
 * The plans and revisions of the due items one visit covers, checked to share
 * one customer, site and template, with the visit's summed planned duration.
 */
export async function readVisitDueContext(
  context: ServiceManagerContext,
  dueWorkIds: string[],
): Promise<
  ActionResult<{
    plans: VisitPlan[];
    firstPlan: VisitPlan;
    firstRevision: VisitRevision;
    estimatedDurationMinutes: number;
  }>
> {
  const { data: dueRows, error: dueError } = await readInBatches(dueWorkIds, (batch) =>
    context.admin
      .from('maintenance_due_work')
      .select('id, maintenance_plan_id, maintenance_plan_revision_id, due_date')
      .eq('organization_id', context.organizationId)
      .in('id', [...batch]),
  );
  if (dueError) {
    return { success: false, error: 'maintenance_visit_context_failed' };
  }
  if (dueRows.length !== dueWorkIds.length) {
    return { success: false, error: 'maintenance_due_not_found' };
  }
  const planIds = [...new Set(dueRows.map((row) => row.maintenance_plan_id))];
  const revisionIds = [...new Set(dueRows.map((row) => row.maintenance_plan_revision_id))];
  const [plansResult, revisionsResult] = await Promise.all([
    readInBatches(planIds, (batch) =>
      context.admin
        .from('maintenance_plans')
        .select('id, plan_number, client_id, site_id')
        .eq('organization_id', context.organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(revisionIds, (batch) =>
      context.admin
        .from('maintenance_plan_revisions')
        .select('id, template_version_id, planned_duration_minutes, operational_instructions')
        .eq('organization_id', context.organizationId)
        .in('id', [...batch]),
    ),
  ]);
  if (plansResult.error || revisionsResult.error) {
    return { success: false, error: 'maintenance_visit_context_failed' };
  }
  const plans = plansResult.data;
  const revisions = revisionsResult.data;
  if (!plans.length || !revisions.length) {
    return { success: false, error: 'maintenance_visit_context_failed' };
  }
  const clientIds = new Set(plans.map((plan) => plan.client_id));
  const siteIds = new Set(plans.map((plan) => plan.site_id));
  const templateIds = new Set(revisions.map((revision) => revision.template_version_id));
  if (clientIds.size !== 1 || siteIds.size !== 1 || templateIds.size !== 1) {
    return { success: false, error: 'maintenance_due_batch_incompatible' };
  }
  const [firstPlan] = plans;
  const [firstRevision] = revisions;
  if (!firstPlan || !firstRevision) {
    return { success: false, error: 'maintenance_visit_context_failed' };
  }
  const durationByRevisionId = new Map(
    revisions.map((revision) => [revision.id, revision.planned_duration_minutes]),
  );
  const estimatedDurationMinutes = dueRows.reduce(
    (total, due) => total + (durationByRevisionId.get(due.maintenance_plan_revision_id) ?? 0),
    0,
  );
  if (dueRows.some((due) => !durationByRevisionId.has(due.maintenance_plan_revision_id))) {
    return { success: false, error: 'maintenance_visit_context_failed' };
  }
  if (estimatedDurationMinutes < 15 || estimatedDurationMinutes > 10_080) {
    return { success: false, error: 'maintenance_due_batch_incompatible' };
  }
  return { success: true, plans, firstPlan, firstRevision, estimatedDurationMinutes };
}

import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { FieldMaintenanceContext } from './types';

type DueRow = Tables<'maintenance_due_work'>;

/** The plans, revisions and revision equipment of the due items; null after logging a failed read. */
async function readFieldPlanSources(admin: AdminClient, organizationId: string, dueRows: DueRow[]) {
  const planIds = [...new Set(dueRows.map((row) => row.maintenance_plan_id))];
  const revisionIds = [...new Set(dueRows.map((row) => row.maintenance_plan_revision_id))];
  const [plansResult, revisionsResult, linksResult] = await Promise.all([
    readInBatches(planIds, (batch) =>
      admin
        .from('maintenance_plans')
        .select('id, plan_number')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(revisionIds, (batch) =>
      admin
        .from('maintenance_plan_revisions')
        .select('id, template_version_id, operational_instructions')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(revisionIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('maintenance_plan_revision_equipment')
            .select('maintenance_plan_revision_id, equipment_id')
            .eq('organization_id', organizationId)
            .in('maintenance_plan_revision_id', [...batch])
            .order('maintenance_plan_revision_id')
            .order('equipment_id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  const contextError = plansResult.error ?? revisionsResult.error ?? linksResult.error;
  if (contextError) {
    logReadFailure('getAssignedMaintenanceContextForJob: plan read failed', {
      code: contextError.code,
      message: contextError.message,
    });
    return null;
  }
  return { plans: plansResult.data, revisions: revisionsResult.data, links: linksResult.data };
}

type FieldPlanSources = NonNullable<Awaited<ReturnType<typeof readFieldPlanSources>>>;

/** The template versions and equipment the revisions name; null after logging a failed read. */
async function readFieldTemplatesAndEquipment(
  admin: AdminClient,
  organizationId: string,
  { revisions, links }: FieldPlanSources,
) {
  const [templatesResult, equipmentRowsResult] = await Promise.all([
    readInBatches(
      revisions.map((row) => row.template_version_id),
      (batch) =>
        admin
          .from('work_template_versions')
          .select('id, name, version_number')
          .eq('organization_id', organizationId)
          .in('id', [...batch]),
    ),
    readInBatches(
      links.map((row) => row.equipment_id),
      (batch) =>
        admin
          .from('installed_equipment')
          .select('id, equipment_number, name')
          .eq('organization_id', organizationId)
          .in('id', [...batch]),
    ),
  ]);
  const detailError = templatesResult.error ?? equipmentRowsResult.error;
  if (detailError) {
    logReadFailure('getAssignedMaintenanceContextForJob: template or equipment read failed', {
      code: detailError.code,
      message: detailError.message,
    });
    return null;
  }
  return { templates: templatesResult.data, equipmentRows: equipmentRowsResult.data };
}

type FieldTemplatesAndEquipment = NonNullable<Awaited<ReturnType<typeof readFieldTemplatesAndEquipment>>>;

function toFieldMaintenanceContexts(
  dueRows: DueRow[],
  { plans, revisions, links }: FieldPlanSources,
  { templates, equipmentRows }: FieldTemplatesAndEquipment,
): FieldMaintenanceContext[] {
  const plansById = new Map(plans.map((row) => [row.id, row]));
  const revisionsById = new Map(revisions.map((row) => [row.id, row]));
  const templatesById = new Map(templates.map((row) => [row.id, row]));
  const equipmentById = new Map(
    equipmentRows.map((row) => [
      row.id,
      { id: row.id, equipmentNumber: row.equipment_number, name: row.name },
    ]),
  );
  const equipmentIdsByRevision = new Map<string, string[]>();
  for (const link of links) {
    const ids = equipmentIdsByRevision.get(link.maintenance_plan_revision_id) ?? [];
    ids.push(link.equipment_id);
    equipmentIdsByRevision.set(link.maintenance_plan_revision_id, ids);
  }
  return dueRows.flatMap((due) => {
    const plan = plansById.get(due.maintenance_plan_id);
    const revision = revisionsById.get(due.maintenance_plan_revision_id);
    const template = revision ? templatesById.get(revision.template_version_id) : null;
    if (!plan || !revision || !template) return [];
    return [
      {
        planNumber: plan.plan_number,
        dueDate: due.due_date,
        windowStartDate: due.window_start_date,
        windowEndDate: due.window_end_date,
        templateName: template.name,
        templateVersionNumber: template.version_number,
        operationalInstructions: revision.operational_instructions,
        equipment: (equipmentIdsByRevision.get(revision.id) ?? []).flatMap((id) => {
          const item = equipmentById.get(id);
          return item ? [item] : [];
        }),
      },
    ];
  });
}

/**
 * The maintenance context of a job's due items: plan, template version,
 * instructions and equipment. The caller has authorized the job.
 */
export async function readFieldMaintenanceContexts(
  admin: AdminClient,
  organizationId: string,
  dueRows: DueRow[],
): Promise<ActionResult<{ contexts: FieldMaintenanceContext[] }>> {
  const planSources = await readFieldPlanSources(admin, organizationId, dueRows);
  if (!planSources) return { success: false, error: 'maintenance_context_load_failed' };
  const details = await readFieldTemplatesAndEquipment(admin, organizationId, planSources);
  if (!details) return { success: false, error: 'maintenance_context_load_failed' };
  return { success: true, contexts: toFieldMaintenanceContexts(dueRows, planSources, details) };
}

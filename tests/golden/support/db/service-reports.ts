import { randomUUID } from 'node:crypto';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { seedCustomer } from './customers';
import { seedInstalledEquipment, seedMaintenancePlan, seedMaintenanceVisitLink } from './service';
import { createAdminClient } from './shared';
import { seedJob, seedPublishedWorkTemplate, seedWorkReportDraft } from './work';

// A completed maintenance visit, the state „Servicebericht erstellen“ starts
// from: plan, visit job and its Arbeitsnachweis through the RPCs the actions
// call, then „Wartung abschließen“ as complete_maintenance_visit.

/**
 * One completed visit of a new customer `customerName` on `businessDate`,
 * its job numbered `jobNumber`. Returns the plan number the Wartung page shows.
 */
export async function seedCompletedMaintenanceVisit(input: {
  orgId: string;
  actorId: string;
  customerName: string;
  jobNumber: string;
  businessDate: string;
}): Promise<string> {
  const actor = { orgId: input.orgId, actorId: input.actorId };
  const site = `${input.customerName} Heizzentrale`;
  const customer = await seedCustomer({
    ...actor,
    name: input.customerName,
    clientType: 'gewerblich',
    sites: [{ name: site, street: 'Hofweg 1', postalCode: '10117', city: 'Berlin', isPrimary: true }],
  });
  const siteId = customer.siteIds.get(site);
  if (!siteId) throw new Error(`Seeded customer ${input.customerName} has no work site.`);
  const location = { clientId: customer.clientId, siteId };
  const equipment = await seedInstalledEquipment({ ...actor, ...location, name: 'Gas-Brennwertkessel' });
  const template = await seedPublishedWorkTemplate({
    ...actor,
    name: `${input.customerName} Heizungswartung`,
    targetType: 'job',
    items: [{ content: 'Anlage fachgerecht warten' }],
  });
  const plan = await seedMaintenancePlan({
    ...actor,
    ...location,
    templateVersionId: template.versionId,
    equipmentIds: [equipment.id],
    effectiveFromDate: input.businessDate,
    firstDueDate: input.businessDate,
    intervalMonths: 12,
    businessDate: input.businessDate,
  });
  const jobId = await seedJob({ ...actor, ...location, jobNumber: input.jobNumber, title: 'Wartungsbesuch' });
  await seedMaintenanceVisitLink({ ...actor, planId: plan.id, jobId });
  await seedWorkReportDraft({
    ...actor,
    jobId,
    title: 'Wartungsbericht',
    performedWork: 'Brenner geprüft und gereinigt, Abgaswerte in Ordnung.',
  });

  const admin = createAdminClient();
  const { data: evidence } = await admin
    .from('work_artifact_revisions')
    .select('id, work_artifacts!work_artifact_revisions_artifact_fkey!inner(job_id)')
    .eq('organization_id', input.orgId)
    .eq('work_artifacts.job_id', jobId)
    .single()
    .throwOnError();
  const { data: due } = await admin
    .from('maintenance_due_work')
    .select('id, version')
    .eq('organization_id', input.orgId)
    .eq('job_id', jobId)
    .single()
    .throwOnError();
  await admin
    .rpc(
      'complete_maintenance_visit',
      rpcArgs('complete_maintenance_visit', {
        p_organization_id: input.orgId,
        p_maintenance_due_work_id: due.id,
        p_expected_version: due.version,
        p_scope_outcome: 'complete',
        p_completed_on: input.businessDate,
        p_work_artifact_revision_ids: [evidence.id],
        p_reason: 'Wartung vollständig durchgeführt',
        p_defects: [],
        p_next_action: null,
        p_next_action_owner_id: null,
        p_next_action_target_date: null,
        p_next_action_note: null,
        p_actor_id: input.actorId,
        p_idempotency_key: randomUUID(),
      }),
    )
    .throwOnError();
  return plan.planNumber;
}

/** How many Serviceberichte the organization filed, each with its PDF document. */
export async function getFiledServiceReportCount(orgId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from('maintenance_service_reports')
    .select('id, documents!inner(id)', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('documents.mime_type', 'application/pdf')
    .throwOnError();
  return count ?? 0;
}

import { randomUUID } from 'node:crypto';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { seedCustomer } from './customers';
import { seedInstalledEquipment, seedMaintenancePlan, seedMaintenanceVisitLink } from './service';
import { createAdminClient, persisted, type Persisted } from './shared';
import { seedJob, seedPublishedWorkTemplate, seedWorkReportDraft } from './work';

// Maintenance visits through the RPCs the actions call: a visit job with its
// Arbeitsnachweis, ready for „Wartung abschließen“, and a completed visit,
// the state „Servicebericht erstellen“ starts from.

type SeedActor = { orgId: string; actorId: string };

/**
 * An Anlage on a plan whose first due item, on `businessDate`, has the visit
 * job `jobNumber` with a work report draft. Returns the job and plan.
 */
export async function seedMaintenanceVisitJob(
  input: SeedActor & {
    clientId: string;
    siteId: string;
    equipmentName: string;
    templateName: string;
    jobNumber: string;
    performedWork: string;
    businessDate: string;
  },
): Promise<{ jobId: string; planNumber: string }> {
  const actor = { orgId: input.orgId, actorId: input.actorId };
  const location = { clientId: input.clientId, siteId: input.siteId };
  const equipment = await seedInstalledEquipment({ ...actor, ...location, name: input.equipmentName });
  const template = await seedPublishedWorkTemplate({
    ...actor,
    name: input.templateName,
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
    performedWork: input.performedWork,
  });
  return { jobId, planNumber: plan.planNumber };
}

/**
 * One visit of a new customer `customerName`, completed on `businessDate`
 * with its work report as evidence. Returns the plan number the Wartung page
 * shows and the visit's due item.
 */
export async function seedCompletedMaintenanceVisit(
  input: SeedActor & { customerName: string; jobNumber: string; businessDate: string },
): Promise<{ planNumber: string; dueWorkId: string }> {
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
  const visit = await seedMaintenanceVisitJob({
    ...actor,
    clientId: customer.clientId,
    siteId,
    equipmentName: 'Gas-Brennwertkessel',
    templateName: `${input.customerName} Heizungswartung`,
    jobNumber: input.jobNumber,
    performedWork: 'Brenner geprüft und gereinigt, Abgaswerte in Ordnung.',
    businessDate: input.businessDate,
  });

  const admin = createAdminClient();
  const { data: evidence } = await admin
    .from('work_artifact_revisions')
    .select('id, work_artifacts!work_artifact_revisions_artifact_fkey!inner(job_id)')
    .eq('organization_id', input.orgId)
    .eq('work_artifacts.job_id', visit.jobId)
    .single()
    .throwOnError();
  const { data: due } = await admin
    .from('maintenance_due_work')
    .select('id, version')
    .eq('organization_id', input.orgId)
    .eq('job_id', visit.jobId)
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
  return { planNumber: visit.planNumber, dueWorkId: due.id };
}

/** The documents of a visit's Serviceberichte: their type and when they were filed. */
export async function getServiceReportDocuments(
  orgId: string,
  dueWorkId: string,
): Promise<Persisted<{ mimeType: string | null; filedAt: string | null }>[]> {
  const admin = createAdminClient();
  const { data: reports } = await admin
    .from('maintenance_service_reports')
    .select('document_id')
    .eq('organization_id', orgId)
    .eq('maintenance_due_work_id', dueWorkId)
    .throwOnError();
  if (reports.length === 0) return [];
  const { data: documents } = await admin
    .from('documents')
    .select('mime_type, filed_at')
    .eq('organization_id', orgId)
    .in(
      'id',
      reports.map((report) => report.document_id),
    )
    .throwOnError();
  return documents.map((document) => persisted({ mimeType: document.mime_type, filedAt: document.filed_at }));
}

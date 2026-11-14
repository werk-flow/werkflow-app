import 'server-only';

import { logReadErrors } from '@/lib/data/read-request-cache';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { z } from '@/lib/zod';
import type {
  EquipmentEvent,
  EquipmentEventLink,
  EquipmentPredecessorHistory,
  EquipmentReplacementPlan,
  EquipmentRow,
} from './types';

/** The equipment register's reads: the caller's organization and the service-role client. */
export type EquipmentReadContext = {
  organizationId: string;
  admin: ReturnType<typeof createSupabaseAdminClient>;
};

async function hydrateEventLinks(
  admin: EquipmentReadContext['admin'],
  organizationId: string,
  rows: EventLinkRow[],
): Promise<Map<string, EquipmentEventLink[]>> {
  const jobIds = rows.flatMap((row) => (row.job_id ? [row.job_id] : []));
  const projectIds = rows.flatMap((row) => (row.project_id ? [row.project_id] : []));
  const documentIds = rows.flatMap((row) => (row.document_id ? [row.document_id] : []));
  const [jobsResult, projectsResult, documentsResult] = await Promise.all([
    readInBatches(jobIds, (batch) =>
      admin
        .from('jobs')
        .select('id, job_number, title')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(projectIds, (batch) =>
      admin
        .from('projects')
        .select('id, project_number, name')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(documentIds, (batch) =>
      admin
        .from('documents')
        .select('id, display_name')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
  ]);
  const labelError = jobsResult.error ?? projectsResult.error ?? documentsResult.error;
  if (labelError) {
    logReadErrors('hydrateEventLinks: link label read failed', labelError);
    // Without the labels every link would read as an exact handover state.
    throw new Error('installed_equipment_event_links_failed');
  }
  const jobs = new Map(jobsResult.data.map((job) => [job.id, job]));
  const projects = new Map(projectsResult.data.map((project) => [project.id, project]));
  const documents = new Map(documentsResult.data.map((document) => [document.id, document]));
  const result = new Map<string, EquipmentEventLink[]>();
  for (const row of rows) {
    const job = row.job_id ? jobs.get(row.job_id) : null;
    const project = row.project_id ? projects.get(row.project_id) : null;
    const document = row.document_id ? documents.get(row.document_id) : null;
    const link: EquipmentEventLink = {
      id: row.id,
      jobId: row.job_id,
      projectId: row.project_id,
      workArtifactRevisionId: row.work_artifact_revision_id,
      workHandoverReleaseId: row.work_handover_release_id,
      documentId: row.document_id,
      documentVersionNumber: row.document_version_number,
      label: job
        ? `Auftrag ${job.job_number ?? job.title}`
        : project
          ? `Projekt ${project.project_number ?? project.name}`
          : document
            ? `${document.display_name}, Version ${row.document_version_number}`
            : row.work_artifact_revision_id
              ? 'Exakte Arbeitsnachweis-Revision'
              : 'Exakter Übergabestand',
      href: job
        ? `/auftraege/${encodeURIComponent(job.job_number ?? job.id)}`
        : project
          ? `/auftraege/projekt/${encodeURIComponent(project.project_number ?? project.id)}`
          : document
            ? `/dokumente?document=${encodeURIComponent(document.id)}`
            : null,
    };
    const links = result.get(row.event_id) ?? [];
    links.push(link);
    result.set(row.event_id, links);
  }
  return result;
}

type EquipmentEventRow = Database['public']['Tables']['installed_equipment_events']['Row'];
type EventLinkRow = Database['public']['Tables']['installed_equipment_event_links']['Row'];

/** The links of the given events; a failed read throws after logging. */
export async function readEquipmentEventLinkRows(
  context: EquipmentReadContext,
  eventRows: EquipmentEventRow[],
): Promise<EventLinkRow[]> {
  const eventLinksResult = await readInBatches(
    eventRows.map((event) => event.id),
    (batch) =>
      readCompleteRows(
        (from, to) =>
          context.admin
            .from('installed_equipment_event_links')
            .select('*')
            .eq('organization_id', context.organizationId)
            .in('event_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
  );
  if (eventLinksResult.error) {
    logReadErrors('getInstalledEquipmentDetailByNumber: event link read failed', eventLinksResult.error);
    throw new Error('installed_equipment_detail_failed');
  }
  return eventLinksResult.data;
}

const eventSubjectSchema = z.object({
  subject: z.object({
    maintenancePlanNumber: z.string().optional(),
    componentNumber: z.string().optional(),
  }),
});

/** The plan or component a carry-over event names in its snapshot, labelled for the history. */
function eventSubjectLabel(afterSnapshot: Json): string | null {
  const parsed = eventSubjectSchema.safeParse(afterSnapshot);
  if (!parsed.success) return null;
  const { maintenancePlanNumber, componentNumber } = parsed.data.subject;
  if (maintenancePlanNumber) return `Wartungsplan ${maintenancePlanNumber}`;
  return componentNumber ? `Komponente ${componentNumber}` : null;
}

/** The events with their actors named and their links hydrated; a failed read throws after logging. */
export async function loadEquipmentEvents(
  context: EquipmentReadContext,
  eventRows: EquipmentEventRow[],
  eventLinkRows: EventLinkRow[],
): Promise<EquipmentEvent[]> {
  const actorIds = [...new Set(eventRows.map((event) => event.actor_id))];
  const { data: actors, error: actorsError } = await readInBatches(actorIds, (batch) =>
    context.admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', [...batch]),
  );
  if (actorsError) {
    logReadErrors('getInstalledEquipmentDetailByNumber: actor read failed', actorsError);
    throw new Error('installed_equipment_detail_failed');
  }
  const actorNames = new Map(
    actors.map((actor) => [
      actor.id,
      [actor.first_name, actor.last_name].filter(Boolean).join(' ') || actor.email || 'Unbekannt',
    ]),
  );
  const eventLinks = await hydrateEventLinks(context.admin, context.organizationId, eventLinkRows);
  return eventRows.map((event) => ({
    id: event.id,
    eventType: event.event_type,
    fromState: event.from_state,
    toState: event.to_state,
    effectiveAt: event.effective_at,
    recordedAt: event.recorded_at,
    actorName: actorNames.get(event.actor_id) ?? 'Unbekannt',
    reason: event.reason,
    correctsEventId: event.corrects_event_id,
    siteSnapshot: event.site_snapshot,
    beforeSnapshot: event.before_snapshot,
    afterSnapshot: event.after_snapshot,
    subjectLabel: eventSubjectLabel(event.after_snapshot),
    links: eventLinks.get(event.id) ?? [],
  }));
}

const PREDECESSOR_HISTORY_PAGE_SIZE = 20;

/**
 * One page of the history of the equipment's predecessors, newest first, each
 * event named with the record it belongs to. A failed read throws after logging.
 */
export async function loadPredecessorHistory(
  context: EquipmentReadContext,
  row: Pick<EquipmentRow, 'id' | 'predecessor_equipment_id'>,
  offset: number,
): Promise<EquipmentPredecessorHistory> {
  if (!row.predecessor_equipment_id) return { events: [], nextOffset: null };
  const { data, error } = await context.admin.rpc('list_installed_equipment_predecessor_events', {
    p_organization_id: context.organizationId,
    p_equipment_id: row.id,
    p_offset: offset,
    p_limit: PREDECESSOR_HISTORY_PAGE_SIZE + 1,
  });
  if (error) {
    logReadErrors('loadPredecessorHistory: read failed', error);
    throw new Error('installed_equipment_detail_failed');
  }
  const eventRows = data.slice(0, PREDECESSOR_HISTORY_PAGE_SIZE);
  const recordIds = [...new Set(eventRows.map((event) => event.equipment_id))];
  const { data: records, error: recordsError } = await readInBatches(recordIds, (batch) =>
    context.admin
      .from('installed_equipment')
      .select('id, equipment_number, name')
      .eq('organization_id', context.organizationId)
      .in('id', [...batch]),
  );
  if (recordsError) {
    logReadErrors('loadPredecessorHistory: record read failed', recordsError);
    throw new Error('installed_equipment_detail_failed');
  }
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const eventLinkRows = await readEquipmentEventLinkRows(context, eventRows);
  const events = await loadEquipmentEvents(context, eventRows, eventLinkRows);
  return {
    events: events.flatMap((event, index) => {
      const record = recordsById.get(eventRows[index]?.equipment_id ?? '');
      return record
        ? [{ ...event, equipmentNumber: record.equipment_number, equipmentName: record.name }]
        : [];
    }),
    nextOffset: data.length > PREDECESSOR_HISTORY_PAGE_SIZE ? offset + PREDECESSOR_HISTORY_PAGE_SIZE : null,
  };
}

const replacementPlanRowsSchema = z.array(
  z.object({
    plan_id: z.string(),
    plan_number: z.string(),
    plan_version: z.number(),
    plan_status: z.enum(['draft', 'active', 'suspended']),
    template_name: z.string(),
    next_due_date: z.string().nullable(),
  }),
);

/** The running plans a replacement of this equipment asks about; none when it cannot be replaced. */
export async function loadReplacementPlans(
  context: EquipmentReadContext,
  row: EquipmentRow,
): Promise<EquipmentReplacementPlan[]> {
  if (!['active', 'inactive'].includes(row.state) || row.archived_at || row.voided_at) return [];
  const { data, error } = await context.admin.rpc('list_installed_equipment_replacement_plans', {
    p_organization_id: context.organizationId,
    p_equipment_id: row.id,
  });
  const parsed = replacementPlanRowsSchema.safeParse(data);
  if (error || !parsed.success) {
    logReadErrors('loadReplacementPlans: read failed', error ?? { code: 'unexpected_row_shape' });
    throw new Error('installed_equipment_detail_failed');
  }
  return parsed.data.map((plan) => ({
    id: plan.plan_id,
    planNumber: plan.plan_number,
    version: plan.plan_version,
    status: plan.plan_status,
    templateName: plan.template_name,
    nextDueDate: plan.next_due_date,
  }));
}

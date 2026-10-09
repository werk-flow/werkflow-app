'use server';

import { revalidatePath } from 'next/cache';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { logReadFailure, loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { compareRecordNumbers } from '@/lib/format/record-number';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { toJson } from '@/lib/supabase/json';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { loadListItems } from './list-page-server';
import {
  equipmentArchiveSchema,
  equipmentCreateSchema,
  equipmentCorrectionSchema,
  equipmentTransitionSchema,
  equipmentUpdateSchema,
  equipmentReplacementSchema,
  equipmentSourceSchema,
  equipmentWorkLinkSchema,
} from './validation';
import type {
  EquipmentArchiveInput,
  EquipmentCreateInput,
  EquipmentCorrectionInput,
  EquipmentDetail,
  EquipmentDetailResult,
  EquipmentEvent,
  EquipmentEventLink,
  EquipmentFieldProjection,
  EquipmentListItem,
  EquipmentMutationResult,
  EquipmentReplacementInput,
  EquipmentSourceInput,
  EquipmentRow,
  EquipmentTransitionInput,
  EquipmentUpdateInput,
  EquipmentWorkLink,
  EquipmentWorkLinkInput,
} from './types';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

const equipmentNumberSchema = z.string().trim().min(1).max(100);

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type ManagerContext = {
  organizationId: string;
  userId: string;
  admin: AdminClient;
};

const EQUIPMENT_ERROR_CODES = [
  'installed_equipment_not_authorized',
  'installed_equipment_not_found',
  'installed_equipment_site_invalid',
  'installed_equipment_parent_invalid',
  'installed_equipment_predecessor_invalid',
  'installed_equipment_classification_invalid',
  'installed_equipment_subtype_category_mismatch',
  'installed_equipment_identifier_type_invalid',
  'installed_equipment_identifier_value_required',
  'installed_equipment_identifiers_invalid',
  'installed_equipment_stale_version',
  'installed_equipment_reason_required',
  'installed_equipment_transition_not_allowed',
  'installed_equipment_use_replace_action',
  'installed_equipment_archived',
  'installed_equipment_voided',
  'installed_equipment_replace_not_allowed',
  'installed_equipment_successor_state_invalid',
  'installed_equipment_archive_not_allowed',
  'installed_equipment_archive_state_unchanged',
  'installed_equipment_idempotency_conflict',
  'installed_equipment_correction_target_invalid',
  'installed_equipment_successor_not_found',
  'installed_equipment_successor_origin_invalid',
  'installed_equipment_work_target_invalid',
  'installed_equipment_job_target_invalid',
  'installed_equipment_project_target_invalid',
  'installed_equipment_initial_state_invalid',
  'installed_equipment_source_target_invalid',
  'installed_equipment_replacement_cycle',
  'installed_equipment_document_version_invalid',
  'installed_equipment_document_link_not_found',
] as const;

function mapEquipmentError(error: { message?: string; code?: string } | null): string {
  if (error?.code === '23505') return 'installed_equipment_duplicate_identifier';
  return (
    EQUIPMENT_ERROR_CODES.find((code) => error?.message?.includes(code)) ??
    'installed_equipment_action_failed'
  );
}

async function requireEquipmentManager(): Promise<ManagerContext | ActionFailure> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  return {
    organizationId: auth.context.orgId,
    userId: auth.context.userId,
    admin: createSupabaseAdminClient(),
  };
}

function revalidateEquipment(): void {
  revalidatePath('/service', 'layout');
  revalidatePath('/kunden', 'layout');
  revalidatePath('/auftraege', 'layout');
  revalidatePath('/dokumente', 'layout');
}

async function hydrateEventLinks(
  admin: AdminClient,
  organizationId: string,
  rows: Database['public']['Tables']['installed_equipment_event_links']['Row'][],
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

export async function getInstalledEquipmentDetailByNumber(
  rawEquipmentNumber: string,
): Promise<EquipmentDetailResult> {
  const parsedNumber = equipmentNumberSchema.safeParse(rawEquipmentNumber);
  if (!parsedNumber.success) return { success: false, error: 'installed_equipment_not_found' };
  const equipmentNumber = parsedNumber.data;
  const context = await requireEquipmentManager();
  if ('success' in context) return context;
  const { data: row, error } = await context.admin
    .from('installed_equipment')
    .select('*')
    .eq('organization_id', context.organizationId)
    .eq('equipment_number', equipmentNumber.toUpperCase())
    .maybeSingle();
  if (error) {
    logReadErrors('getInstalledEquipmentDetailByNumber: read failed', error);
    return { success: false, error: 'installed_equipment_load_failed' };
  }
  if (!row) return { success: false, error: 'installed_equipment_not_found' };
  try {
    return { success: true, equipment: await loadEquipmentDetail(context, row) };
  } catch {
    return { success: false, error: 'installed_equipment_load_failed' };
  }
}

/** The job and project links of one equipment, labelled; a failed label read throws instead of dropping links. */
async function loadEquipmentWorkLinks(
  context: ManagerContext,
  workRows: Database['public']['Tables']['installed_equipment_work_links']['Row'][],
): Promise<EquipmentWorkLink[]> {
  const jobIds = workRows.flatMap((link) => (link.job_id ? [link.job_id] : []));
  const projectIds = workRows.flatMap((link) => (link.project_id ? [link.project_id] : []));
  const [jobsResult, projectsResult] = await Promise.all([
    readInBatches(jobIds, (batch) =>
      context.admin
        .from('jobs')
        .select('id, job_number, title')
        .eq('organization_id', context.organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(projectIds, (batch) =>
      context.admin
        .from('projects')
        .select('id, project_number, name')
        .eq('organization_id', context.organizationId)
        .in('id', [...batch]),
    ),
  ]);
  const workLabelError = jobsResult.error ?? projectsResult.error;
  if (workLabelError) {
    logReadErrors('getInstalledEquipmentDetailByNumber: work link label read failed', workLabelError);
    throw new Error('installed_equipment_detail_failed');
  }
  const jobs = new Map(jobsResult.data.map((job) => [job.id, job]));
  const projects = new Map(projectsResult.data.map((project) => [project.id, project]));
  return workRows.flatMap((link): EquipmentWorkLink[] => {
    const job = link.job_id ? jobs.get(link.job_id) : null;
    const project = link.project_id ? projects.get(link.project_id) : null;
    if (job)
      return [
        {
          id: link.id,
          jobId: job.id,
          projectId: null,
          label: `Auftrag ${job.job_number ?? job.title}`,
          href: `/auftraege/${encodeURIComponent(job.job_number ?? job.id)}`,
        },
      ];
    if (project)
      return [
        {
          id: link.id,
          jobId: null,
          projectId: project.id,
          label: `Projekt ${project.project_number ?? project.name}`,
          href: `/auftraege/projekt/${encodeURIComponent(project.project_number ?? project.id)}`,
        },
      ];
    return [];
  });
}

/** Every related read of one equipment detail; a failed read throws after logging, never an empty section. */
async function loadEquipmentDetail(context: ManagerContext, row: EquipmentRow): Promise<EquipmentDetail> {
  const [relatedRowsResult, eventsResult, workLinksResult] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        context.admin
          .from('installed_equipment')
          .select('*')
          .eq('organization_id', context.organizationId)
          .or(
            `id.eq.${row.parent_equipment_id ?? row.id},parent_equipment_id.eq.${row.id},id.eq.${row.predecessor_equipment_id ?? row.id},predecessor_equipment_id.eq.${row.id}`,
          )
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        context.admin
          .from('installed_equipment_events')
          .select('*')
          .eq('organization_id', context.organizationId)
          .eq('equipment_id', row.id)
          .order('effective_at', { ascending: false })
          .order('recorded_at', { ascending: false })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        context.admin
          .from('installed_equipment_work_links')
          .select('*')
          .eq('organization_id', context.organizationId)
          .eq('equipment_id', row.id)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);
  const detailError = relatedRowsResult.error ?? eventsResult.error ?? workLinksResult.error;
  if (detailError) {
    logReadErrors('getInstalledEquipmentDetailByNumber: read failed', detailError);
    throw new Error('installed_equipment_detail_failed');
  }
  const eventLinksResult = await readInBatches(
    eventsResult.data.map((event) => event.id),
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
  const allRows = [row, ...relatedRowsResult.data.filter((related) => related.id !== row.id)];
  const items = await loadListItems(context.admin, context.organizationId, allRows);
  const current = items.find((item) => item.id === row.id);
  if (!current) throw new Error('installed_equipment_detail_failed');

  const actorIds = [...new Set(eventsResult.data.map((event) => event.actor_id))];
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
  const eventLinks = await hydrateEventLinks(context.admin, context.organizationId, eventLinksResult.data);
  const events: EquipmentEvent[] = eventsResult.data.map((event) => ({
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
    links: eventLinks.get(event.id) ?? [],
  }));

  const workLinks = await loadEquipmentWorkLinks(context, workLinksResult.data);

  const detail: EquipmentDetail = {
    ...current,
    technicalNotes: row.technical_notes,
    installationDate: row.installation_date,
    commissioningDate: row.commissioning_date,
    warrantyProvider: row.warranty_provider,
    warrantyBasis: row.warranty_basis,
    warrantyStartDate: row.warranty_start_date,
    warrantyEndDate: row.warranty_end_date,
    parent: items.find((item) => item.id === row.parent_equipment_id) ?? null,
    predecessor: items.find((item) => item.id === row.predecessor_equipment_id) ?? null,
    successor:
      items.find(
        (item) =>
          item.voidedAt === null &&
          item.parentEquipmentId !== row.id &&
          allRows.find((related) => related.id === item.id)?.predecessor_equipment_id === row.id,
      ) ?? null,
    components: items.filter((item) => item.parentEquipmentId === row.id),
    events,
    workLinks,
  };
  return detail;
}

export async function getInstalledEquipmentForClient(
  rawClientId: string,
): Promise<ActionResult<{ equipment: EquipmentListItem[] }>> {
  const parsedClientId = uuidSchema.safeParse(rawClientId);
  if (!parsedClientId.success) return { success: false, error: 'installed_equipment_input_invalid' };
  const clientId = parsedClientId.data;
  const context = await requireEquipmentManager();
  if ('success' in context) return context;
  const { data, error } = await readCompleteRows(
    (from, to) =>
      context.admin
        .from('installed_equipment')
        .select('*')
        .eq('organization_id', context.organizationId)
        .eq('client_id', clientId)
        .is('voided_at', null)
        .order('equipment_number')
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logReadFailure('getInstalledEquipmentForClient: equipment read failed', {
      code: error.code,
      message: error.message,
    });
    return { success: false, error: 'installed_equipment_load_failed' };
  }
  try {
    return {
      success: true,
      equipment: await loadListItems(
        context.admin,
        context.organizationId,
        data.toSorted((left, right) => compareRecordNumbers(left.equipment_number, right.equipment_number)),
      ),
    };
  } catch {
    return { success: false, error: 'installed_equipment_load_failed' };
  }
}

export async function getAssignedEquipmentForJob(
  rawJobId: string,
): Promise<ActionResult<{ equipment: EquipmentFieldProjection[] }>> {
  const parsedJobId = uuidSchema.safeParse(rawJobId);
  if (!parsedJobId.success) return { success: false, error: 'not_authorized' };
  const jobId = parsedJobId.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  // A failed job or assignment read is a load failure, never a refusal.
  const { data: job, error: jobError } = await loggedRead(
    'getAssignedEquipmentForJob: jobs read failed',
    admin.from('jobs').select('id').eq('id', jobId).eq('organization_id', auth.context.orgId).maybeSingle(),
  );
  if (jobError) return { success: false, error: 'installed_equipment_load_failed' };
  if (!job) return { success: false, error: 'not_authorized' };
  if (!auth.context.isManagerOrAbove) {
    const { data: assignment, error: assignmentError } = await loggedRead(
      'getAssignedEquipmentForJob: job_assignments read failed',
      admin
        .from('job_assignments')
        .select('id')
        .eq('organization_id', auth.context.orgId)
        .eq('job_id', jobId)
        .eq('user_id', auth.context.userId)
        .maybeSingle(),
    );
    if (assignmentError) return { success: false, error: 'installed_equipment_load_failed' };
    if (!assignment) return { success: false, error: 'not_authorized' };
  }
  const { data: links, error: linksError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('installed_equipment_work_links')
        .select('equipment_id')
        .eq('organization_id', auth.context.orgId)
        .eq('job_id', jobId)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (linksError) {
    logReadErrors('getAssignedEquipmentForJob: read failed', linksError);
    return { success: false, error: 'installed_equipment_load_failed' };
  }
  const ids = links.map((link) => link.equipment_id);
  const { data, error } = await readInBatches(ids, (batch) =>
    admin
      .from('installed_equipment')
      .select('id, equipment_number, name, category, subtype, state, manufacturer, model, location_detail')
      .eq('organization_id', auth.context.orgId)
      .is('voided_at', null)
      .in('id', [...batch]),
  );
  if (error) {
    logReadErrors('getAssignedEquipmentForJob: read failed', error);
    return { success: false, error: 'installed_equipment_load_failed' };
  }
  return {
    success: true,
    // Batched reads carry no order; the list sorts by record number like the others.
    equipment: data
      .toSorted((left, right) => compareRecordNumbers(left.equipment_number, right.equipment_number))
      .map((row) => ({
        id: row.id,
        equipmentNumber: row.equipment_number,
        name: row.name,
        category: row.category,
        subtype: row.subtype,
        state: row.state,
        manufacturer: row.manufacturer,
        model: row.model,
        locationDetail: row.location_detail,
      })),
  };
}

export async function createInstalledEquipment(
  input: EquipmentCreateInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentCreateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'installed_equipment_input_invalid' };
  const context = await requireEquipmentManager();
  if ('success' in context) return context;
  const { data, error } = await context.admin.rpc('create_installed_equipment', {
    p_organization_id: context.organizationId,
    p_equipment_id: parsed.data.equipmentId,
    p_payload: toJson(parsed.data),
    p_actor_id: context.userId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !data) return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment();
  return { success: true, equipment: data };
}

export async function updateInstalledEquipment(
  input: EquipmentUpdateInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentUpdateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'installed_equipment_input_invalid' };
  const context = await requireEquipmentManager();
  if ('success' in context) return context;
  const { data, error } = await context.admin.rpc('update_installed_equipment_details', {
    p_organization_id: context.organizationId,
    p_equipment_id: parsed.data.equipmentId,
    p_expected_version: parsed.data.expectedVersion,
    p_payload: toJson(parsed.data),
    p_actor_id: context.userId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !data) return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment();
  return { success: true, equipment: data };
}

export async function transitionInstalledEquipment(
  input: EquipmentTransitionInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentTransitionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'installed_equipment_input_invalid' };
  const context = await requireEquipmentManager();
  if ('success' in context) return context;
  const { data, error } = await context.admin.rpc('transition_installed_equipment', {
    p_organization_id: context.organizationId,
    p_equipment_id: parsed.data.equipmentId,
    p_expected_version: parsed.data.expectedVersion,
    p_to_state: parsed.data.toState,
    p_effective_at: parsed.data.effectiveAt,
    p_reason: parsed.data.reason,
    p_actor_id: context.userId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !data) return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment();
  return { success: true, equipment: data };
}

export async function setInstalledEquipmentArchived(
  input: EquipmentArchiveInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentArchiveSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'installed_equipment_input_invalid' };
  const context = await requireEquipmentManager();
  if ('success' in context) return context;
  const { data, error } = await context.admin.rpc('set_installed_equipment_archived', {
    p_organization_id: context.organizationId,
    p_equipment_id: parsed.data.equipmentId,
    p_expected_version: parsed.data.expectedVersion,
    p_archived: parsed.data.archived,
    p_reason: parsed.data.reason,
    p_actor_id: context.userId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !data) return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment();
  return { success: true, equipment: data };
}

export async function replaceInstalledEquipment(
  input: EquipmentReplacementInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentReplacementSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'installed_equipment_input_invalid' };
  const context = await requireEquipmentManager();
  if ('success' in context) return context;
  const { data, error } = await context.admin.rpc('replace_installed_equipment', {
    p_organization_id: context.organizationId,
    p_predecessor_id: parsed.data.predecessorId,
    p_successor_id: parsed.data.successorId,
    p_expected_version: parsed.data.expectedVersion,
    p_successor_payload: toJson(parsed.data),
    p_effective_at: parsed.data.effectiveAt,
    p_reason: parsed.data.reason,
    p_actor_id: context.userId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !data) return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment();
  return { success: true, equipment: data };
}

export async function correctInstalledEquipmentTerminalAction(
  input: EquipmentCorrectionInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentCorrectionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'installed_equipment_input_invalid' };
  const context = await requireEquipmentManager();
  if ('success' in context) return context;
  const { data, error } = await context.admin.rpc('correct_installed_equipment_terminal_action', {
    p_organization_id: context.organizationId,
    p_equipment_id: parsed.data.equipmentId,
    p_expected_version: parsed.data.expectedVersion,
    p_corrects_event_id: parsed.data.correctsEventId,
    p_effective_at: parsed.data.effectiveAt,
    p_reason: parsed.data.reason,
    p_actor_id: context.userId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !data) return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment();
  return { success: true, equipment: data };
}

export async function setInstalledEquipmentWorkLink(
  input: EquipmentWorkLinkInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentWorkLinkSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'installed_equipment_input_invalid' };
  const context = await requireEquipmentManager();
  if ('success' in context) return context;
  const { data, error } = await context.admin.rpc(
    'set_installed_equipment_work_link',
    rpcArgs('set_installed_equipment_work_link', {
      p_organization_id: context.organizationId,
      p_equipment_id: parsed.data.equipmentId,
      p_expected_version: parsed.data.expectedVersion,
      p_job_id: parsed.data.jobId ?? null,
      p_project_id: parsed.data.projectId ?? null,
      p_linked: parsed.data.linked,
      p_reason: parsed.data.reason ?? '',
      p_actor_id: context.userId,
      p_idempotency_key: parsed.data.idempotencyKey,
    }),
  );
  if (error || !data) return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment();
  return { success: true, equipment: data };
}

export async function linkInstalledEquipmentSource(
  input: EquipmentSourceInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentSourceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'installed_equipment_input_invalid' };
  const context = await requireEquipmentManager();
  if ('success' in context) return context;
  let documentStoragePath: string | null = null;
  if (parsed.data.targetType === 'document') {
    const versionNumber = parsed.data.documentVersionNumber;
    if (!versionNumber) return { success: false, error: 'installed_equipment_input_invalid' };
    const { data: document, error: documentError } = await context.admin
      .from('documents')
      .select('current_version_number, storage_path, deleted_at')
      .eq('id', parsed.data.targetId)
      .eq('organization_id', context.organizationId)
      .maybeSingle();
    if (documentError || !document || document.deleted_at) {
      return {
        success: false,
        error: 'installed_equipment_source_target_invalid',
      };
    }
    if (document.current_version_number === versionNumber) {
      documentStoragePath = document.storage_path;
    } else {
      const { data: version, error: versionError } = await context.admin
        .from('document_versions')
        .select('storage_path')
        .eq('document_id', parsed.data.targetId)
        .eq('organization_id', context.organizationId)
        .eq('version_number', versionNumber)
        .maybeSingle();
      if (versionError || !version) {
        return {
          success: false,
          error: 'installed_equipment_document_version_invalid',
        };
      }
      documentStoragePath = version.storage_path;
    }
  }
  const { data, error } = await context.admin.rpc('link_installed_equipment_source', {
    p_organization_id: context.organizationId,
    p_equipment_id: parsed.data.equipmentId,
    p_expected_version: parsed.data.expectedVersion,
    p_source: toJson({
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      documentVersionNumber: parsed.data.documentVersionNumber,
      documentStoragePath,
    }),
    p_reason: parsed.data.reason,
    p_actor_id: context.userId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !data) return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment();
  return { success: true, equipment: data };
}

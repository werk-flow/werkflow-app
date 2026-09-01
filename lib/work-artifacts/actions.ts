'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';

import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { authorizeResponsibilityForTarget } from '@/lib/responsibilities/server';
import type { OrgRole } from '@/lib/responsibilities/types';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/database.types';
import { deleteStorageObjects, putStorageObject } from '@/lib/storage/r2';
import { DOCUMENT_STORAGE_BUCKET } from '@/lib/documents/types';
import { saveWorkArtifactSchema, voidWorkArtifactSchema, workArtifactActionSchema } from './validation';
import { buildWorkArtifactExport } from './export';
import { redactWorkArtifactActionForField } from './field-visibility';
import type {
  SaveWorkArtifactInput, WorkArtifactActionInput, WorkArtifactDetail,
  WorkArtifactActionType, WorkArtifactMutationResult, WorkArtifactStatus, WorkArtifactSummary,
} from './types';

type Failure = { success: false; error: string };
type Target = { targetType: 'job' | 'project'; targetId: string };

const FIELD_DISCLOSING_ARTIFACT_ACTIONS = new Set<WorkArtifactActionType>([
  'review_requested',
  'internal_approved',
  'internal_rejected',
  'correction_requested',
  'customer_acknowledged',
  'customer_refused',
  'customer_reserved',
  'signature_captured',
  'voided',
]);

function revalidateArtifacts(organizationId: string): void {
  updateTag(CACHE_TAGS.jobs(organizationId));
  updateTag(CACHE_TAGS.projects(organizationId));
  updateTag(CACHE_TAGS.documents(organizationId));
  updateTag(CACHE_TAGS.responsibilities(organizationId));
  revalidatePath('/auftraege', 'layout');
  revalidatePath('/aufgaben', 'layout');
  revalidatePath('/dokumente', 'layout');
}

function mapArtifactError(error: { message?: string } | null): string {
  const known = [
    'work_artifact_not_authorized', 'work_artifact_stale_version',
    'work_artifact_correction_reason_required', 'work_artifact_self_approval_not_allowed',
    'work_artifact_not_responsible', 'work_artifact_review_not_pending',
    'work_artifact_customer_action_requires_customer_visibility',
    'work_artifact_defect_closure_proof_required', 'work_artifact_is_voided',
    'instruction_evidence_already_fulfilled', 'instruction_evidence_not_authorized',
  ].find((code) => error?.message?.includes(code));
  return known ?? 'work_artifact_action_failed';
}

async function authorizeTarget(
  context: Awaited<ReturnType<typeof authenticateAndAuthorize>> & { success: true },
  target: Target
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  if (target.targetType === 'job') {
    const { data: job } = await admin.from('jobs').select('id').eq('id', target.targetId)
      .eq('organization_id', context.context.orgId).maybeSingle();
    if (!job) return false;
    if (context.context.isManagerOrAbove) return true;
    const { data: assignment } = await admin.from('job_assignments').select('id')
      .eq('job_id', target.targetId).eq('user_id', context.context.userId).maybeSingle();
    return Boolean(assignment);
  }
  const { data: project } = await admin.from('projects').select('id').eq('id', target.targetId)
    .eq('organization_id', context.context.orgId).maybeSingle();
  if (!project) return false;
  if (context.context.isManagerOrAbove) return true;
  const { data: assignedJob } = await admin.from('jobs').select('job_assignments!inner(id)')
    .eq('project_id', target.targetId).eq('organization_id', context.context.orgId)
    .eq('job_assignments.user_id', context.context.userId).limit(1).maybeSingle();
  return Boolean(assignedJob);
}

export async function getWorkArtifacts(target: Target): Promise<
  { success: true; artifacts: WorkArtifactSummary[] } | Failure
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!await authorizeTarget(auth, target)) return { success: false, error: 'not_authorized' };
  const admin = createSupabaseAdminClient();
  const targetColumn = target.targetType === 'job' ? 'job_id' : 'project_id';
  const { data: artifacts, error } = await admin.from('work_artifacts').select('*')
    .eq('organization_id', auth.context.orgId).eq(targetColumn, target.targetId)
    .order('updated_at', { ascending: false }).limit(100);
  if (error) return { success: false, error: 'work_artifacts_load_failed' };
  const revisionIds = (artifacts ?? []).flatMap((artifact) => artifact.current_revision_id ? [artifact.current_revision_id] : []);
  const revisionsResult = revisionIds.length > 0
    ? await admin.from('work_artifact_revisions').select('*').in('id', revisionIds)
    : { data: [], error: null };
  if (revisionsResult.error) return { success: false, error: 'work_artifacts_load_failed' };
  const revisionById = new Map((revisionsResult.data ?? []).map((revision) => [revision.id, revision]));
  return {
    success: true,
    artifacts: (artifacts ?? []).flatMap((artifact) => {
      const revision = artifact.current_revision_id ? revisionById.get(artifact.current_revision_id) : null;
      if (!revision) return [];
      const isHiddenCoworkerDraft = !auth.context.isManagerOrAbove
        && artifact.status === 'draft'
        && revision.visibility === 'internal_only'
        && revision.created_by !== auth.context.userId;
      return isHiddenCoworkerDraft ? [] : [{ ...artifact, currentRevision: revision }];
    }),
  };
}

export async function getWorkArtifactDetail(artifactId: string): Promise<
  { success: true; artifact: WorkArtifactDetail } | Failure
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data: artifact } = await admin.from('work_artifacts').select('*').eq('id', artifactId)
    .eq('organization_id', auth.context.orgId).maybeSingle();
  if (!artifact) return { success: false, error: 'work_artifact_not_found' };
  const target: Target = artifact.job_id
    ? { targetType: 'job', targetId: artifact.job_id }
    : { targetType: 'project', targetId: artifact.project_id! };
  if (!await authorizeTarget(auth, target)) return { success: false, error: 'not_authorized' };
  if (!auth.context.isManagerOrAbove && artifact.status === 'draft' && artifact.current_revision_id) {
    const { data: currentRevision, error: currentRevisionError } = await admin.from('work_artifact_revisions')
      .select('visibility, created_by').eq('id', artifact.current_revision_id).maybeSingle();
    if (currentRevisionError || !currentRevision) {
      return { success: false, error: 'work_artifact_load_failed' };
    }
    if (currentRevision?.visibility === 'internal_only'
      && currentRevision.created_by !== auth.context.userId) {
      return { success: false, error: 'not_authorized' };
    }
  }
  const [revisions, actions, lines, defects, changes, documents, sources] = await Promise.all([
    admin.from('work_artifact_revisions').select('*').eq('artifact_id', artifactId)
      .order('revision_number', { ascending: false }),
    admin.from('work_artifact_actions').select('*').eq('artifact_id', artifactId)
      .order('created_at', { ascending: false }),
    admin.from('work_artifact_measurement_lines').select('*, work_artifact_revisions!inner(artifact_id)')
      .eq('work_artifact_revisions.artifact_id', artifactId).order('line_number'),
    admin.from('work_artifact_defect_details').select('*, work_artifact_revisions!inner(artifact_id)')
      .eq('work_artifact_revisions.artifact_id', artifactId),
    admin.from('work_artifact_change_details').select('*, work_artifact_revisions!inner(artifact_id)')
      .eq('work_artifact_revisions.artifact_id', artifactId),
    admin.from('work_artifact_revision_documents').select('*, work_artifact_revisions!inner(artifact_id)')
      .eq('work_artifact_revisions.artifact_id', artifactId).order('created_at'),
    admin.from('work_artifact_revision_sources').select('*, work_artifact_revisions!inner(artifact_id)')
      .eq('work_artifact_revisions.artifact_id', artifactId).order('created_at'),
  ]);
  if ([revisions, actions, lines, defects, changes, documents, sources].some((result) => result.error)) {
    return { success: false, error: 'work_artifact_load_failed' };
  }
  const disclosedRevisionIds = new Set(
    (actions.data ?? [])
      .filter((action) => FIELD_DISCLOSING_ARTIFACT_ACTIONS.has(action.action_type))
      .map((action) => action.revision_id)
  );
  const visibleRevisions = auth.context.isManagerOrAbove
    ? revisions.data ?? []
    : (revisions.data ?? []).filter((revision) =>
        revision.visibility !== 'internal_only'
        || revision.created_by === auth.context.userId
        || disclosedRevisionIds.has(revision.id)
      );
  const visibleRevisionIds = new Set(visibleRevisions.map((revision) => revision.id));
  const visibleActions = (actions.data ?? []).filter(
    (action) => auth.context.isManagerOrAbove || visibleRevisionIds.has(action.revision_id)
  );
  const onlyVisibleRevisionRows = <T extends { revision_id: string }>(rows: T[]): T[] =>
    auth.context.isManagerOrAbove
      ? rows
      : rows.filter((row) => visibleRevisionIds.has(row.revision_id));
  const stripJoin = <T extends object>(rows: T[]): T[] => rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'work_artifact_revisions')) as T
  );
  return {
    success: true,
    artifact: {
      ...artifact,
      revisions: visibleRevisions.map((revision) =>
        revision.corrects_revision_id && !visibleRevisionIds.has(revision.corrects_revision_id)
          ? { ...revision, corrects_revision_id: null }
          : revision
      ),
      actions: auth.context.isManagerOrAbove
        ? visibleActions
        : visibleActions.map((action) =>
            redactWorkArtifactActionForField(action, auth.context.userId)
          ),
      measurementLines: stripJoin(onlyVisibleRevisionRows(lines.data ?? [])),
      defectDetails: stripJoin(onlyVisibleRevisionRows(defects.data ?? [])),
      changeDetails: stripJoin(onlyVisibleRevisionRows(changes.data ?? [])),
      documents: stripJoin(onlyVisibleRevisionRows(documents.data ?? [])),
      sources: stripJoin(onlyVisibleRevisionRows(sources.data ?? [])),
    },
  };
}

export async function saveWorkArtifact(input: SaveWorkArtifactInput): Promise<WorkArtifactMutationResult> {
  const parsed = saveWorkArtifactSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!await authorizeTarget(auth, parsed.data)) return { success: false, error: 'not_authorized' };
  const content = {
    ...parsed.data.content,
    measurementLines: parsed.data.content.measurementLines?.map((line) => ({
      ...line, quantity: line.quantity.replace(',', '.'),
    })),
  } as Json;
  const admin = createSupabaseAdminClient();
  const args = {
    p_organization_id: auth.context.orgId, p_actor_id: auth.context.userId,
    p_artifact_id: parsed.data.artifactId, p_revision_id: parsed.data.revisionId,
    p_expected_version: parsed.data.expectedVersion ?? 0,
    p_job_id: parsed.data.targetType === 'job' ? parsed.data.targetId : null,
    p_project_id: parsed.data.targetType === 'project' ? parsed.data.targetId : null,
    p_kind: parsed.data.kind, p_visibility: parsed.data.visibility,
    p_captured_at: parsed.data.capturedAt, p_title: parsed.data.title,
    p_content: content, p_corrects_revision_id: parsed.data.correctsRevisionId ?? null,
    p_correction_reason: parsed.data.correctionReason ?? null,
    p_submit: parsed.data.submit, p_submit_action_id: parsed.data.submitActionId ?? null,
  } as unknown as Database['public']['Functions']['create_work_artifact_revision']['Args'];
  const { data, error } = await admin.rpc('create_work_artifact_revision', args);
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, error: mapArtifactError(error) };
  }
  const result = data as Record<string, Json | undefined>;
  revalidateArtifacts(auth.context.orgId);
  return { success: true, artifactId: parsed.data.artifactId,
    version: Number(result.version), status: String(result.status) as WorkArtifactStatus, data };
}

export async function recordWorkArtifactAction(input: WorkArtifactActionInput): Promise<WorkArtifactMutationResult> {
  const parsed = workArtifactActionSchema.safeParse(input);
  if (!parsed.success || parsed.data.actionType === 'voided') return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  let responsibilitySnapshot: Json | null = null;
  if (['internal_approved', 'internal_rejected', 'correction_requested'].includes(parsed.data.actionType)) {
    const { data: revision } = await admin.from('work_artifact_revisions').select('created_by')
      .eq('id', parsed.data.revisionId).eq('organization_id', auth.context.orgId).maybeSingle();
    if (!revision) return { success: false, error: 'work_artifact_not_found' };
    const { data: membership } = await admin.from('organization_members').select('role')
      .eq('organization_id', auth.context.orgId).eq('user_id', revision.created_by).maybeSingle();
    if (!membership) return { success: false, error: 'work_artifact_author_not_active' };
    const approval = await authorizeResponsibilityForTarget({ organizationId: auth.context.orgId,
      responsibility: 'work_artifact_approval', actorUserId: auth.context.userId,
      targetUserId: revision.created_by, targetRole: membership.role as OrgRole });
    if (!approval.success) return { success: false, error: approval.error };
    responsibilitySnapshot = { responsibility: 'work_artifact_approval',
      holder: approval.holder as unknown as Json, configurationId: approval.effective.configurationId };
  }
  const { data, error } = await admin.rpc('record_work_artifact_action', {
    p_organization_id: auth.context.orgId, p_actor_id: auth.context.userId,
    p_artifact_id: parsed.data.artifactId, p_revision_id: parsed.data.revisionId,
    p_action_id: parsed.data.actionId, p_expected_version: parsed.data.expectedVersion,
    p_action_type: parsed.data.actionType, p_reason: parsed.data.reason ?? null,
    p_comment: parsed.data.comment ?? null, p_responsibility_snapshot: responsibilitySnapshot,
    p_customer_context: (parsed.data.customerContext ?? null) as Json,
    p_signature_document_id: parsed.data.signatureDocumentId ?? null,
  } as unknown as Database['public']['Functions']['record_work_artifact_action']['Args']);
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, error: mapArtifactError(error) };
  }
  const result = data as Record<string, Json | undefined>;
  revalidateArtifacts(auth.context.orgId);
  return { success: true, artifactId: parsed.data.artifactId,
    version: Number(result.version), status: String(result.status) as WorkArtifactStatus, data };
}

export async function voidWorkArtifact(input: {
  artifactId: string; actionId: string; expectedVersion: number; reason: string;
}): Promise<WorkArtifactMutationResult> {
  const parsed = voidWorkArtifactSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('void_work_artifact', {
    p_organization_id: auth.context.orgId, p_actor_id: auth.context.userId,
    p_artifact_id: parsed.data.artifactId, p_action_id: parsed.data.actionId,
    p_expected_version: parsed.data.expectedVersion, p_reason: parsed.data.reason,
  });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, error: mapArtifactError(error) };
  }
  const result = data as Record<string, Json | undefined>;
  revalidateArtifacts(auth.context.orgId);
  return { success: true, artifactId: parsed.data.artifactId,
    version: Number(result.version), status: 'voided', data };
}

export async function linkWorkArtifactDocument(input: {
  artifactId: string; revisionId: string; linkId: string; expectedVersion: number;
  documentId: string; relation: Database['public']['Enums']['work_artifact_document_relation'];
  description?: string;
}): Promise<WorkArtifactMutationResult> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('link_work_artifact_document', {
    p_organization_id: auth.context.orgId, p_actor_id: auth.context.userId,
    p_artifact_id: input.artifactId, p_revision_id: input.revisionId,
    p_link_id: input.linkId, p_expected_version: input.expectedVersion,
    p_document_id: input.documentId, p_relation: input.relation,
    p_description: input.description ?? null, p_renderer_version: null,
    p_content_hash: null,
  } as unknown as Database['public']['Functions']['link_work_artifact_document']['Args']);
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, error: mapArtifactError(error) };
  }
  const result = data as Record<string, Json | undefined>;
  const { data: artifact } = await admin.from('work_artifacts').select('status')
    .eq('id', input.artifactId).maybeSingle();
  revalidateArtifacts(auth.context.orgId);
  return { success: true, artifactId: input.artifactId, version: Number(result.version),
    status: artifact?.status ?? 'draft', data };
}

export async function linkWorkArtifactSource(input: {
  artifactId: string; revisionId: string; linkId: string; expectedVersion: number;
  timeEntryId?: string; timeSegmentId?: string; inventoryMovementId?: string; description?: string;
}): Promise<WorkArtifactMutationResult> {
  const sourceCount = [input.timeEntryId, input.timeSegmentId, input.inventoryMovementId]
    .filter(Boolean).length;
  if (sourceCount !== 1) {
    return { success: false, error: 'invalid_input' };
  }
  const selectedSourceId =
    input.timeEntryId ?? input.timeSegmentId ?? input.inventoryMovementId;
  if (![
    input.artifactId,
    input.revisionId,
    input.linkId,
    selectedSourceId,
  ].every((identifier) => z.uuid().safeParse(identifier).success)) {
    return { success: false, error: 'invalid_input' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const rpcResult = input.timeSegmentId
    ? await admin.rpc('link_work_artifact_time_segment', {
        p_organization_id: auth.context.orgId, p_actor_id: auth.context.userId,
        p_artifact_id: input.artifactId, p_revision_id: input.revisionId,
        p_link_id: input.linkId, p_expected_version: input.expectedVersion,
        p_time_segment_id: input.timeSegmentId,
        p_description: input.description ?? null,
      } as unknown as Database['public']['Functions']['link_work_artifact_time_segment']['Args'])
    : await admin.rpc('link_work_artifact_source', {
        p_organization_id: auth.context.orgId, p_actor_id: auth.context.userId,
        p_artifact_id: input.artifactId, p_revision_id: input.revisionId,
        p_link_id: input.linkId, p_expected_version: input.expectedVersion,
        p_time_entry_id: input.timeEntryId ?? null,
        p_inventory_movement_id: input.inventoryMovementId ?? null,
        p_description: input.description ?? null,
      } as unknown as Database['public']['Functions']['link_work_artifact_source']['Args']);
  const { data, error } = rpcResult;
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, error: mapArtifactError(error) };
  }
  const result = data as Record<string, Json | undefined>;
  const { data: artifact } = await admin.from('work_artifacts').select('status')
    .eq('id', input.artifactId).maybeSingle();
  revalidateArtifacts(auth.context.orgId);
  return { success: true, artifactId: input.artifactId, version: Number(result.version),
    status: artifact?.status ?? 'draft', data };
}

export async function fulfillInstructionEvidence(input: {
  fulfillmentId: string; evidenceRequirementId: string;
  documentId?: string; artifactRevisionId?: string; note?: string;
}): Promise<{ success: true } | Failure> {
  if (Boolean(input.documentId) === Boolean(input.artifactRevisionId)) {
    return { success: false, error: 'invalid_input' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('fulfill_instruction_evidence', {
    p_organization_id: auth.context.orgId, p_actor_id: auth.context.userId,
    p_fulfillment_id: input.fulfillmentId,
    p_evidence_requirement_id: input.evidenceRequirementId,
    p_document_id: input.documentId ?? null,
    p_artifact_revision_id: input.artifactRevisionId ?? null,
    p_note: input.note ?? null,
  } as unknown as Database['public']['Functions']['fulfill_instruction_evidence']['Args']);
  if (error) return { success: false, error: mapArtifactError(error) };
  revalidateArtifacts(auth.context.orgId);
  return { success: true };
}

export async function removeInstructionEvidenceFulfillment(input: {
  fulfillmentId: string; expectedVersion: number; reason: string;
}): Promise<{ success: true } | Failure> {
  if (input.reason.trim().length < 3) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { error } = await createSupabaseAdminClient().rpc('remove_instruction_evidence_fulfillment', {
    p_organization_id: auth.context.orgId, p_actor_id: auth.context.userId,
    p_fulfillment_id: input.fulfillmentId, p_expected_version: input.expectedVersion,
    p_reason: input.reason.trim(),
  });
  if (error) return { success: false, error: mapArtifactError(error) };
  revalidateArtifacts(auth.context.orgId);
  return { success: true };
}

export async function discardUnlinkedWorkArtifactSignature(
  documentId: string
): Promise<{ success: true } | Failure> {
  if (!voidWorkArtifactSchema.shape.artifactId.safeParse(documentId).success) {
    return { success: false, error: 'invalid_input' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data: document, error: documentError } = await admin.from('documents')
    .select('id, storage_path, uploaded_by, category').eq('organization_id', auth.context.orgId)
    .eq('id', documentId).maybeSingle();
  if (documentError || !document || document.uploaded_by !== auth.context.userId
    || document.category !== 'photo') return { success: false, error: 'not_authorized' };
  const { data: relation } = await admin.from('work_artifact_revision_documents')
    .select('id').eq('organization_id', auth.context.orgId).eq('document_id', documentId).maybeSingle();
  if (relation) return { success: false, error: 'work_artifact_signature_in_use' };
  const { error } = await admin.from('documents').delete().eq('organization_id', auth.context.orgId)
    .eq('id', documentId).eq('uploaded_by', auth.context.userId);
  if (error) return { success: false, error: 'work_artifact_signature_cleanup_failed' };
  await deleteStorageObjects([document.storage_path]).catch((cleanupError) => {
    console.error('Failed to remove unlinked signature object:', cleanupError);
  });
  revalidateArtifacts(auth.context.orgId);
  return { success: true };
}

export async function exportWorkArtifact(input: {
  artifactId: string; expectedVersion: number; linkId: string; actionId: string; documentId: string;
}): Promise<WorkArtifactMutationResult & { documentId?: string }> {
  const detailResult = await getWorkArtifactDetail(input.artifactId);
  if (!detailResult.success) return detailResult;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const artifact = detailResult.artifact;
  const revisionId = artifact.current_revision_id;
  if (!revisionId || artifact.version !== input.expectedVersion) {
    return { success: false, error: 'work_artifact_stale_version' };
  }
  const exportFile = buildWorkArtifactExport(artifact);
  const { bytes, contentHash, rendererVersion, fileName } = exportFile;
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.from('work_artifact_revision_documents')
    .select('document_id').eq('revision_id', revisionId).eq('relation', 'rendered_export')
    .eq('renderer_version', rendererVersion).eq('content_hash', contentHash).maybeSingle();
  if (existing) {
    return { success: true, artifactId: artifact.id, version: artifact.version,
      status: artifact.status, documentId: existing.document_id };
  }
  const storagePath = `${auth.context.orgId}/work-artifact-exports/${revisionId}/${rendererVersion}-${contentHash}.html`;
  let storageObjectCreated = false;
  let documentCreated = false;
  let documentLinkCreated = false;
  try {
    await putStorageObject({ path: storagePath, body: bytes, contentType: 'text/html; charset=utf-8' });
    storageObjectCreated = true;
    const { error: documentError } = await admin.from('documents').insert({
      id: input.documentId, organization_id: auth.context.orgId, folder_id: null,
      storage_bucket: DOCUMENT_STORAGE_BUCKET, storage_path: storagePath,
      original_file_name: fileName, display_name: fileName, category: 'report',
      mime_type: 'text/html; charset=utf-8', size_bytes: bytes.byteLength,
      uploaded_by: auth.context.userId,
      metadata: { artifactId: artifact.id, revisionId, rendererVersion, contentHash },
    });
    if (documentError) throw documentError;
    documentCreated = true;
    const { error: documentLinkError } = await admin.from('document_links').insert({
      organization_id: auth.context.orgId, document_id: input.documentId,
      job_id: artifact.job_id, project_id: artifact.project_id,
      created_by: auth.context.userId,
    });
    if (documentLinkError) throw documentLinkError;
    documentLinkCreated = true;
    const { data, error } = await admin.rpc('finalize_work_artifact_export', {
      p_organization_id: auth.context.orgId, p_actor_id: auth.context.userId,
      p_artifact_id: artifact.id, p_revision_id: revisionId, p_link_id: input.linkId,
      p_action_id: input.actionId, p_expected_version: input.expectedVersion,
      p_document_id: input.documentId, p_renderer_version: rendererVersion,
      p_content_hash: contentHash,
    });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw error ?? new Error('export_failed');
    await admin.from('document_audit_events').insert({ organization_id: auth.context.orgId,
      document_id: input.documentId, actor_id: auth.context.userId, event_type: 'uploaded',
      event_payload: { artifactId: artifact.id, revisionId, rendererVersion, contentHash } });
    const result = data as Record<string, Json | undefined>;
    revalidateArtifacts(auth.context.orgId);
    return { success: true, artifactId: artifact.id, version: Number(result.version),
      status: String(result.status) as WorkArtifactStatus, data, documentId: input.documentId };
  } catch (error) {
    if (documentLinkCreated) {
      await admin.from('document_links').delete().eq('organization_id', auth.context.orgId)
        .eq('document_id', input.documentId);
    }
    if (documentCreated) {
      await admin.from('documents').delete().eq('organization_id', auth.context.orgId)
        .eq('id', input.documentId);
    }
    if (storageObjectCreated) {
      const [concurrentExport, sharedDocument] = await Promise.all([
        admin.from('work_artifact_revision_documents')
          .select('id').eq('organization_id', auth.context.orgId).eq('revision_id', revisionId)
          .eq('relation', 'rendered_export').eq('renderer_version', rendererVersion)
          .eq('content_hash', contentHash).maybeSingle(),
        admin.from('documents').select('id').eq('organization_id', auth.context.orgId)
          .eq('storage_path', storagePath).neq('id', input.documentId).limit(1).maybeSingle(),
      ]);
      if (!concurrentExport.error && !sharedDocument.error
        && !concurrentExport.data && !sharedDocument.data) {
        await deleteStorageObjects([storagePath]).catch(() => undefined);
      }
    }
    console.error('Failed to export work artifact:', error);
    return { success: false, error: 'work_artifact_export_failed' };
  }
}

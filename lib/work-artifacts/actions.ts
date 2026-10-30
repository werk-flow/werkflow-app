'use server';

import { revalidateWorkEvidenceViews } from '@/lib/work-artifacts/revalidate';
import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

import { logReadFailure, loggedRead } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { readJobAssignmentOfUser, readOrganizationJob } from '@/lib/jobs/job-access-reads';
import { authorizeResponsibilityForTarget } from '@/lib/responsibilities/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isJsonRecord, toJson } from '@/lib/supabase/json';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { Database, Json } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { discardStorageObjects, putStorageObject } from '@/lib/storage/r2';
import { logError } from '@/lib/logging';
import {
  fulfillInstructionEvidenceSchema,
  linkWorkArtifactDocumentSchema,
  linkWorkArtifactSourceSchema,
  removeInstructionEvidenceFulfillmentSchema,
  saveWorkArtifactSchema,
  voidWorkArtifactSchema,
  workArtifactActionSchema,
  workArtifactTargetSchema,
} from './validation';
import { buildWorkArtifactExport } from './export';
import { mapArtifactError } from './errors';
import { readRenderedExport, refuseWorkArtifactExport, registerWorkArtifactExport } from './export-storage';
import { readArtifactForDetail, refuseHiddenCoworkerDraft, toVisibleArtifactDetail } from './detail';
import {
  WORK_ARTIFACT_STATUSES,
  type SaveWorkArtifactInput,
  type WorkArtifactActionInput,
  type WorkArtifactDetail,
  type WorkArtifactMutationResult,
  type WorkArtifactSaveResult,
  type WorkArtifactStatus,
  type WorkArtifactSummary,
} from './types';

type Target = { targetType: 'job' | 'project'; targetId: string };

const workArtifactStatusSchema = z.enum(WORK_ARTIFACT_STATUSES);

/** The status a write function returns, or null when its result is not an object with a known status. */
function mutationStatus(data: Json | null): WorkArtifactStatus | null {
  if (!isJsonRecord(data)) return null;
  const status = workArtifactStatusSchema.safeParse(String(data.status));
  return status.success ? status.data : null;
}

async function authorizeTarget(
  context: Awaited<ReturnType<typeof authenticateAndAuthorize>> & { success: true },
  target: Target,
): Promise<ActionResult> {
  const admin = createSupabaseAdminClient();
  const allowed: ActionResult = { success: true };
  const refused: ActionResult = { success: false, error: 'not_authorized' };
  // A failed read is never a refusal: the caller sees that the check could not run.
  const loadFailed: ActionResult = { success: false, error: 'load_failed' };
  if (target.targetType === 'job') {
    const { data: job, error: jobError } = await readOrganizationJob(context.context.orgId, target.targetId);
    if (jobError) return loadFailed;
    if (!job) return refused;
    if (context.context.isManagerOrAbove) return allowed;
    const { data: assignment, error: assignmentError } = await readJobAssignmentOfUser(
      context.context.orgId,
      target.targetId,
      context.context.userId,
    );
    if (assignmentError) return loadFailed;
    return assignment ? allowed : refused;
  }
  const { data: project, error: projectError } = await loggedRead(
    'authorizeTarget: projects read failed',
    admin
      .from('projects')
      .select('id')
      .eq('id', target.targetId)
      .eq('organization_id', context.context.orgId)
      .maybeSingle(),
  );
  if (projectError) return loadFailed;
  if (!project) return refused;
  if (context.context.isManagerOrAbove) return allowed;
  const { data: assignedJob, error: assignedJobError } = await loggedRead(
    'authorizeTarget: jobs read failed',
    admin
      .from('jobs')
      .select('job_assignments!inner(id)')
      .eq('project_id', target.targetId)
      .eq('organization_id', context.context.orgId)
      .eq('job_assignments.user_id', context.context.userId)
      .limit(1)
      .maybeSingle(),
  );
  if (assignedJobError) return loadFailed;
  return assignedJob ? allowed : refused;
}

export async function getWorkArtifacts(
  rawTarget: Target,
): Promise<{ success: true; artifacts: WorkArtifactSummary[] } | ActionFailure> {
  const parsedTarget = workArtifactTargetSchema.safeParse(rawTarget);
  if (!parsedTarget.success) return { success: false, error: 'invalid_input' };
  const target = parsedTarget.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const access = await authorizeTarget(auth, target);
  if (!access.success) return access;
  const admin = createSupabaseAdminClient();
  const targetColumn = target.targetType === 'job' ? 'job_id' : 'project_id';
  const { data: artifacts, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('work_artifacts')
        .select('*')
        .eq('organization_id', auth.context.orgId)
        .eq(targetColumn, target.targetId)
        .order('updated_at', { ascending: false })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  const revisionIds = artifacts.flatMap((artifact) =>
    artifact.current_revision_id ? [artifact.current_revision_id] : [],
  );
  const revisionsResult = await readInBatches(revisionIds, (batch) =>
    admin
      .from('work_artifact_revisions')
      .select('*')
      .eq('organization_id', auth.context.orgId)
      .in('id', [...batch]),
  );
  const loadError = error ?? revisionsResult.error;
  if (loadError) {
    logReadFailure('getWorkArtifacts: artifact or revision read failed', { code: loadError.code });
    return { success: false, error: 'work_artifacts_load_failed' };
  }
  const revisionById = new Map(revisionsResult.data.map((revision) => [revision.id, revision]));
  return {
    success: true,
    artifacts: artifacts.flatMap((artifact) => {
      const revision = artifact.current_revision_id ? revisionById.get(artifact.current_revision_id) : null;
      if (!revision) return [];
      const isHiddenCoworkerDraft =
        !auth.context.isManagerOrAbove &&
        artifact.status === 'draft' &&
        revision.visibility === 'internal_only' &&
        revision.created_by !== auth.context.userId;
      return isHiddenCoworkerDraft ? [] : [{ ...artifact, currentRevision: revision }];
    }),
  };
}

export async function getWorkArtifactDetail(
  rawArtifactId: string,
): Promise<{ success: true; artifact: WorkArtifactDetail } | ActionFailure> {
  const parsedArtifactId = uuidSchema.safeParse(rawArtifactId);
  if (!parsedArtifactId.success) return { success: false, error: 'invalid_input' };
  const artifactId = parsedArtifactId.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const opened = await readArtifactForDetail(admin, auth.context.orgId, artifactId);
  if (!opened.success) return opened;
  const access = await authorizeTarget(auth, opened.target);
  if (!access.success) return access;
  const hiddenDraft = await refuseHiddenCoworkerDraft(admin, auth.context, opened.artifact);
  if (hiddenDraft) return hiddenDraft;
  const orgId = auth.context.orgId;
  const [revisions, actions, lines, defects, changes, documents, sources] = await Promise.all([
    admin
      .from('work_artifact_revisions')
      .select('*')
      .eq('organization_id', orgId)
      .eq('artifact_id', artifactId)
      .order('revision_number', { ascending: false }),
    admin
      .from('work_artifact_actions')
      .select('*')
      .eq('organization_id', orgId)
      .eq('artifact_id', artifactId)
      .order('created_at', { ascending: false }),
    admin
      .from('work_artifact_measurement_lines')
      .select('*, work_artifact_revisions!inner(artifact_id)')
      .eq('organization_id', orgId)
      .eq('work_artifact_revisions.artifact_id', artifactId)
      .order('line_number'),
    admin
      .from('work_artifact_defect_details')
      .select('*, work_artifact_revisions!inner(artifact_id)')
      .eq('organization_id', orgId)
      .eq('work_artifact_revisions.artifact_id', artifactId),
    admin
      .from('work_artifact_change_details')
      .select('*, work_artifact_revisions!inner(artifact_id)')
      .eq('organization_id', orgId)
      .eq('work_artifact_revisions.artifact_id', artifactId),
    admin
      .from('work_artifact_revision_documents')
      .select('*, work_artifact_revisions!inner(artifact_id)')
      .eq('organization_id', orgId)
      .eq('work_artifact_revisions.artifact_id', artifactId)
      .order('created_at'),
    admin
      .from('work_artifact_revision_sources')
      .select('*, work_artifact_revisions!inner(artifact_id)')
      .eq('organization_id', orgId)
      .eq('work_artifact_revisions.artifact_id', artifactId)
      .order('created_at'),
  ]);
  if ([revisions, actions, lines, defects, changes, documents, sources].some((result) => result.error)) {
    return { success: false, error: 'work_artifact_load_failed' };
  }
  return {
    success: true,
    artifact: toVisibleArtifactDetail(auth.context, opened.artifact, {
      revisions: revisions.data ?? [],
      actions: actions.data ?? [],
      lines: lines.data ?? [],
      defects: defects.data ?? [],
      changes: changes.data ?? [],
      documents: documents.data ?? [],
      sources: sources.data ?? [],
    }),
  };
}

export async function saveWorkArtifact(input: SaveWorkArtifactInput): Promise<WorkArtifactSaveResult> {
  const parsed = saveWorkArtifactSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const access = await authorizeTarget(auth, parsed.data);
  if (!access.success) return access;
  const content = toJson({
    ...parsed.data.content,
    measurementLines: parsed.data.content.measurementLines?.map((line) => ({
      ...line,
      quantity: line.quantity.replace(',', '.'),
    })),
  });
  const admin = createSupabaseAdminClient();
  const args = rpcArgs('create_work_artifact_revision', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_artifact_id: parsed.data.artifactId,
    p_revision_id: parsed.data.revisionId,
    p_expected_version: parsed.data.expectedVersion ?? 0,
    p_job_id: parsed.data.targetType === 'job' ? parsed.data.targetId : null,
    p_project_id: parsed.data.targetType === 'project' ? parsed.data.targetId : null,
    p_kind: parsed.data.kind,
    p_visibility: parsed.data.visibility,
    p_captured_at: parsed.data.capturedAt,
    p_title: parsed.data.title,
    p_content: content,
    p_corrects_revision_id: parsed.data.correctsRevisionId ?? null,
    p_correction_reason: parsed.data.correctionReason ?? null,
    p_submit: parsed.data.submit,
    p_submit_action_id: parsed.data.submitActionId ?? null,
  });
  const { data, error } = await admin.rpc('create_work_artifact_revision', args);
  const status = mutationStatus(data);
  if (error || !data || typeof data !== 'object' || Array.isArray(data) || !status) {
    return { success: false, error: mapArtifactError(error) };
  }
  revalidateWorkEvidenceViews();
  // The authoritative detail after the write, read with the same permission checks as an open.
  const saved = await getWorkArtifactDetail(parsed.data.artifactId);
  return {
    success: true,
    artifactId: parsed.data.artifactId,
    version: Number(data.version),
    status,
    data,
    artifact: saved.success ? saved.artifact : null,
  };
}

export async function recordWorkArtifactAction(
  input: WorkArtifactActionInput,
): Promise<WorkArtifactMutationResult> {
  const parsed = workArtifactActionSchema.safeParse(input);
  if (!parsed.success || parsed.data.actionType === 'voided')
    return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  let responsibilitySnapshot: Json | null = null;
  if (['internal_approved', 'internal_rejected', 'correction_requested'].includes(parsed.data.actionType)) {
    const { data: revision, error: revisionError } = await loggedRead(
      'recordWorkArtifactAction: work_artifact_revisions read failed',
      admin
        .from('work_artifact_revisions')
        .select('created_by')
        .eq('id', parsed.data.revisionId)
        .eq('organization_id', auth.context.orgId)
        .maybeSingle(),
    );
    if (revisionError) return { success: false, error: 'load_failed' };
    if (!revision) return { success: false, error: 'work_artifact_not_found' };
    const { data: membership, error: membershipError } = await loggedRead(
      'recordWorkArtifactAction: organization_members read failed',
      admin
        .from('organization_members')
        .select('role')
        .eq('organization_id', auth.context.orgId)
        .eq('user_id', revision.created_by)
        .maybeSingle(),
    );
    if (membershipError) return { success: false, error: 'load_failed' };
    if (!membership) return { success: false, error: 'work_artifact_author_not_active' };
    const approval = await authorizeResponsibilityForTarget({
      organizationId: auth.context.orgId,
      responsibility: 'work_artifact_approval',
      actorUserId: auth.context.userId,
      targetUserId: revision.created_by,
      targetRole: membership.role,
    });
    if (!approval.success) return { success: false, error: approval.error };
    responsibilitySnapshot = {
      responsibility: 'work_artifact_approval',
      holder: toJson(approval.holder),
      configurationId: approval.effective.configurationId,
    };
  }
  const { data, error } = await admin.rpc(
    'record_work_artifact_action',
    rpcArgs('record_work_artifact_action', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_artifact_id: parsed.data.artifactId,
      p_revision_id: parsed.data.revisionId,
      p_action_id: parsed.data.actionId,
      p_expected_version: parsed.data.expectedVersion,
      p_action_type: parsed.data.actionType,
      p_reason: parsed.data.reason ?? null,
      p_comment: parsed.data.comment ?? null,
      p_responsibility_snapshot: responsibilitySnapshot,
      p_customer_context: toJson(parsed.data.customerContext ?? null),
      p_signature_document_id: parsed.data.signatureDocumentId ?? null,
    }),
  );
  const status = mutationStatus(data);
  if (error || !data || typeof data !== 'object' || Array.isArray(data) || !status) {
    return { success: false, error: mapArtifactError(error) };
  }
  revalidateWorkEvidenceViews();
  return {
    success: true,
    artifactId: parsed.data.artifactId,
    version: Number(data.version),
    status,
    data,
  };
}

export async function voidWorkArtifact(input: {
  artifactId: string;
  actionId: string;
  expectedVersion: number;
  reason: string;
}): Promise<WorkArtifactMutationResult> {
  const parsed = voidWorkArtifactSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('void_work_artifact', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_artifact_id: parsed.data.artifactId,
    p_action_id: parsed.data.actionId,
    p_expected_version: parsed.data.expectedVersion,
    p_reason: parsed.data.reason,
  });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, error: mapArtifactError(error) };
  }
  revalidateWorkEvidenceViews();
  return {
    success: true,
    artifactId: parsed.data.artifactId,
    version: Number(data.version),
    status: 'voided',
    data,
  };
}

// A link leaves the artifact's status as it was; the caller reloads the detail.
type WorkArtifactLinkResult = ActionResult<{ artifactId: string; version: number; data: Json }>;

// The result of a link function: the new artifact version.
function linkedArtifactResult(
  artifactId: string,
  rpcResult: { data: Json | null; error: { message?: string } | null },
): WorkArtifactLinkResult {
  const { data, error } = rpcResult;
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, error: mapArtifactError(error) };
  }
  revalidateWorkEvidenceViews();
  return { success: true, artifactId, version: Number(data.version), data };
}

export async function linkWorkArtifactDocument(rawInput: {
  artifactId: string;
  revisionId: string;
  linkId: string;
  expectedVersion: number;
  documentId: string;
  relation: Database['public']['Enums']['work_artifact_document_relation'];
  description?: string;
}): Promise<WorkArtifactLinkResult> {
  const parsed = linkWorkArtifactDocumentSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    'link_work_artifact_document',
    rpcArgs('link_work_artifact_document', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_artifact_id: input.artifactId,
      p_revision_id: input.revisionId,
      p_link_id: input.linkId,
      p_expected_version: input.expectedVersion,
      p_document_id: input.documentId,
      p_relation: input.relation,
      p_description: input.description ?? null,
      p_renderer_version: null,
      p_content_hash: null,
    }),
  );
  return linkedArtifactResult(input.artifactId, { data, error });
}

export async function linkWorkArtifactSource(rawInput: {
  artifactId: string;
  revisionId: string;
  linkId: string;
  expectedVersion: number;
  timeEntryId?: string;
  timeSegmentId?: string;
  inventoryMovementId?: string;
  description?: string;
}): Promise<WorkArtifactLinkResult> {
  const parsed = linkWorkArtifactSourceSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const rpcResult = input.timeSegmentId
    ? await admin.rpc(
        'link_work_artifact_time_segment',
        rpcArgs('link_work_artifact_time_segment', {
          p_organization_id: auth.context.orgId,
          p_actor_id: auth.context.userId,
          p_artifact_id: input.artifactId,
          p_revision_id: input.revisionId,
          p_link_id: input.linkId,
          p_expected_version: input.expectedVersion,
          p_time_segment_id: input.timeSegmentId,
          p_description: input.description ?? null,
        }),
      )
    : await admin.rpc(
        'link_work_artifact_source',
        rpcArgs('link_work_artifact_source', {
          p_organization_id: auth.context.orgId,
          p_actor_id: auth.context.userId,
          p_artifact_id: input.artifactId,
          p_revision_id: input.revisionId,
          p_link_id: input.linkId,
          p_expected_version: input.expectedVersion,
          p_time_entry_id: input.timeEntryId ?? null,
          p_inventory_movement_id: input.inventoryMovementId ?? null,
          p_description: input.description ?? null,
        }),
      );
  return linkedArtifactResult(input.artifactId, rpcResult);
}

export async function fulfillInstructionEvidence(rawInput: {
  fulfillmentId: string;
  evidenceRequirementId: string;
  documentId?: string;
  artifactRevisionId?: string;
  note?: string;
}): Promise<{ success: true } | ActionFailure> {
  const parsed = fulfillInstructionEvidenceSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc(
    'fulfill_instruction_evidence',
    rpcArgs('fulfill_instruction_evidence', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_fulfillment_id: input.fulfillmentId,
      p_evidence_requirement_id: input.evidenceRequirementId,
      p_document_id: input.documentId ?? null,
      p_artifact_revision_id: input.artifactRevisionId ?? null,
      p_note: input.note ?? null,
    }),
  );
  if (error) return { success: false, error: mapArtifactError(error) };
  revalidateWorkEvidenceViews();
  return { success: true };
}

export async function removeInstructionEvidenceFulfillment(rawInput: {
  fulfillmentId: string;
  expectedVersion: number;
  reason: string;
}): Promise<{ success: true } | ActionFailure> {
  const parsed = removeInstructionEvidenceFulfillmentSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { error } = await createSupabaseAdminClient().rpc('remove_instruction_evidence_fulfillment', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_fulfillment_id: input.fulfillmentId,
    p_expected_version: input.expectedVersion,
    p_reason: input.reason,
  });
  if (error) return { success: false, error: mapArtifactError(error) };
  revalidateWorkEvidenceViews();
  return { success: true };
}

/** Deletes the caller's reserved signature upload that no artifact uses, with its audit event. */
export async function discardUnlinkedWorkArtifactSignature(
  documentId: string,
): Promise<{ success: true } | ActionFailure> {
  if (!uuidSchema.safeParse(documentId).success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { data: storagePath, error } = await createSupabaseAdminClient().rpc(
    'discard_work_artifact_signature_upload',
    { p_actor_id: auth.context.userId, p_organization_id: auth.context.orgId, p_document_id: documentId },
  );
  if (error) {
    if (error.message === 'work_artifact_signature_in_use') return { success: false, error: error.message };
    if (error.message === 'work_artifact_signature_not_discardable')
      return { success: false, error: 'not_authorized' };
    logError('discardUnlinkedWorkArtifactSignature: discard failed', error);
    return { success: false, error: 'work_artifact_signature_cleanup_failed' };
  }
  // The row is gone, so a storage failure leaves only an orphaned object, which discardStorageObjects logs.
  if (storagePath) await discardStorageObjects({ organizationId: auth.context.orgId, paths: [storagePath] });
  revalidateWorkEvidenceViews();
  return { success: true };
}

const exportWorkArtifactSchema = z.object({
  artifactId: uuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  linkId: uuidSchema,
  actionId: uuidSchema,
  documentId: uuidSchema,
});

export async function exportWorkArtifact(
  rawInput: z.input<typeof exportWorkArtifactSchema>,
): Promise<WorkArtifactMutationResult & { documentId?: string }> {
  const parsed = exportWorkArtifactSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const detailResult = await getWorkArtifactDetail(input.artifactId);
  if (!detailResult.success) return detailResult;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const artifact = detailResult.artifact;
  // The export writes a project document and its project link: a project-level document write needs a manager.
  if (artifact.project_id && !auth.context.isManagerOrAbove)
    return { success: false, error: 'not_authorized' };
  const revisionId = artifact.current_revision_id;
  if (!revisionId || artifact.version !== input.expectedVersion) {
    return { success: false, error: 'work_artifact_stale_version' };
  }
  const exportFile = buildWorkArtifactExport(artifact);
  const { bytes, contentHash, rendererVersion } = exportFile;
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await readRenderedExport(
    admin,
    auth.context.orgId,
    revisionId,
    exportFile,
  );
  if (existingError) return { success: false, error: 'load_failed' };
  if (existing) {
    return {
      success: true,
      artifactId: artifact.id,
      version: artifact.version,
      status: artifact.status,
      documentId: existing.document_id,
    };
  }
  const storagePath = `${auth.context.orgId}/work-artifact-exports/${revisionId}/${rendererVersion}-${contentHash}.html`;
  try {
    await putStorageObject({
      organizationId: auth.context.orgId,
      path: storagePath,
      body: bytes,
      contentType: 'text/html; charset=utf-8',
    });
  } catch (storageError) {
    logError('Failed to store the work artifact export', storageError);
    return { success: false, error: 'work_artifact_export_failed' };
  }
  const { data, error } = await registerWorkArtifactExport(admin, {
    organizationId: auth.context.orgId,
    actorId: auth.context.userId,
    artifactId: artifact.id,
    revisionId,
    input,
    storagePath,
    exportFile,
  });
  const status = mutationStatus(data);
  if (error || !isJsonRecord(data) || !status) {
    return refuseWorkArtifactExport(admin, auth.context.orgId, storagePath, error);
  }
  revalidateWorkEvidenceViews();
  return {
    success: true,
    artifactId: artifact.id,
    version: Number(data.version),
    status,
    data,
    documentId: String(data.documentId),
  };
}

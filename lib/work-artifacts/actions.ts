'use server';

import { revalidateWorkEvidenceViews } from '@/lib/work-artifacts/revalidate';
import type { ActionFailure } from '@/lib/action-result';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

import { logReadFailure, loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { authorizeResponsibilityForTarget } from '@/lib/responsibilities/server';
import type { OrgRole } from '@/lib/responsibilities/types';
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
import { redactWorkArtifactActionForField } from './field-visibility';
import type {
  SaveWorkArtifactInput,
  WorkArtifactActionInput,
  WorkArtifactDetail,
  WorkArtifactActionType,
  WorkArtifactMutationResult,
  WorkArtifactStatus,
  WorkArtifactSummary,
} from './types';

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

function mapArtifactError(error: { message?: string } | null): string {
  const known = [
    'work_artifact_not_authorized',
    'work_artifact_stale_version',
    'work_artifact_correction_reason_required',
    'work_artifact_self_approval_not_allowed',
    'work_artifact_not_responsible',
    'work_artifact_review_not_pending',
    'work_artifact_customer_action_requires_customer_visibility',
    'work_artifact_defect_closure_proof_required',
    'work_artifact_is_voided',
    'instruction_evidence_already_fulfilled',
    'instruction_evidence_not_authorized',
  ].find((code) => error?.message?.includes(code));
  return known ?? 'work_artifact_action_failed';
}

async function authorizeTarget(
  context: Awaited<ReturnType<typeof authenticateAndAuthorize>> & { success: true },
  target: Target,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  if (target.targetType === 'job') {
    const { data: job } = await loggedRead(
      'authorizeTarget: jobs read failed',
      admin
        .from('jobs')
        .select('id')
        .eq('id', target.targetId)
        .eq('organization_id', context.context.orgId)
        .maybeSingle(),
    );
    if (!job) return false;
    if (context.context.isManagerOrAbove) return true;
    const { data: assignment } = await loggedRead(
      'authorizeTarget: job_assignments read failed',
      admin
        .from('job_assignments')
        .select('id')
        .eq('organization_id', context.context.orgId)
        .eq('job_id', target.targetId)
        .eq('user_id', context.context.userId)
        .maybeSingle(),
    );
    return Boolean(assignment);
  }
  const { data: project } = await loggedRead(
    'authorizeTarget: projects read failed',
    admin
      .from('projects')
      .select('id')
      .eq('id', target.targetId)
      .eq('organization_id', context.context.orgId)
      .maybeSingle(),
  );
  if (!project) return false;
  if (context.context.isManagerOrAbove) return true;
  const { data: assignedJob } = await loggedRead(
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
  return Boolean(assignedJob);
}

export async function getWorkArtifacts(
  rawTarget: Target,
): Promise<{ success: true; artifacts: WorkArtifactSummary[] } | ActionFailure> {
  const parsedTarget = workArtifactTargetSchema.safeParse(rawTarget);
  if (!parsedTarget.success) return { success: false, error: 'invalid_input' };
  const target = parsedTarget.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!(await authorizeTarget(auth, target))) return { success: false, error: 'not_authorized' };
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
  const { data: artifact } = await loggedRead(
    'getWorkArtifactDetail: work_artifacts read failed',
    admin
      .from('work_artifacts')
      .select('*')
      .eq('id', artifactId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (!artifact) return { success: false, error: 'work_artifact_not_found' };
  const target: Target | null = artifact.job_id
    ? { targetType: 'job', targetId: artifact.job_id }
    : artifact.project_id
      ? { targetType: 'project', targetId: artifact.project_id }
      : null;
  if (!target) return { success: false, error: 'work_artifact_not_found' };
  if (!(await authorizeTarget(auth, target))) return { success: false, error: 'not_authorized' };
  if (!auth.context.isManagerOrAbove && artifact.status === 'draft' && artifact.current_revision_id) {
    const { data: currentRevision, error: currentRevisionError } = await admin
      .from('work_artifact_revisions')
      .select('visibility, created_by')
      .eq('organization_id', auth.context.orgId)
      .eq('id', artifact.current_revision_id)
      .maybeSingle();
    if (currentRevisionError || !currentRevision) {
      logReadErrors('getWorkArtifactDetail: read failed', currentRevisionError);
      return { success: false, error: 'work_artifact_load_failed' };
    }
    if (
      currentRevision?.visibility === 'internal_only' &&
      currentRevision.created_by !== auth.context.userId
    ) {
      return { success: false, error: 'not_authorized' };
    }
  }
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
  const disclosedRevisionIds = new Set(
    (actions.data ?? [])
      .filter((action) => FIELD_DISCLOSING_ARTIFACT_ACTIONS.has(action.action_type))
      .map((action) => action.revision_id),
  );
  const visibleRevisions = auth.context.isManagerOrAbove
    ? (revisions.data ?? [])
    : (revisions.data ?? []).filter(
        (revision) =>
          revision.visibility !== 'internal_only' ||
          revision.created_by === auth.context.userId ||
          disclosedRevisionIds.has(revision.id),
      );
  const visibleRevisionIds = new Set(visibleRevisions.map((revision) => revision.id));
  const visibleActions = (actions.data ?? []).filter(
    (action) => auth.context.isManagerOrAbove || visibleRevisionIds.has(action.revision_id),
  );
  const onlyVisibleRevisionRows = <T extends { revision_id: string }>(rows: T[]): T[] =>
    auth.context.isManagerOrAbove ? rows : rows.filter((row) => visibleRevisionIds.has(row.revision_id));
  const stripJoin = <T extends object>(rows: T[]): T[] =>
    rows.map(
      (row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'work_artifact_revisions')) as T,
    );
  return {
    success: true,
    artifact: {
      ...artifact,
      revisions: visibleRevisions.map((revision) =>
        revision.corrects_revision_id && !visibleRevisionIds.has(revision.corrects_revision_id)
          ? { ...revision, corrects_revision_id: null }
          : revision,
      ),
      actions: auth.context.isManagerOrAbove
        ? visibleActions
        : visibleActions.map((action) => redactWorkArtifactActionForField(action, auth.context.userId)),
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
  if (!(await authorizeTarget(auth, parsed.data))) return { success: false, error: 'not_authorized' };
  const content = {
    ...parsed.data.content,
    measurementLines: parsed.data.content.measurementLines?.map((line) => ({
      ...line,
      quantity: line.quantity.replace(',', '.'),
    })),
  } as Json;
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
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, error: mapArtifactError(error) };
  }
  const result = data as Record<string, Json | undefined>;
  revalidateWorkEvidenceViews();
  return {
    success: true,
    artifactId: parsed.data.artifactId,
    version: Number(result.version),
    status: String(result.status) as WorkArtifactStatus,
    data,
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
    const { data: revision } = await loggedRead(
      'recordWorkArtifactAction: work_artifact_revisions read failed',
      admin
        .from('work_artifact_revisions')
        .select('created_by')
        .eq('id', parsed.data.revisionId)
        .eq('organization_id', auth.context.orgId)
        .maybeSingle(),
    );
    if (!revision) return { success: false, error: 'work_artifact_not_found' };
    const { data: membership } = await loggedRead(
      'recordWorkArtifactAction: organization_members read failed',
      admin
        .from('organization_members')
        .select('role')
        .eq('organization_id', auth.context.orgId)
        .eq('user_id', revision.created_by)
        .maybeSingle(),
    );
    if (!membership) return { success: false, error: 'work_artifact_author_not_active' };
    const approval = await authorizeResponsibilityForTarget({
      organizationId: auth.context.orgId,
      responsibility: 'work_artifact_approval',
      actorUserId: auth.context.userId,
      targetUserId: revision.created_by,
      targetRole: membership.role as OrgRole,
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
      p_customer_context: (parsed.data.customerContext ?? null) as Json,
      p_signature_document_id: parsed.data.signatureDocumentId ?? null,
    }),
  );
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, error: mapArtifactError(error) };
  }
  const result = data as Record<string, Json | undefined>;
  revalidateWorkEvidenceViews();
  return {
    success: true,
    artifactId: parsed.data.artifactId,
    version: Number(result.version),
    status: String(result.status) as WorkArtifactStatus,
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
  const result = data as Record<string, Json | undefined>;
  revalidateWorkEvidenceViews();
  return {
    success: true,
    artifactId: parsed.data.artifactId,
    version: Number(result.version),
    status: 'voided',
    data,
  };
}

// The result of a link function: the new artifact version and its current status.
async function linkedArtifactResult({
  admin,
  organizationId,
  artifactId,
  rpcResult,
  readLabel,
}: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  organizationId: string;
  artifactId: string;
  rpcResult: { data: Json | null; error: { message?: string } | null };
  readLabel: string;
}): Promise<WorkArtifactMutationResult> {
  const { data, error } = rpcResult;
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, error: mapArtifactError(error) };
  }
  const result = data as Record<string, Json | undefined>;
  const { data: artifact } = await loggedRead(
    readLabel,
    admin
      .from('work_artifacts')
      .select('status')
      .eq('organization_id', organizationId)
      .eq('id', artifactId)
      .maybeSingle(),
  );
  revalidateWorkEvidenceViews();
  return {
    success: true,
    artifactId,
    version: Number(result.version),
    status: artifact?.status ?? 'draft',
    data,
  };
}

export async function linkWorkArtifactDocument(rawInput: {
  artifactId: string;
  revisionId: string;
  linkId: string;
  expectedVersion: number;
  documentId: string;
  relation: Database['public']['Enums']['work_artifact_document_relation'];
  description?: string;
}): Promise<WorkArtifactMutationResult> {
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
  return linkedArtifactResult({
    admin,
    organizationId: auth.context.orgId,
    artifactId: input.artifactId,
    rpcResult: { data, error },
    readLabel: 'linkWorkArtifactDocument: work_artifacts read failed',
  });
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
}): Promise<WorkArtifactMutationResult> {
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
  return linkedArtifactResult({
    admin,
    organizationId: auth.context.orgId,
    artifactId: input.artifactId,
    rpcResult,
    readLabel: 'linkWorkArtifactSource: work_artifacts read failed',
  });
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

export async function discardUnlinkedWorkArtifactSignature(
  documentId: string,
): Promise<{ success: true } | ActionFailure> {
  if (!voidWorkArtifactSchema.shape.artifactId.safeParse(documentId).success) {
    return { success: false, error: 'invalid_input' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data: document, error: documentError } = await admin
    .from('documents')
    .select('id, storage_path, uploaded_by, category')
    .eq('organization_id', auth.context.orgId)
    .eq('id', documentId)
    .maybeSingle();
  if (
    documentError ||
    !document ||
    document.uploaded_by !== auth.context.userId ||
    document.category !== 'photo'
  )
    return { success: false, error: 'not_authorized' };
  const { data: relation } = await loggedRead(
    'discardUnlinkedWorkArtifactSignature: work_artifact_revision_documents read failed',
    admin
      .from('work_artifact_revision_documents')
      .select('id')
      .eq('organization_id', auth.context.orgId)
      .eq('document_id', documentId)
      .maybeSingle(),
  );
  if (relation) return { success: false, error: 'work_artifact_signature_in_use' };
  const { error } = await admin
    .from('documents')
    .delete()
    .eq('organization_id', auth.context.orgId)
    .eq('id', documentId)
    .eq('uploaded_by', auth.context.userId);
  if (error) return { success: false, error: 'work_artifact_signature_cleanup_failed' };
  await discardStorageObjects({ organizationId: auth.context.orgId, paths: [document.storage_path] });
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
  const { bytes, contentHash, rendererVersion, fileName } = exportFile;
  const admin = createSupabaseAdminClient();
  const { data: existing } = await loggedRead(
    'exportWorkArtifact: work_artifact_revision_documents read failed',
    admin
      .from('work_artifact_revision_documents')
      .select('document_id')
      .eq('organization_id', auth.context.orgId)
      .eq('revision_id', revisionId)
      .eq('relation', 'rendered_export')
      .eq('renderer_version', rendererVersion)
      .eq('content_hash', contentHash)
      .maybeSingle(),
  );
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
  // One transaction registers the document, its link, the artifact relation
  // and action and the audit event, or refuses and changes nothing.
  const { data, error } = await admin.rpc('export_work_artifact', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_artifact_id: artifact.id,
    p_revision_id: revisionId,
    p_link_id: input.linkId,
    p_action_id: input.actionId,
    p_expected_version: input.expectedVersion,
    p_document_id: input.documentId,
    p_storage_path: storagePath,
    p_file_name: fileName,
    p_size_bytes: bytes.byteLength,
    p_renderer_version: rendererVersion,
    p_content_hash: contentHash,
  });
  if (error || !isJsonRecord(data)) {
    // A committed export of the same content owns an object of this same path.
    const reference = await admin
      .from('documents')
      .select('id')
      .eq('organization_id', auth.context.orgId)
      .eq('storage_path', storagePath)
      .limit(1);
    if (reference.error) logError('Failed to verify a work artifact export reference', reference.error);
    if (!reference.error && (reference.data?.length ?? 0) === 0) {
      await discardStorageObjects({ organizationId: auth.context.orgId, paths: [storagePath] });
    }
    logError('Failed to export work artifact', error);
    const code = mapArtifactError(error);
    return {
      success: false,
      error: code === 'work_artifact_action_failed' ? 'work_artifact_export_failed' : code,
    };
  }
  revalidateWorkEvidenceViews();
  return {
    success: true,
    artifactId: artifact.id,
    version: Number(data.version),
    status: String(data.status) as WorkArtifactStatus,
    data,
    documentId: String(data.documentId),
  };
}

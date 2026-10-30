'use server';

import { revalidateWorkEvidenceViews } from '@/lib/work-artifacts/revalidate';
import { z } from '@/lib/zod';
import type { ActionFailure } from '@/lib/action-result';
import { uuidSchema } from '@/lib/validation/uuid';

import { logReadFailure, loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize, type AuthContext } from '@/lib/jobs/auth';
import { readJobAssignmentOfUser, readOrganizationJob } from '@/lib/jobs/job-access-reads';
import { getEffectiveResponsibilityHolderForActor } from '@/lib/responsibilities/server';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isJsonRecord, toJson } from '@/lib/supabase/json';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { Json } from '@/lib/supabase/database.types';
import { putStorageObject } from '@/lib/storage/r2';
import { logError } from '@/lib/logging';
import { discardUnreferencedExportObject } from '@/lib/work-artifacts/export-storage';
import type { WorkTargetType } from '@/lib/work-lifecycle/types';
import { mapHandoverError } from './errors';
import { buildWorkHandoverExport } from './export';
import { deterministicWorkHandoverUuid } from './identity';
import { draftSourceKey } from './sources';
import { loadFrozenSummaries } from './summaries';
import type {
  WorkHandoverDraftItem,
  WorkHandoverFieldStatus,
  WorkHandoverTarget,
  WorkHandoverWorkspace,
} from './types';
import { loadWorkspaceBasis, toLoadedWorkspace, type LoadedWorkspace } from './workspace';

const EXPOSED_HANDOVER_ERROR_CODES = new Set([
  'work_handover_target_not_found',
  'work_handover_target_load_failed',
  'work_handover_sources_load_failed',
  'work_handover_sources_overflow',
  'work_handover_workspace_load_failed',
  'work_handover_summary_load_failed',
  'work_handover_summary_overflow',
  'work_handover_package_empty',
  'work_handover_source_stale',
]);

const targetSchema = z.object({
  targetType: z.enum(['job', 'project']),
  targetId: uuidSchema,
});
const targetNumberSchema = z.object({
  targetType: z.enum(['job', 'project']),
  targetNumber: z.string().trim().min(1).max(100),
  projectNumber: z.string().trim().min(1).max(100).optional(),
});
const saveSchema = targetSchema.extend({
  packageId: uuidSchema,
  expectedPackageVersion: z.number().int().nonnegative(),
  requestId: uuidSchema,
  selectedSourceKeys: z.array(z.string().min(3).max(1000)).max(200),
});
const previewSchema = targetSchema.extend({
  packageId: uuidSchema,
  expectedPackageVersion: z.number().int().positive(),
  releaseId: uuidSchema,
});
const releaseSchema = previewSchema.extend({
  requestId: uuidSchema,
  documentId: uuidSchema,
  documentLinkId: uuidSchema,
  expectedExecutionVersion: z.number().int().nonnegative(),
  expectedContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().min(3).max(1000),
  overrideGates: z.boolean(),
  overrideReason: z.string().trim().max(1000).optional(),
});
const reopenSchema = targetSchema.extend({
  packageId: uuidSchema,
  requestId: uuidSchema,
  expectedPackageVersion: z.number().int().positive(),
  expectedExecutionVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(1000),
});

function handoverFailureFromException(error: unknown, fallback: string, operation: string): ActionFailure {
  if (error instanceof Error && EXPOSED_HANDOVER_ERROR_CODES.has(error.message)) {
    logReadFailure('Work handover read failed:', { operation, code: error.message });
    return { success: false, error: error.message };
  }
  logError(`Unexpected work handover failure: ${operation}`, error);
  return { success: false, error: fallback };
}

async function requireHandoverHolder(): Promise<
  { success: true; context: AuthContext; holder: EffectiveResponsibilityHolder } | ActionFailure
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const holder = await getEffectiveResponsibilityHolderForActor({
    organizationId: auth.context.orgId,
    responsibility: 'work_handover_review',
    actorUserId: auth.context.userId,
  });
  return holder
    ? { success: true, context: auth.context, holder }
    : { success: false, error: 'work_handover_not_authorized' };
}

async function loadWorkspace(
  context: AuthContext,
  holder: EffectiveResponsibilityHolder,
  target: WorkHandoverTarget,
): Promise<LoadedWorkspace> {
  const admin = createSupabaseAdminClient();
  const basis = await loadWorkspaceBasis(admin, context, target);
  const handoverPackage = basis.handoverPackage;
  const [draftResult, releasesResult, eventsResult] = handoverPackage
    ? await Promise.all([
        admin
          .from('work_handover_draft_items')
          .select('*')
          .eq('organization_id', context.orgId)
          .eq('package_id', handoverPackage.id)
          .order('sort_order'),
        admin
          .from('work_handover_releases')
          .select(
            'id, release_number, commercial_readiness, reviewed_at, package_document_id, overridden_gates, override_reason',
          )
          .eq('organization_id', context.orgId)
          .eq('package_id', handoverPackage.id)
          .order('release_number', { ascending: false }),
        admin
          .from('work_handover_events')
          .select('id, event_type, reason, created_at, release_id')
          .eq('organization_id', context.orgId)
          .eq('package_id', handoverPackage.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (draftResult.error || releasesResult.error || eventsResult.error) {
    throw new Error('work_handover_workspace_load_failed');
  }
  const draftItems: WorkHandoverDraftItem[] = draftResult.data ?? [];
  return toLoadedWorkspace({
    context,
    holder,
    target,
    basis,
    draftItems,
    releases: releasesResult.data ?? [],
    events: eventsResult.data ?? [],
  });
}

async function buildCurrentExport(
  loaded: LoadedWorkspace,
  releaseId: string,
): Promise<{
  exportResult: ReturnType<typeof buildWorkHandoverExport>;
  summaries: { timeSummary: Json; materialSummary: Json };
  itemPayloads: Json;
}> {
  const sourceByKey = new Map(loaded.availableSources.map((source) => [source.key, source]));
  if (loaded.draftItems.length === 0) throw new Error('work_handover_package_empty');
  const selectedSources = loaded.draftItems.map((item) => {
    const source = sourceByKey.get(draftSourceKey(item));
    if (!source) throw new Error('work_handover_source_stale');
    return { item, source };
  });
  const admin = createSupabaseAdminClient();
  const summaries = await loadFrozenSummaries(admin, loaded.organizationId, {
    targetType: loaded.workspace.targetType,
    targetId: loaded.workspace.targetId,
  });
  const sources = selectedSources.map(({ source }) => ({
    label: source.label,
    customerPayload: source.customerPayload,
  }));
  return {
    exportResult: buildWorkHandoverExport({
      releaseId,
      target: loaded.workspace.targetSnapshot,
      timeSummary: summaries.timeSummary,
      materialSummary: summaries.materialSummary,
      sources,
    }),
    summaries,
    itemPayloads: toJson(
      selectedSources.map(({ item, source }) => ({
        draft_item_id: item.id,
        customer_payload: source.customerPayload,
      })),
    ),
  };
}

export async function getWorkHandoverWorkspace(
  input: WorkHandoverTarget,
): Promise<{ success: true; workspace: WorkHandoverWorkspace } | ActionFailure> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await requireHandoverHolder();
  if (!auth.success) return auth;
  try {
    const loaded = await loadWorkspace(auth.context, auth.holder, parsed.data);
    return { success: true, workspace: loaded.workspace };
  } catch (error) {
    return handoverFailureFromException(error, 'work_handover_workspace_load_failed', 'load_workspace');
  }
}

export async function getWorkHandoverWorkspaceByNumber(input: {
  targetType: WorkTargetType;
  targetNumber: string;
  projectNumber?: string;
}): Promise<{ success: true; workspace: WorkHandoverWorkspace } | ActionFailure> {
  const parsed = targetNumberSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await requireHandoverHolder();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  if (parsed.data.targetType === 'project') {
    const { data: project, error } = await admin
      .from('projects')
      .select('id')
      .eq('organization_id', auth.context.orgId)
      .eq('project_number', parsed.data.targetNumber)
      .maybeSingle();
    if (error) {
      logReadErrors('getWorkHandoverWorkspaceByNumber: read failed', error);
      return { success: false, error: 'work_handover_target_load_failed' };
    }
    if (!project) return { success: false, error: 'work_handover_target_not_found' };
    try {
      const loaded = await loadWorkspace(auth.context, auth.holder, {
        targetType: 'project',
        targetId: project.id,
      });
      return { success: true, workspace: loaded.workspace };
    } catch (loadError) {
      return handoverFailureFromException(
        loadError,
        'work_handover_workspace_load_failed',
        'load_project_workspace',
      );
    }
  }
  const { data: job, error } = await admin
    .from('jobs')
    .select('id, project_id')
    .eq('organization_id', auth.context.orgId)
    .eq('job_number', parsed.data.targetNumber)
    .maybeSingle();
  if (error) {
    logReadErrors('getWorkHandoverWorkspaceByNumber: read failed', error);
    return { success: false, error: 'work_handover_target_load_failed' };
  }
  if (!job) return { success: false, error: 'work_handover_target_not_found' };
  if (parsed.data.projectNumber) {
    const { data: project, error: projectError } = await loggedRead(
      'getWorkHandoverWorkspaceByNumber: projects read failed',
      admin
        .from('projects')
        .select('id')
        .eq('organization_id', auth.context.orgId)
        .eq('project_number', parsed.data.projectNumber)
        .maybeSingle(),
    );
    if (projectError) return { success: false, error: 'work_handover_target_load_failed' };
    if (!project || project.id !== job.project_id) {
      return { success: false, error: 'work_handover_target_not_found' };
    }
  } else if (job.project_id) {
    return { success: false, error: 'work_handover_target_not_found' };
  }
  try {
    const loaded = await loadWorkspace(auth.context, auth.holder, {
      targetType: 'job',
      targetId: job.id,
    });
    return { success: true, workspace: loaded.workspace };
  } catch (loadError) {
    return handoverFailureFromException(
      loadError,
      'work_handover_workspace_load_failed',
      'load_job_workspace',
    );
  }
}

export async function saveWorkHandoverDraft(
  input: z.input<typeof saveSchema>,
): Promise<{ success: true; packageId: string; packageVersion: number } | ActionFailure> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await requireHandoverHolder();
  if (!auth.success) return auth;
  try {
    const loaded = await loadWorkspace(auth.context, auth.holder, parsed.data);
    if (
      loaded.workspace.packageId !== parsed.data.packageId ||
      loaded.workspace.packageVersion !== parsed.data.expectedPackageVersion
    ) {
      return { success: false, error: 'work_handover_stale_version' };
    }
    const selected = new Set(parsed.data.selectedSourceKeys);
    const sources = loaded.workspace.availableSources.filter((source) => selected.has(source.key));
    if (sources.length !== selected.size) return { success: false, error: 'work_handover_source_stale' };
    const items = sources.map((source, index) => ({
      id: deterministicWorkHandoverUuid(parsed.data.packageId, source.key),
      source_kind: source.kind,
      work_artifact_revision_id: source.workArtifactRevisionId,
      document_id: source.documentId,
      document_version_number: source.documentVersionNumber,
      document_storage_path: source.documentStoragePath,
      child_handover_release_id: source.childHandoverReleaseId,
      customer_label: source.label,
      sort_order: index,
    }));
    const { data, error } = await createSupabaseAdminClient().rpc('save_work_handover_draft', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_target_type: parsed.data.targetType,
      p_target_id: parsed.data.targetId,
      p_package_id: parsed.data.packageId,
      p_expected_version: parsed.data.expectedPackageVersion,
      p_request_id: parsed.data.requestId,
      p_items: toJson(items),
    });
    if (error || !isJsonRecord(data) || typeof data.version !== 'number') {
      return { success: false, error: mapHandoverError(error) };
    }
    revalidateWorkEvidenceViews();
    return { success: true, packageId: parsed.data.packageId, packageVersion: data.version };
  } catch (error) {
    return handoverFailureFromException(error, 'work_handover_action_failed', 'save_draft');
  }
}

export async function previewWorkHandover(
  input: z.input<typeof previewSchema>,
): Promise<{ success: true; html: string; contentHash: string; fileName: string } | ActionFailure> {
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await requireHandoverHolder();
  if (!auth.success) return auth;
  try {
    const loaded = await loadWorkspace(auth.context, auth.holder, parsed.data);
    if (
      loaded.workspace.packageId !== parsed.data.packageId ||
      loaded.workspace.packageVersion !== parsed.data.expectedPackageVersion
    ) {
      return { success: false, error: 'work_handover_stale_version' };
    }
    const { exportResult } = await buildCurrentExport(loaded, parsed.data.releaseId);
    return {
      success: true,
      html: exportResult.html,
      contentHash: exportResult.contentHash,
      fileName: exportResult.fileName,
    };
  } catch (error) {
    return handoverFailureFromException(error, 'work_handover_action_failed', 'preview');
  }
}

export async function releaseWorkHandover(
  input: z.input<typeof releaseSchema>,
): Promise<{ success: true; releaseId: string; documentId: string } | ActionFailure> {
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await requireHandoverHolder();
  if (!auth.success) return auth;
  try {
    const loaded = await loadWorkspace(auth.context, auth.holder, parsed.data);
    if (
      loaded.workspace.packageId !== parsed.data.packageId ||
      loaded.workspace.packageVersion !== parsed.data.expectedPackageVersion ||
      loaded.workspace.executionVersion !== parsed.data.expectedExecutionVersion
    ) {
      return { success: false, error: 'work_handover_stale_version' };
    }
    const { exportResult, summaries, itemPayloads } = await buildCurrentExport(loaded, parsed.data.releaseId);
    if (exportResult.contentHash !== parsed.data.expectedContentHash) {
      return { success: false, error: 'work_handover_preview_stale' };
    }
    const storagePath = `${auth.context.orgId}/work-handover-packages/${parsed.data.releaseId}/${exportResult.rendererVersion}-${exportResult.contentHash}.html`;
    await putStorageObject({
      organizationId: auth.context.orgId,
      path: storagePath,
      body: exportResult.bytes,
      contentType: 'text/html; charset=utf-8',
    });
    const gateRecord = isJsonRecord(loaded.workspace.gateSnapshot) ? loaded.workspace.gateSnapshot : {};
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc(
      'release_work_handover',
      rpcArgs('release_work_handover', {
        p_organization_id: auth.context.orgId,
        p_actor_id: auth.context.userId,
        p_package_id: parsed.data.packageId,
        p_release_id: parsed.data.releaseId,
        p_request_id: parsed.data.requestId,
        p_expected_package_version: parsed.data.expectedPackageVersion,
        p_expected_execution_version: parsed.data.expectedExecutionVersion,
        p_expected_gate_fingerprint: loaded.workspace.gateFingerprint,
        p_handover_reason: parsed.data.reason,
        p_override_gates: parsed.data.overrideGates,
        p_override_reason: parsed.data.overrideReason ?? null,
        p_target_snapshot: toJson(loaded.workspace.targetSnapshot),
        p_time_summary: summaries.timeSummary,
        p_material_summary: summaries.materialSummary,
        p_responsibility_snapshot: toJson({
          responsibility: 'work_handover_review',
          actorUserId: auth.context.userId,
          employeeRecordId: loaded.holder.employeeRecordId,
          source: loaded.holder.source,
        }),
        p_unassessed_facts: toJson(Array.isArray(gateRecord.notAssessable) ? gateRecord.notAssessable : []),
        p_item_payloads: itemPayloads,
        p_document_id: parsed.data.documentId,
        p_document_link_id: parsed.data.documentLinkId,
        p_storage_path: storagePath,
        p_file_name: exportResult.fileName,
        p_size_bytes: exportResult.bytes.byteLength,
        p_renderer_version: exportResult.rendererVersion,
        p_content_hash: exportResult.contentHash,
      }),
    );
    if (error) {
      await discardUnreferencedExportObject(
        admin,
        auth.context.orgId,
        storagePath,
        'Failed to verify a work handover object reference',
      );
      return { success: false, error: mapHandoverError(error) };
    }
    revalidateWorkEvidenceViews();
    return { success: true, releaseId: parsed.data.releaseId, documentId: parsed.data.documentId };
  } catch (error) {
    return handoverFailureFromException(error, 'work_handover_action_failed', 'release');
  }
}

async function changeHandoverState(
  input: z.output<typeof reopenSchema>,
  operation: 'withdraw_work_handover' | 'return_work_handover_for_correction',
): Promise<{ success: true } | ActionFailure> {
  const auth = await requireHandoverHolder();
  if (!auth.success) return auth;
  const { error } = await createSupabaseAdminClient().rpc(operation, {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_package_id: input.packageId,
    p_request_id: input.requestId,
    p_expected_package_version: input.expectedPackageVersion,
    p_expected_execution_version: input.expectedExecutionVersion,
    p_reason: input.reason,
  });
  if (error) return { success: false, error: mapHandoverError(error) };
  revalidateWorkEvidenceViews();
  return { success: true };
}

export async function withdrawWorkHandover(
  input: z.input<typeof reopenSchema>,
): Promise<{ success: true } | ActionFailure> {
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  return changeHandoverState(parsed.data, 'withdraw_work_handover');
}

export async function returnWorkHandoverForCorrection(
  input: z.input<typeof reopenSchema>,
): Promise<{ success: true } | ActionFailure> {
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  return changeHandoverState(parsed.data, 'return_work_handover_for_correction');
}

export async function getWorkHandoverFieldStatus(
  jobId: string,
): Promise<{ success: true; status: WorkHandoverFieldStatus } | ActionFailure> {
  const parsed = uuidSchema.safeParse(jobId);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data: job, error: jobError } = await readOrganizationJob(auth.context.orgId, parsed.data);
  if (jobError) return { success: false, error: 'work_handover_status_load_failed' };
  if (!job) return { success: false, error: 'not_authorized' };
  if (!auth.context.isManagerOrAbove) {
    const { data: assignment, error: assignmentError } = await readJobAssignmentOfUser(
      auth.context.orgId,
      parsed.data,
      auth.context.userId,
    );
    if (assignmentError) return { success: false, error: 'work_handover_status_load_failed' };
    if (!assignment) return { success: false, error: 'not_authorized' };
  }
  const { data: handoverPackage, error } = await admin
    .from('work_handover_packages')
    .select('state, current_release_id')
    .eq('organization_id', auth.context.orgId)
    .eq('job_id', parsed.data)
    .maybeSingle();
  if (error || !handoverPackage) {
    logReadErrors('getWorkHandoverFieldStatus: read failed', error);
    return error
      ? { success: false, error: 'work_handover_status_load_failed' }
      : {
          success: true,
          status: { state: 'missing', releaseNumber: null, reviewedAt: null, documentId: null },
        };
  }
  const releaseResult = handoverPackage.current_release_id
    ? await admin
        .from('work_handover_releases')
        .select('release_number, reviewed_at, package_document_id')
        .eq('organization_id', auth.context.orgId)
        .eq('id', handoverPackage.current_release_id)
        .maybeSingle()
    : { data: null, error: null };
  if (releaseResult.error) {
    logReadErrors('getWorkHandoverFieldStatus: read failed', releaseResult.error);
    return { success: false, error: 'work_handover_status_load_failed' };
  }
  return {
    success: true,
    status: {
      state: handoverPackage.state,
      releaseNumber: releaseResult.data?.release_number ?? null,
      reviewedAt: releaseResult.data?.reviewed_at ?? null,
      documentId: releaseResult.data?.package_document_id ?? null,
    },
  };
}

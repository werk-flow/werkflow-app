'use server';

import { createHash } from 'node:crypto';
import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';

import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { getEffectiveResponsibilityHolderForActor } from '@/lib/responsibilities/server';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/database.types';
import { deleteStorageObjects, putStorageObject } from '@/lib/storage/r2';
import type { WorkExecutionState, WorkTargetType } from '@/lib/work-lifecycle/types';
import { WORK_ARTIFACT_KIND_LABELS } from '@/lib/work-artifacts/types';
import { buildWorkHandoverExport } from './export';
import { deterministicWorkHandoverUuid, workHandoverPackageId } from './identity';
import { resolveChildState, resolveProjectHandoverExecutionState } from './project-state';
import type {
  WorkHandoverDraftItem,
  WorkHandoverFieldStatus,
  WorkHandoverSourceOption,
  WorkHandoverTargetSnapshot,
  WorkHandoverWorkspace,
} from './types';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type AuthContext = Extract<Awaited<ReturnType<typeof authenticateAndAuthorize>>, { success: true }>['context'];
type Failure = { success: false; error: string };
type Target = { targetType: WorkTargetType; targetId: string };
type LoadedWorkspace = {
  organizationId: string;
  workspace: WorkHandoverWorkspace;
  draftItems: WorkHandoverDraftItem[];
  holder: EffectiveResponsibilityHolder;
  availableSources: LoadedSourceOption[];
};
type LoadedSourceOption = WorkHandoverSourceOption & { customerPayload: Json };

const MAX_HANDOVER_SOURCE_ROWS = 500;
const MAX_HANDOVER_SUMMARY_ROWS = 5_000;
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
  targetId: z.string().uuid(),
});
const targetNumberSchema = z.object({
  targetType: z.enum(['job', 'project']),
  targetNumber: z.string().trim().min(1).max(100),
  projectNumber: z.string().trim().min(1).max(100).optional(),
});
const saveSchema = targetSchema.extend({
  packageId: z.string().uuid(),
  expectedPackageVersion: z.number().int().nonnegative(),
  requestId: z.string().uuid(),
  selectedSourceKeys: z.array(z.string().min(3).max(1000)).max(200),
});
const previewSchema = targetSchema.extend({
  packageId: z.string().uuid(),
  expectedPackageVersion: z.number().int().positive(),
  releaseId: z.string().uuid(),
});
const releaseSchema = previewSchema.extend({
  requestId: z.string().uuid(),
  documentId: z.string().uuid(),
  documentLinkId: z.string().uuid(),
  expectedExecutionVersion: z.number().int().nonnegative(),
  expectedContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().min(3).max(1000),
  overrideGates: z.boolean(),
  overrideReason: z.string().trim().max(1000).optional(),
});
const reopenSchema = targetSchema.extend({
  packageId: z.string().uuid(),
  requestId: z.string().uuid(),
  expectedPackageVersion: z.number().int().positive(),
  expectedExecutionVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(1000),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function mapHandoverError(error: { message?: string } | null): string {
  const codes = [
    'work_handover_not_authorized', 'work_handover_stale_version',
    'work_handover_execution_state_invalid', 'work_handover_source_stale',
    'work_handover_package_empty', 'work_handover_gate_stale',
    'work_handover_gate_snapshot_invalid',
    'work_handover_active_clock', 'work_handover_review_blocked',
    'work_handover_override_reason_required', 'work_handover_override_not_needed',
    'work_handover_release_state_invalid',
    'work_handover_release_required', 'work_transition_stale_version',
    'work_transition_not_allowed', 'work_handover_idempotency_conflict',
  ];
  return codes.find((code) => error?.message?.includes(code)) ?? 'work_handover_action_failed';
}

function handoverFailureFromException(
  error: unknown,
  fallback: string,
  operation: string,
): Failure {
  if (error instanceof Error && EXPOSED_HANDOVER_ERROR_CODES.has(error.message)) {
    return { success: false, error: error.message };
  }
  console.error('Unexpected work handover failure:', {
    operation,
    errorName: error instanceof Error ? error.name : typeof error,
  });
  return { success: false, error: fallback };
}

function revalidateHandover(organizationId: string): void {
  updateTag(CACHE_TAGS.jobs(organizationId));
  updateTag(CACHE_TAGS.projects(organizationId));
  updateTag(CACHE_TAGS.documents(organizationId));
  updateTag(CACHE_TAGS.responsibilities(organizationId));
  revalidatePath('/auftraege', 'layout');
  revalidatePath('/aufgaben', 'layout');
  revalidatePath('/dokumente', 'layout');
}

async function requireHandoverHolder(): Promise<
  | { success: true; context: AuthContext; holder: EffectiveResponsibilityHolder }
  | Failure
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

function documentSourceKey(documentId: string, version: number): string {
  return `document:${documentId}:${version}`;
}

function draftSourceKey(item: WorkHandoverDraftItem): string {
  if (item.work_artifact_revision_id) return `artifact:${item.work_artifact_revision_id}`;
  if (item.document_id && item.document_version_number) {
    return documentSourceKey(item.document_id, item.document_version_number);
  }
  return `child:${item.child_handover_release_id}`;
}

async function loadTargetSnapshot(
  admin: AdminClient,
  organizationId: string,
  target: Target,
): Promise<{
  snapshot: WorkHandoverTargetSnapshot;
  executionState: WorkExecutionState;
  executionVersion: number;
  projectJobIds: string[];
}> {
  if (target.targetType === 'job') {
    const { data: job, error } = await admin.from('jobs').select(
      'id, job_number, title, location, client_id, site_id, contact_id, status, execution_state, execution_version'
    ).eq('organization_id', organizationId).eq('id', target.targetId).maybeSingle();
    if (error || !job) throw new Error('work_handover_target_not_found');
    const [clientResult, siteResult, contactResult] = await Promise.all([
      job.client_id
        ? admin.from('clients').select('name').eq('organization_id', organizationId)
            .eq('id', job.client_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      job.site_id
        ? admin.from('client_sites').select('name, street, postal_code, city')
            .eq('organization_id', organizationId).eq('id', job.site_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      job.contact_id
        ? admin.from('client_contacts').select('name, role, email, phone')
            .eq('organization_id', organizationId).eq('id', job.contact_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (clientResult.error || siteResult.error || contactResult.error) {
      throw new Error('work_handover_target_load_failed');
    }
    const siteAddress = siteResult.data
      ? [siteResult.data.street, [siteResult.data.postal_code, siteResult.data.city].filter(Boolean).join(' ')]
          .filter(Boolean).join(', ')
      : job.location;
    return {
      snapshot: {
        targetType: 'job', targetId: job.id, number: job.job_number,
        title: job.title, customerName: clientResult.data?.name ?? null,
        contactName: contactResult.data?.name ?? null,
        contactRole: contactResult.data?.role ?? null,
        contactEmail: contactResult.data?.email ?? null,
        contactPhone: contactResult.data?.phone ?? null,
        siteName: siteResult.data?.name ?? null, siteAddress: siteAddress || null,
      },
      executionState: resolveChildState({
        executionState: job.execution_state,
        status: job.status,
      }),
      executionVersion: job.execution_version,
      projectJobIds: [job.id],
    };
  }

  const { data: project, error } = await admin.from('projects').select(
    'id, project_number, name, client_id, site_id, contact_id, status_override, execution_state_override, execution_version'
  ).eq('organization_id', organizationId).eq('id', target.targetId).maybeSingle();
  if (error || !project) throw new Error('work_handover_target_not_found');
  const [clientResult, siteResult, contactResult, jobsResult] = await Promise.all([
    project.client_id
      ? admin.from('clients').select('name').eq('organization_id', organizationId)
          .eq('id', project.client_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    project.site_id
      ? admin.from('client_sites').select('name, street, postal_code, city')
          .eq('organization_id', organizationId).eq('id', project.site_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    project.contact_id
      ? admin.from('client_contacts').select('name, role, email, phone')
          .eq('organization_id', organizationId).eq('id', project.contact_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from('jobs').select('id, execution_state, status').eq('organization_id', organizationId)
      .eq('project_id', project.id).order('job_number').limit(MAX_HANDOVER_SOURCE_ROWS + 1),
  ]);
  if (clientResult.error || siteResult.error || contactResult.error || jobsResult.error) {
    throw new Error('work_handover_target_load_failed');
  }
  if ((jobsResult.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS) {
    throw new Error('work_handover_sources_overflow');
  }
  const siteAddress = siteResult.data
    ? [siteResult.data.street, [siteResult.data.postal_code, siteResult.data.city].filter(Boolean).join(' ')]
        .filter(Boolean).join(', ')
    : null;
  return {
    snapshot: {
      targetType: 'project', targetId: project.id, number: project.project_number,
      title: project.name, customerName: clientResult.data?.name ?? null,
      contactName: contactResult.data?.name ?? null,
      contactRole: contactResult.data?.role ?? null,
      contactEmail: contactResult.data?.email ?? null,
      contactPhone: contactResult.data?.phone ?? null,
      siteName: siteResult.data?.name ?? null, siteAddress: siteAddress || null,
    },
    executionState: resolveProjectHandoverExecutionState(
      project.execution_state_override,
      project.status_override,
      (jobsResult.data ?? []).map((job) => ({
        executionState: job.execution_state,
        status: job.status,
      })),
    ),
    executionVersion: project.execution_version,
    projectJobIds: (jobsResult.data ?? []).map((job) => job.id),
  };
}

async function loadAvailableSources(
  admin: AdminClient,
  organizationId: string,
  target: Target,
  projectJobIds: string[],
): Promise<LoadedSourceOption[]> {
  const targetColumn = target.targetType === 'job' ? 'job_id' : 'project_id';
  const [artifactsResult, linksResult] = await Promise.all([
    admin.from('work_artifacts').select('id, current_revision_id, kind, status')
      .eq('organization_id', organizationId).eq(targetColumn, target.targetId)
      .eq('status', 'approved').order('updated_at').limit(MAX_HANDOVER_SOURCE_ROWS + 1),
    admin.from('document_links').select('document_id')
      .eq('organization_id', organizationId).eq(targetColumn, target.targetId)
      .limit(MAX_HANDOVER_SOURCE_ROWS + 1),
  ]);
  if (artifactsResult.error || linksResult.error) throw new Error('work_handover_sources_load_failed');
  if ((artifactsResult.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS
    || (linksResult.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS) {
    throw new Error('work_handover_sources_overflow');
  }

  const revisionIds = (artifactsResult.data ?? []).flatMap((artifact) =>
    artifact.current_revision_id ? [artifact.current_revision_id] : []
  );
  const documentIds = [...new Set((linksResult.data ?? []).map((link) => link.document_id))];
  const [revisionsResult, documentsResult] = await Promise.all([
    revisionIds.length
        ? admin.from('work_artifact_revisions').select(
          'id, artifact_id, title, visibility, revision_number, summary, performed_work, outstanding_work, work_date'
        ).eq('organization_id', organizationId).in('id', revisionIds)
          .eq('visibility', 'customer_facing').limit(MAX_HANDOVER_SOURCE_ROWS + 1)
      : Promise.resolve({ data: [], error: null }),
    documentIds.length
      ? admin.from('documents').select(
          'id, display_name, category, mime_type, storage_path, current_version_number'
        ).eq('organization_id', organizationId).in('id', documentIds).is('deleted_at', null)
          .limit(MAX_HANDOVER_SOURCE_ROWS + 1)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (revisionsResult.error || documentsResult.error) throw new Error('work_handover_sources_load_failed');
  if ((revisionsResult.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS
    || (documentsResult.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS) {
    throw new Error('work_handover_sources_overflow');
  }
  const artifactsById = new Map((artifactsResult.data ?? []).map((artifact) => [artifact.id, artifact]));
  const sources: LoadedSourceOption[] = (revisionsResult.data ?? []).flatMap((revision) => {
    const artifact = artifactsById.get(revision.artifact_id);
    if (!artifact || artifact.current_revision_id !== revision.id) return [];
    const artifactKind = artifact.kind as Database['public']['Enums']['work_artifact_kind'];
    return [{
      key: `artifact:${revision.id}`,
      kind: 'work_artifact_revision' as const,
      label: revision.title,
      description: `Freigegebener Arbeitsnachweis · Version ${revision.revision_number}`,
      customerPayload: asJson({
        Art: WORK_ARTIFACT_KIND_LABELS[artifactKind],
        Arbeitstag: revision.work_date,
        Zusammenfassung: revision.summary,
        'Ausgeführte Arbeiten': revision.performed_work,
        'Offene Arbeiten': revision.outstanding_work,
      }),
      workArtifactRevisionId: revision.id,
      documentId: null, documentVersionNumber: null, documentStoragePath: null,
      childHandoverReleaseId: null,
    }];
  });
  for (const document of documentsResult.data ?? []) {
    sources.push({
      key: documentSourceKey(document.id, document.current_version_number),
      kind: 'document_version', label: document.display_name,
      description: `Dokument · Version ${document.current_version_number}`,
      customerPayload: asJson({
        Dokument: document.display_name,
        Kategorie: document.category,
        Dateityp: document.mime_type,
        Version: document.current_version_number,
      }),
      workArtifactRevisionId: null,
      documentId: document.id,
      documentVersionNumber: document.current_version_number,
      documentStoragePath: document.storage_path,
      childHandoverReleaseId: null,
    });
  }

  if (target.targetType === 'project' && projectJobIds.length > 0) {
    const [jobsResult, packagesResult] = await Promise.all([
      admin.from('jobs').select('id, job_number, title')
        .eq('organization_id', organizationId).in('id', projectJobIds)
        .limit(MAX_HANDOVER_SOURCE_ROWS + 1),
      admin.from('work_handover_packages').select('job_id, current_release_id')
        .eq('organization_id', organizationId).in('job_id', projectJobIds)
        .eq('state', 'released').not('current_release_id', 'is', null)
        .limit(MAX_HANDOVER_SOURCE_ROWS + 1),
    ]);
    if (jobsResult.error || packagesResult.error) throw new Error('work_handover_sources_load_failed');
    if ((jobsResult.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS
      || (packagesResult.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS) {
      throw new Error('work_handover_sources_overflow');
    }
    const releaseIds = (packagesResult.data ?? []).flatMap((entry) =>
      entry.current_release_id ? [entry.current_release_id] : []
    );
    const releasesResult = releaseIds.length
        ? await admin.from('work_handover_releases').select(
          'id, release_number, commercial_readiness'
        ).eq('organization_id', organizationId).in('id', releaseIds)
          .limit(MAX_HANDOVER_SOURCE_ROWS + 1)
      : { data: [], error: null };
    if (releasesResult.error) throw new Error('work_handover_sources_load_failed');
    if ((releasesResult.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS) {
      throw new Error('work_handover_sources_overflow');
    }
    const jobsById = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));
    const releasesById = new Map((releasesResult.data ?? []).map((release) => [release.id, release]));
    for (const childPackage of packagesResult.data ?? []) {
      const release = childPackage.current_release_id
        ? releasesById.get(childPackage.current_release_id)
        : null;
      const job = childPackage.job_id ? jobsById.get(childPackage.job_id) : null;
      if (!release || !job) continue;
      sources.push({
        key: `child:${release.id}`, kind: 'child_handover_release',
        label: job.job_number ? `${job.job_number} · ${job.title}` : job.title,
        description: `Unveränderliche Auftragsübergabe · Freigabe ${release.release_number}`,
        customerPayload: asJson({
          Auftrag: job.job_number ?? job.title,
          Freigabe: release.release_number,
        }),
        workArtifactRevisionId: null, documentId: null,
        documentVersionNumber: null, documentStoragePath: null,
        childHandoverReleaseId: release.id,
      });
    }
  }
  return sources.toSorted((left, right) => left.label.localeCompare(right.label, 'de'));
}

async function loadWorkspace(
  context: AuthContext,
  holder: EffectiveResponsibilityHolder,
  target: Target,
): Promise<LoadedWorkspace> {
  const admin = createSupabaseAdminClient();
  const targetData = await loadTargetSnapshot(admin, context.orgId, target);
  const targetColumn = target.targetType === 'job' ? 'job_id' : 'project_id';
  const [packageResult, gateResult, sources] = await Promise.all([
    admin.from('work_handover_packages').select('*')
      .eq('organization_id', context.orgId).eq(targetColumn, target.targetId).maybeSingle(),
    admin.rpc('get_work_handover_gate_snapshot', {
      p_organization_id: context.orgId, p_actor_id: context.userId,
      p_target_type: target.targetType, p_target_id: target.targetId,
    }),
    loadAvailableSources(admin, context.orgId, target, targetData.projectJobIds),
  ]);
  if (packageResult.error || gateResult.error || !isRecord(gateResult.data)
    || typeof gateResult.data.fingerprint !== 'string'
    || !('snapshot' in gateResult.data)) {
    throw new Error(mapHandoverError(packageResult.error ?? gateResult.error));
  }
  const handoverPackage = packageResult.data;
  const packageId = handoverPackage?.id ?? workHandoverPackageId(
    context.orgId, target.targetType, target.targetId
  );
  const [draftResult, releasesResult, eventsResult] = handoverPackage
    ? await Promise.all([
        admin.from('work_handover_draft_items').select('*')
          .eq('organization_id', context.orgId)
          .eq('package_id', handoverPackage.id).order('sort_order'),
        admin.from('work_handover_releases').select(
          'id, release_number, commercial_readiness, reviewed_at, package_document_id, overridden_gates, override_reason'
        ).eq('organization_id', context.orgId)
          .eq('package_id', handoverPackage.id).order('release_number', { ascending: false }),
        admin.from('work_handover_events').select('id, event_type, reason, created_at, release_id')
          .eq('organization_id', context.orgId)
          .eq('package_id', handoverPackage.id).order('created_at', { ascending: false }).limit(50),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (draftResult.error || releasesResult.error || eventsResult.error) {
    throw new Error('work_handover_workspace_load_failed');
  }
  const draftItems = (draftResult.data ?? []) as WorkHandoverDraftItem[];
  const sourceKeys = new Set(sources.map((source) => source.key));
  const draftKeys = draftItems.map(draftSourceKey);
  const currentRelease = (releasesResult.data ?? []).find(
    (release) => release.id === handoverPackage?.current_release_id,
  ) ?? null;
  return {
    organizationId: context.orgId,
    holder,
    draftItems,
    availableSources: sources,
    workspace: {
      targetType: target.targetType, targetId: target.targetId,
      targetSnapshot: targetData.snapshot,
      executionState: targetData.executionState,
      executionVersion: targetData.executionVersion,
      packageId, packageVersion: handoverPackage?.version ?? 0,
      packageState: handoverPackage?.state ?? 'missing',
      currentReleaseId: handoverPackage?.current_release_id ?? null,
      currentReleaseNumber: currentRelease?.release_number ?? null,
      currentReleaseDocumentId: currentRelease?.package_document_id ?? null,
      commercialReadiness: currentRelease?.commercial_readiness ?? null,
      selectedSourceKeys: handoverPackage
        ? draftKeys.filter((key) => sourceKeys.has(key))
        : [],
      staleSourceCount: draftKeys.filter((key) => !sourceKeys.has(key)).length,
      availableSources: sources.map((source) => ({
        key: source.key, kind: source.kind, label: source.label,
        description: source.description,
        workArtifactRevisionId: source.workArtifactRevisionId,
        documentId: source.documentId,
        documentVersionNumber: source.documentVersionNumber,
        documentStoragePath: source.documentStoragePath,
        childHandoverReleaseId: source.childHandoverReleaseId,
      })),
      gateSnapshot: gateResult.data.snapshot as Json,
      gateFingerprint: gateResult.data.fingerprint,
      releases: releasesResult.data ?? [],
      events: eventsResult.data ?? [],
    },
  };
}

async function loadFrozenSummaries(
  admin: AdminClient,
  organizationId: string,
  target: Target,
): Promise<{ timeSummary: Json; materialSummary: Json }> {
  const projectJobsResult = target.targetType === 'project'
    ? await admin.from('jobs').select('id').eq('organization_id', organizationId)
        .eq('project_id', target.targetId).limit(MAX_HANDOVER_SOURCE_ROWS + 1)
    : null;
  if (projectJobsResult?.error) throw new Error('work_handover_summary_load_failed');
  if ((projectJobsResult?.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS) {
    throw new Error('work_handover_sources_overflow');
  }
  const jobIds = target.targetType === 'job'
    ? [target.targetId]
    : (projectJobsResult?.data ?? []).map((job) => job.id);
  const timeResult = await (
    jobIds.length
      ? admin.from('time_entries').select('id, timestamp, status').eq('organization_id', organizationId)
          .in('job_id', jobIds).neq('status', 'rejected').neq('status', 'pending_delete')
          .order('timestamp').order('id').limit(MAX_HANDOVER_SUMMARY_ROWS + 1)
      : Promise.resolve({ data: [], error: null })
  );
  const materialResults = target.targetType === 'job'
    ? [await admin.from('job_material_lines').select(
          'id, planned_quantity, taken_quantity, returned_quantity, status'
        ).eq('organization_id', organizationId).eq('job_id', target.targetId)
          .limit(MAX_HANDOVER_SUMMARY_ROWS + 1)]
    : await Promise.all([
        admin.from('job_material_lines').select(
          'id, planned_quantity, taken_quantity, returned_quantity, status'
        ).eq('organization_id', organizationId).eq('project_id', target.targetId)
          .limit(MAX_HANDOVER_SUMMARY_ROWS + 1),
        jobIds.length
          ? admin.from('job_material_lines').select(
              'id, planned_quantity, taken_quantity, returned_quantity, status'
            ).eq('organization_id', organizationId).in('job_id', jobIds)
              .limit(MAX_HANDOVER_SUMMARY_ROWS + 1)
          : Promise.resolve({ data: [], error: null }),
      ]);
  if (timeResult.error || materialResults.some((result) => result.error)) {
    throw new Error('work_handover_summary_load_failed');
  }
  if ((timeResult.data?.length ?? 0) > MAX_HANDOVER_SUMMARY_ROWS
    || materialResults.some((result) => (result.data?.length ?? 0) > MAX_HANDOVER_SUMMARY_ROWS)) {
    throw new Error('work_handover_summary_overflow');
  }
  const timeRows = timeResult.data ?? [];
  const materialRows = [...new Map(materialResults.flatMap((result) => result.data ?? [])
    .map((row) => [row.id, row])).values()].toSorted((left, right) => left.id.localeCompare(right.id));
  if (materialRows.length > MAX_HANDOVER_SUMMARY_ROWS) {
    throw new Error('work_handover_summary_overflow');
  }
  const timeSourceFingerprint = createHash('sha256')
    .update(JSON.stringify(timeRows), 'utf8').digest('hex');
  const materialSourceFingerprint = createHash('sha256')
    .update(JSON.stringify(materialRows), 'utf8').digest('hex');
  return {
    timeSummary: asJson({
      'Erfasste Buchungen': timeRows.length,
      'Erste Buchung': timeRows.at(0)?.timestamp ?? null,
      'Letzte Buchung': timeRows.at(-1)?.timestamp ?? null,
      Quellenfingerabdruck: timeSourceFingerprint,
      Hinweis: 'Die Vollständigkeit der Zeitsegmente ist in Phase 1 nicht automatisch bewertet.',
    }),
    materialSummary: asJson({
      Materialpositionen: materialRows.length,
      'Geplante Menge': materialRows.reduce((sum, row) => sum + row.planned_quantity, 0),
      'Entnommene Menge': materialRows.reduce((sum, row) => sum + row.taken_quantity, 0),
      'Zurückgegebene Menge': materialRows.reduce((sum, row) => sum + row.returned_quantity, 0),
      Quellenfingerabdruck: materialSourceFingerprint,
      Hinweis: 'Verbrauch und Abrechenbarkeit werden in Phase 1 nicht automatisch bewertet.',
    }),
  };
}

async function buildCurrentExport(loaded: LoadedWorkspace, releaseId: string): Promise<{
  exportResult: ReturnType<typeof buildWorkHandoverExport>;
  summaries: { timeSummary: Json; materialSummary: Json };
  itemPayloads: Json;
}> {
  const sourceByKey = new Map(loaded.availableSources.map((source) => [source.key, source]));
  const selectedSources = loaded.draftItems.map((item) => ({
    item,
    source: sourceByKey.get(draftSourceKey(item)),
  }));
  if (selectedSources.length === 0) throw new Error('work_handover_package_empty');
  if (selectedSources.some((entry) => !entry.source)) throw new Error('work_handover_source_stale');
  const admin = createSupabaseAdminClient();
  const summaries = await loadFrozenSummaries(
    admin,
    loaded.organizationId,
    { targetType: loaded.workspace.targetType, targetId: loaded.workspace.targetId },
  );
  const sources = selectedSources.map(({ source }) => ({
    label: source!.label,
    customerPayload: source!.customerPayload,
  }));
  return {
    exportResult: buildWorkHandoverExport({
      releaseId, target: loaded.workspace.targetSnapshot,
      timeSummary: summaries.timeSummary, materialSummary: summaries.materialSummary,
      sources,
    }),
    summaries,
    itemPayloads: asJson(selectedSources.map(({ item, source }) => ({
      draft_item_id: item.id,
      customer_payload: source!.customerPayload,
    }))),
  };
}

export async function getWorkHandoverWorkspace(input: Target): Promise<
  { success: true; workspace: WorkHandoverWorkspace } | Failure
> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await requireHandoverHolder();
  if (!auth.success) return auth;
  try {
    const loaded = await loadWorkspace(auth.context, auth.holder, parsed.data);
    return { success: true, workspace: loaded.workspace };
  } catch (error) {
    return handoverFailureFromException(
      error, 'work_handover_workspace_load_failed', 'load_workspace'
    );
  }
}

export async function getWorkHandoverWorkspaceByNumber(input: {
  targetType: WorkTargetType;
  targetNumber: string;
  projectNumber?: string;
}): Promise<{ success: true; workspace: WorkHandoverWorkspace } | Failure> {
  const parsed = targetNumberSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await requireHandoverHolder();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  if (parsed.data.targetType === 'project') {
    const { data: project, error } = await admin.from('projects').select('id')
      .eq('organization_id', auth.context.orgId)
      .eq('project_number', parsed.data.targetNumber).maybeSingle();
    if (error || !project) return { success: false, error: 'work_handover_target_not_found' };
    try {
      const loaded = await loadWorkspace(auth.context, auth.holder, {
        targetType: 'project', targetId: project.id,
      });
      return { success: true, workspace: loaded.workspace };
    } catch (loadError) {
      return handoverFailureFromException(
        loadError, 'work_handover_workspace_load_failed', 'load_project_workspace'
      );
    }
  }
  const { data: job, error } = await admin.from('jobs').select('id, project_id')
    .eq('organization_id', auth.context.orgId)
    .eq('job_number', parsed.data.targetNumber).maybeSingle();
  if (error || !job) return { success: false, error: 'work_handover_target_not_found' };
  if (parsed.data.projectNumber) {
    const { data: project } = await admin.from('projects').select('id')
      .eq('organization_id', auth.context.orgId)
      .eq('project_number', parsed.data.projectNumber).maybeSingle();
    if (!project || project.id !== job.project_id) {
      return { success: false, error: 'work_handover_target_not_found' };
    }
  } else if (job.project_id) {
    return { success: false, error: 'work_handover_target_not_found' };
  }
  try {
    const loaded = await loadWorkspace(auth.context, auth.holder, {
      targetType: 'job', targetId: job.id,
    });
    return { success: true, workspace: loaded.workspace };
  } catch (loadError) {
    return handoverFailureFromException(
      loadError, 'work_handover_workspace_load_failed', 'load_job_workspace'
    );
  }
}

export async function saveWorkHandoverDraft(input: z.input<typeof saveSchema>): Promise<
  { success: true; packageId: string; packageVersion: number } | Failure
> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await requireHandoverHolder();
  if (!auth.success) return auth;
  try {
    const loaded = await loadWorkspace(auth.context, auth.holder, parsed.data);
    if (loaded.workspace.packageId !== parsed.data.packageId
      || loaded.workspace.packageVersion !== parsed.data.expectedPackageVersion) {
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
      p_organization_id: auth.context.orgId, p_actor_id: auth.context.userId,
      p_target_type: parsed.data.targetType, p_target_id: parsed.data.targetId,
      p_package_id: parsed.data.packageId,
      p_expected_version: parsed.data.expectedPackageVersion,
      p_request_id: parsed.data.requestId,
      p_items: asJson(items),
    });
    if (error || !isRecord(data) || typeof data.version !== 'number') {
      return { success: false, error: mapHandoverError(error) };
    }
    revalidateHandover(auth.context.orgId);
    return { success: true, packageId: parsed.data.packageId, packageVersion: data.version };
  } catch (error) {
    return handoverFailureFromException(error, 'work_handover_action_failed', 'save_draft');
  }
}

export async function previewWorkHandover(input: z.input<typeof previewSchema>): Promise<
  { success: true; html: string; contentHash: string; fileName: string } | Failure
> {
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await requireHandoverHolder();
  if (!auth.success) return auth;
  try {
    const loaded = await loadWorkspace(auth.context, auth.holder, parsed.data);
    if (loaded.workspace.packageId !== parsed.data.packageId
      || loaded.workspace.packageVersion !== parsed.data.expectedPackageVersion) {
      return { success: false, error: 'work_handover_stale_version' };
    }
    const { exportResult } = await buildCurrentExport(loaded, parsed.data.releaseId);
    return {
      success: true, html: exportResult.html,
      contentHash: exportResult.contentHash, fileName: exportResult.fileName,
    };
  } catch (error) {
    return handoverFailureFromException(error, 'work_handover_action_failed', 'preview');
  }
}

export async function releaseWorkHandover(input: z.input<typeof releaseSchema>): Promise<
  { success: true; releaseId: string; documentId: string } | Failure
> {
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await requireHandoverHolder();
  if (!auth.success) return auth;
  try {
    const loaded = await loadWorkspace(auth.context, auth.holder, parsed.data);
    if (loaded.workspace.packageId !== parsed.data.packageId
      || loaded.workspace.packageVersion !== parsed.data.expectedPackageVersion
      || loaded.workspace.executionVersion !== parsed.data.expectedExecutionVersion) {
      return { success: false, error: 'work_handover_stale_version' };
    }
    const { exportResult, summaries, itemPayloads } = await buildCurrentExport(loaded, parsed.data.releaseId);
    if (exportResult.contentHash !== parsed.data.expectedContentHash) {
      return { success: false, error: 'work_handover_preview_stale' };
    }
    const storagePath = `${auth.context.orgId}/work-handover-packages/${parsed.data.releaseId}/${exportResult.rendererVersion}-${exportResult.contentHash}.html`;
    await putStorageObject({
      path: storagePath, body: exportResult.bytes, contentType: 'text/html; charset=utf-8',
    });
    const gateRecord = isRecord(loaded.workspace.gateSnapshot)
      ? loaded.workspace.gateSnapshot
      : {};
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc('release_work_handover', {
      p_organization_id: auth.context.orgId, p_actor_id: auth.context.userId,
      p_package_id: parsed.data.packageId, p_release_id: parsed.data.releaseId,
      p_request_id: parsed.data.requestId,
      p_expected_package_version: parsed.data.expectedPackageVersion,
      p_expected_execution_version: parsed.data.expectedExecutionVersion,
      p_expected_gate_fingerprint: loaded.workspace.gateFingerprint,
      p_handover_reason: parsed.data.reason,
      p_override_gates: parsed.data.overrideGates,
      p_override_reason: parsed.data.overrideReason ?? null,
      p_target_snapshot: asJson(loaded.workspace.targetSnapshot),
      p_time_summary: summaries.timeSummary,
      p_material_summary: summaries.materialSummary,
      p_responsibility_snapshot: asJson({
        responsibility: 'work_handover_review', actorUserId: auth.context.userId,
        employeeRecordId: loaded.holder.employeeRecordId, source: loaded.holder.source,
      }),
      p_unassessed_facts: asJson(Array.isArray(gateRecord.notAssessable)
        ? gateRecord.notAssessable : []),
      p_item_payloads: itemPayloads,
      p_document_id: parsed.data.documentId,
      p_document_link_id: parsed.data.documentLinkId,
      p_storage_path: storagePath, p_file_name: exportResult.fileName,
      p_size_bytes: exportResult.bytes.byteLength,
      p_renderer_version: exportResult.rendererVersion,
      p_content_hash: exportResult.contentHash,
    });
    if (error) {
      const referenceResult = await admin.from('documents').select('id')
        .eq('organization_id', auth.context.orgId).eq('storage_path', storagePath).limit(1);
      if (referenceResult.error) {
        console.error('Failed to verify a work handover object reference:', {
          code: referenceResult.error.code,
          releaseId: parsed.data.releaseId,
        });
      }
      if (!referenceResult.error && (referenceResult.data?.length ?? 0) === 0) {
        await deleteStorageObjects([storagePath]).catch((cleanupError: unknown) => {
          console.error('Failed to remove an unreferenced work handover object', { cleanupError });
        });
      }
      return { success: false, error: mapHandoverError(error) };
    }
    revalidateHandover(auth.context.orgId);
    return { success: true, releaseId: parsed.data.releaseId, documentId: parsed.data.documentId };
  } catch (error) {
    return handoverFailureFromException(error, 'work_handover_action_failed', 'release');
  }
}

async function changeHandoverState(
  input: z.input<typeof reopenSchema>,
  operation: 'withdraw_work_handover' | 'return_work_handover_for_correction',
): Promise<{ success: true } | Failure> {
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await requireHandoverHolder();
  if (!auth.success) return auth;
  const { error } = await createSupabaseAdminClient().rpc(operation, {
    p_organization_id: auth.context.orgId, p_actor_id: auth.context.userId,
    p_package_id: parsed.data.packageId, p_request_id: parsed.data.requestId,
    p_expected_package_version: parsed.data.expectedPackageVersion,
    p_expected_execution_version: parsed.data.expectedExecutionVersion,
    p_reason: parsed.data.reason,
  });
  if (error) return { success: false, error: mapHandoverError(error) };
  revalidateHandover(auth.context.orgId);
  return { success: true };
}

export async function withdrawWorkHandover(input: z.input<typeof reopenSchema>): Promise<
  { success: true } | Failure
> {
  return changeHandoverState(input, 'withdraw_work_handover');
}

export async function returnWorkHandoverForCorrection(input: z.input<typeof reopenSchema>): Promise<
  { success: true } | Failure
> {
  return changeHandoverState(input, 'return_work_handover_for_correction');
}

export async function getWorkHandoverFieldStatus(jobId: string): Promise<
  { success: true; status: WorkHandoverFieldStatus } | Failure
> {
  const parsed = z.string().uuid().safeParse(jobId);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data: job, error: jobError } = await admin.from('jobs').select('id').eq('id', parsed.data)
    .eq('organization_id', auth.context.orgId).maybeSingle();
  if (jobError) {
    console.error('Failed to load work handover field job:', { code: jobError.code });
    return { success: false, error: 'work_handover_status_load_failed' };
  }
  if (!job) return { success: false, error: 'not_authorized' };
  if (!auth.context.isManagerOrAbove) {
    const { data: assignment, error: assignmentError } = await admin.from('job_assignments').select('id')
      .eq('job_id', parsed.data).eq('user_id', auth.context.userId).maybeSingle();
    if (assignmentError) {
      console.error('Failed to load work handover field assignment:', {
        code: assignmentError.code,
      });
      return { success: false, error: 'work_handover_status_load_failed' };
    }
    if (!assignment) return { success: false, error: 'not_authorized' };
  }
  const { data: handoverPackage, error } = await admin.from('work_handover_packages')
    .select('state, current_release_id').eq('organization_id', auth.context.orgId)
    .eq('job_id', parsed.data).maybeSingle();
  if (error || !handoverPackage) {
    return error
      ? { success: false, error: 'work_handover_status_load_failed' }
      : { success: true, status: { state: 'missing', releaseNumber: null, reviewedAt: null, documentId: null } };
  }
  const releaseResult = handoverPackage.current_release_id
      ? await admin.from('work_handover_releases').select(
        'release_number, reviewed_at, package_document_id'
      ).eq('organization_id', auth.context.orgId)
        .eq('id', handoverPackage.current_release_id).maybeSingle()
    : { data: null, error: null };
  if (releaseResult.error) return { success: false, error: 'work_handover_status_load_failed' };
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

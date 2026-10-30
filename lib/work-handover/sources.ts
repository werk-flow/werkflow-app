import 'server-only';

import { DOCUMENT_CATEGORY_LABELS, toDocumentCategory } from '@/lib/documents/types';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { toJson } from '@/lib/supabase/json';
import { readInBatches } from '@/lib/supabase/query-batches';
import { WORK_ARTIFACT_KIND_LABELS } from '@/lib/work-artifacts/types';

import type { WorkHandoverDraftItem, WorkHandoverSourceOption, WorkHandoverTarget } from './types';

// The approved evidence a handover package can select. The actions in
// actions.ts establish the handover holder before they load it.

export type LoadedSourceOption = WorkHandoverSourceOption & { customerPayload: Json };

export const MAX_HANDOVER_SOURCE_ROWS = 500;

function documentSourceKey(documentId: string, version: number): string {
  return `document:${documentId}:${version}`;
}

export function draftSourceKey(item: WorkHandoverDraftItem): string {
  if (item.work_artifact_revision_id) return `artifact:${item.work_artifact_revision_id}`;
  if (item.document_id && item.document_version_number) {
    return documentSourceKey(item.document_id, item.document_version_number);
  }
  return `child:${item.child_handover_release_id}`;
}

async function readTargetEvidence(admin: AdminClient, organizationId: string, target: WorkHandoverTarget) {
  const targetColumn = target.targetType === 'job' ? 'job_id' : 'project_id';
  const [artifactsResult, linksResult] = await Promise.all([
    admin
      .from('work_artifacts')
      .select('id, current_revision_id, kind, status')
      .eq('organization_id', organizationId)
      .eq(targetColumn, target.targetId)
      .eq('status', 'approved')
      .order('updated_at')
      .limit(MAX_HANDOVER_SOURCE_ROWS + 1),
    admin
      .from('document_links')
      .select('document_id')
      .eq('organization_id', organizationId)
      .eq(targetColumn, target.targetId)
      .limit(MAX_HANDOVER_SOURCE_ROWS + 1),
  ]);
  if (artifactsResult.error || linksResult.error) throw new Error('work_handover_sources_load_failed');
  if (
    (artifactsResult.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS ||
    (linksResult.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS
  ) {
    throw new Error('work_handover_sources_overflow');
  }
  return { artifacts: artifactsResult.data ?? [], links: linksResult.data ?? [] };
}

async function loadEvidenceSources(
  admin: AdminClient,
  organizationId: string,
  target: WorkHandoverTarget,
): Promise<LoadedSourceOption[]> {
  const { artifacts, links } = await readTargetEvidence(admin, organizationId, target);
  const revisionIds = artifacts.flatMap((artifact) =>
    artifact.current_revision_id ? [artifact.current_revision_id] : [],
  );
  const documentIds = [...new Set(links.map((link) => link.document_id))];
  // Both id lists are capped above, so these reads return at most one row per id.
  const [revisionsResult, documentsResult] = await Promise.all([
    readInBatches(revisionIds, (batch) =>
      admin
        .from('work_artifact_revisions')
        .select(
          'id, artifact_id, title, visibility, revision_number, summary, performed_work, outstanding_work, work_date',
        )
        .eq('organization_id', organizationId)
        .in('id', [...batch])
        .eq('visibility', 'customer_facing'),
    ),
    readInBatches(documentIds, (batch) =>
      admin
        .from('documents')
        .select('id, display_name, category, mime_type, storage_path, current_version_number')
        .eq('organization_id', organizationId)
        .in('id', [...batch])
        .is('deleted_at', null),
    ),
  ]);
  if (revisionsResult.error || documentsResult.error) throw new Error('work_handover_sources_load_failed');
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const sources: LoadedSourceOption[] = revisionsResult.data.flatMap((revision) => {
    const artifact = artifactsById.get(revision.artifact_id);
    if (!artifact || artifact.current_revision_id !== revision.id) return [];
    return [
      {
        key: `artifact:${revision.id}`,
        kind: 'work_artifact_revision' as const,
        label: revision.title,
        description: `Freigegebener Arbeitsnachweis · Version ${revision.revision_number}`,
        customerPayload: toJson({
          Art: WORK_ARTIFACT_KIND_LABELS[artifact.kind],
          Arbeitstag: revision.work_date,
          Zusammenfassung: revision.summary,
          'Ausgeführte Arbeiten': revision.performed_work,
          'Offene Arbeiten': revision.outstanding_work,
        }),
        workArtifactRevisionId: revision.id,
        documentId: null,
        documentVersionNumber: null,
        documentStoragePath: null,
        childHandoverReleaseId: null,
      },
    ];
  });
  for (const document of documentsResult.data) {
    sources.push({
      key: documentSourceKey(document.id, document.current_version_number),
      kind: 'document_version',
      label: document.display_name,
      description: `Dokument · Version ${document.current_version_number}`,
      customerPayload: toJson({
        Dokument: document.display_name,
        Kategorie: DOCUMENT_CATEGORY_LABELS[toDocumentCategory(document.category)],
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
  return sources;
}

async function loadChildReleaseSources(
  admin: AdminClient,
  organizationId: string,
  projectJobIds: string[],
): Promise<LoadedSourceOption[]> {
  const [jobsResult, packagesResult] = await Promise.all([
    readInBatches(projectJobIds, (batch) =>
      admin
        .from('jobs')
        .select('id, job_number, title')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(projectJobIds, (batch) =>
      admin
        .from('work_handover_packages')
        .select('job_id, current_release_id')
        .eq('organization_id', organizationId)
        .in('job_id', [...batch])
        .eq('state', 'released')
        .not('current_release_id', 'is', null),
    ),
  ]);
  if (jobsResult.error || packagesResult.error) throw new Error('work_handover_sources_load_failed');
  if (packagesResult.data.length > MAX_HANDOVER_SOURCE_ROWS) {
    throw new Error('work_handover_sources_overflow');
  }
  const releaseIds = packagesResult.data.flatMap((entry) =>
    entry.current_release_id ? [entry.current_release_id] : [],
  );
  const releasesResult = await readInBatches(releaseIds, (batch) =>
    admin
      .from('work_handover_releases')
      .select('id, release_number, commercial_readiness')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (releasesResult.error) throw new Error('work_handover_sources_load_failed');
  const jobsById = new Map(jobsResult.data.map((job) => [job.id, job]));
  const releasesById = new Map(releasesResult.data.map((release) => [release.id, release]));
  return packagesResult.data.flatMap((childPackage) => {
    const release = childPackage.current_release_id ? releasesById.get(childPackage.current_release_id) : null;
    const job = childPackage.job_id ? jobsById.get(childPackage.job_id) : null;
    if (!release || !job) return [];
    return [
      {
        key: `child:${release.id}`,
        kind: 'child_handover_release' as const,
        label: job.job_number ? `${job.job_number} · ${job.title}` : job.title,
        description: `Unveränderliche Auftragsübergabe · Freigabe ${release.release_number}`,
        customerPayload: toJson({
          Auftrag: job.job_number ?? job.title,
          Freigabe: release.release_number,
        }),
        workArtifactRevisionId: null,
        documentId: null,
        documentVersionNumber: null,
        documentStoragePath: null,
        childHandoverReleaseId: release.id,
      },
    ];
  });
}

export async function loadAvailableSources(
  admin: AdminClient,
  organizationId: string,
  target: WorkHandoverTarget,
  projectJobIds: string[],
): Promise<LoadedSourceOption[]> {
  const sources = await loadEvidenceSources(admin, organizationId, target);
  if (target.targetType === 'project') {
    sources.push(...(await loadChildReleaseSources(admin, organizationId, projectJobIds)));
  }
  return sources.toSorted((left, right) => left.label.localeCompare(right.label, 'de'));
}

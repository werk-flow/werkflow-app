import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { requireServiceManager, type ServiceManagerContext } from '@/lib/service-cases/manager-context';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { EquipmentSourceOption } from './types';

type SourceWork = { type: 'job' | 'project'; id: string };
type EquipmentScope = { id: string; client_id: string; site_id: string };
type SourceOptionsResult = ActionResult<{ options: EquipmentSourceOption[] }>;

const LOAD_FAILED = { success: false, error: 'installed_equipment_source_load_failed' } as const;

/**
 * The exact sources one equipment can cite, bounded by one record: without
 * `work`, the current versions of the equipment's own documents; with `work`,
 * the Arbeitsnachweis revisions and handover releases of that one job or
 * project. The work is chosen first through the server-searched picker, so no
 * read covers every job and project of the customer. The work must belong to
 * the equipment's customer and to its site or to none, the rule the link RPC
 * enforces.
 */
export async function getEquipmentSourceOptions(input: {
  equipmentId: string;
  work: SourceWork | null;
}): Promise<SourceOptionsResult> {
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const { data: equipment, error } = await loggedRead(
    'getEquipmentSourceOptions: installed_equipment read failed',
    context.admin
      .from('installed_equipment')
      .select('id, client_id, site_id')
      .eq('id', input.equipmentId)
      .eq('organization_id', context.organizationId)
      .is('voided_at', null)
      .maybeSingle(),
  );
  if (error) return LOAD_FAILED;
  if (!equipment) return { success: false, error: 'installed_equipment_not_found' };
  if (!input.work) return readDocumentSources(context, equipment.id);
  return readWorkSources(context, equipment, input.work);
}

async function readDocumentSources(
  context: ServiceManagerContext,
  equipmentId: string,
): Promise<SourceOptionsResult> {
  const linksResult = await readCompleteRows(
    (from, to) =>
      context.admin
        .from('document_links')
        .select('document_id')
        .eq('organization_id', context.organizationId)
        .eq('equipment_id', equipmentId)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (linksResult.error) {
    logReadErrors('getEquipmentSourceOptions: document links read failed', linksResult.error);
    return LOAD_FAILED;
  }
  const documentsResult = await readInBatches(
    linksResult.data.map((link) => link.document_id),
    (batch) =>
      context.admin
        .from('documents')
        .select('id, display_name, current_version_number')
        .eq('organization_id', context.organizationId)
        .in('id', [...batch])
        .is('deleted_at', null),
  );
  if (documentsResult.error) {
    logReadErrors('getEquipmentSourceOptions: documents read failed', documentsResult.error);
    return LOAD_FAILED;
  }
  return {
    success: true,
    options: documentsResult.data
      .sort((left, right) => left.display_name.localeCompare(right.display_name, 'de'))
      .map((document) => ({
        value: `document:${document.id}:${document.current_version_number}`,
        targetType: 'document' as const,
        targetId: document.id,
        label: `${document.display_name}, Version ${document.current_version_number}`,
        description: 'Exakte Dokumentversion',
        documentVersionNumber: document.current_version_number,
      })),
  };
}

/** The work's label, null when it is not work of the equipment's customer and site, or 'failed'. */
async function readWorkLabel(
  context: ServiceManagerContext,
  equipment: EquipmentScope,
  work: SourceWork,
): Promise<string | null | 'failed'> {
  const siteRule = `site_id.is.null,site_id.eq.${equipment.site_id}`;
  if (work.type === 'job') {
    const { data, error } = await loggedRead(
      'getEquipmentSourceOptions: job read failed',
      context.admin
        .from('jobs')
        .select('id, job_number, title')
        .eq('id', work.id)
        .eq('organization_id', context.organizationId)
        .eq('client_id', equipment.client_id)
        .or(siteRule)
        .maybeSingle(),
    );
    if (error) return 'failed';
    return data ? `Auftrag ${data.job_number ?? data.title}` : null;
  }
  const { data, error } = await loggedRead(
    'getEquipmentSourceOptions: project read failed',
    context.admin
      .from('projects')
      .select('id, project_number, name')
      .eq('id', work.id)
      .eq('organization_id', context.organizationId)
      .eq('client_id', equipment.client_id)
      .or(siteRule)
      .maybeSingle(),
  );
  if (error) return 'failed';
  return data ? `Projekt ${data.project_number ?? data.name}` : null;
}

async function readWorkSources(
  context: ServiceManagerContext,
  equipment: EquipmentScope,
  work: SourceWork,
): Promise<SourceOptionsResult> {
  const workLabel = await readWorkLabel(context, equipment, work);
  if (workLabel === 'failed') return LOAD_FAILED;
  if (workLabel === null) return { success: false, error: 'installed_equipment_source_target_invalid' };
  const column = work.type === 'job' ? 'job_id' : 'project_id';
  const [artifactsResult, packagesResult] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        context.admin
          .from('work_artifacts')
          .select('id')
          .eq('organization_id', context.organizationId)
          .eq(column, work.id)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        context.admin
          .from('work_handover_packages')
          .select('id')
          .eq('organization_id', context.organizationId)
          .eq(column, work.id)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);
  if (artifactsResult.error || packagesResult.error) {
    logReadErrors('getEquipmentSourceOptions: work read failed', artifactsResult.error, packagesResult.error);
    return LOAD_FAILED;
  }
  const [revisionsResult, releasesResult] = await Promise.all([
    readInBatches(
      artifactsResult.data.map((artifact) => artifact.id),
      (batch) =>
        readCompleteRows(
          (from, to) =>
            context.admin
              .from('work_artifact_revisions')
              .select('id, revision_number, title')
              .eq('organization_id', context.organizationId)
              .in('artifact_id', [...batch])
              .order('id')
              .range(from, to),
          LIST_ROW_CAP,
        ),
    ),
    readInBatches(
      packagesResult.data.map((item) => item.id),
      (batch) =>
        readCompleteRows(
          (from, to) =>
            context.admin
              .from('work_handover_releases')
              .select('id, release_number')
              .eq('organization_id', context.organizationId)
              .in('package_id', [...batch])
              .order('id')
              .range(from, to),
          LIST_ROW_CAP,
        ),
    ),
  ]);
  if (revisionsResult.error || releasesResult.error) {
    logReadErrors(
      'getEquipmentSourceOptions: revision read failed',
      revisionsResult.error,
      releasesResult.error,
    );
    return LOAD_FAILED;
  }
  return {
    success: true,
    options: [
      ...revisionsResult.data.map((revision) => ({
        value: `artifact_revision:${revision.id}`,
        targetType: 'artifact_revision' as const,
        targetId: revision.id,
        label: `${revision.title}, Revision ${revision.revision_number}`,
        description: 'Exakte Arbeitsnachweis-Revision',
      })),
      ...releasesResult.data.map((release) => ({
        value: `handover_release:${release.id}`,
        targetType: 'handover_release' as const,
        targetId: release.id,
        label: `${workLabel}, Freigabe ${release.release_number}`,
        description: 'Exakter unveränderlicher Übergabestand',
      })),
    ],
  };
}

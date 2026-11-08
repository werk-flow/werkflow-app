import 'server-only';

import { buildStoredZip } from '@/lib/format/csv-zip';
import { logError } from '@/lib/logging';
import { createSignedDownloadUrl, putStorageObject, readStorageObject } from '@/lib/storage/r2';
import type { AdminClient } from '@/lib/supabase/admin';
import { mapInWindows, readCompleteRows } from '@/lib/supabase/query-batches';
import { isJsonRecord, toJson } from '@/lib/supabase/json';
import { buildDataPartFiles } from './data-part';
import { exportSourceFiles, readDocumentArchive } from './documents';
import { PART_FAILURE_REASONS } from './messages';
import { PART_FILE_LIMIT, planFileParts } from './plan';
import { readExportParts } from './reads';

// The steps of an organization export after the action authorized an Admin
// (werk-flow/werkflow-planning#287). Each database function checks the Admin
// again. Every step throws a stable code or a provider error; the action
// maps it to its result.

type ExportContext = { organizationId: string; userId: string };

const PART_FAILURE_CODES = new Set<string>(PART_FAILURE_REASONS);

function partFailureReason(error: unknown): string {
  return error instanceof Error && PART_FAILURE_CODES.has(error.message) ? error.message : 'build_failed';
}

/** A database refusal raised as a code, such as `export_plan_stale`, or the fallback. */
function refusal(error: { message: string }, fallback: string): Error {
  return new Error(/^[a-z][a-z0-9_]*$/.test(error.message) ? error.message : fallback);
}

/**
 * Plans every original file of the organization into parts and starts the
 * export. Returns its id and its parts in build order.
 */
export async function startExport(
  admin: AdminClient,
  context: ExportContext,
): Promise<{ exportId: string; partIds: string[] }> {
  const archive = await readDocumentArchive(admin, context.organizationId);
  const fileParts = planFileParts(exportSourceFiles(archive));
  const { data: exportId, error } = await admin.rpc('start_organization_export', {
    p_actor_id: context.userId,
    p_organization_id: context.organizationId,
    p_file_parts: toJson(fileParts),
  });
  if (error) throw refusal(error, 'export_start_failed');
  const { data: started, error: startedError } = await admin
    .from('organization_exports')
    .select('id, part_count')
    .eq('organization_id', context.organizationId)
    .eq('id', exportId)
    .single();
  if (startedError) throw new Error('load_failed');
  const parts = await readExportParts(admin, context.organizationId, started);
  return { exportId, partIds: parts.map((part) => part.id) };
}

/** The stored originals of one file part, by their names in the archive. */
async function readFilePartFiles(
  admin: AdminClient,
  organizationId: string,
  partId: string,
): Promise<Record<string, Uint8Array>> {
  const planned = await readCompleteRows(
    (from, to) =>
      admin
        .from('organization_export_files')
        .select('source_path, archive_name')
        .eq('organization_id', organizationId)
        .eq('part_id', partId)
        .order('archive_name')
        .range(from, to),
    PART_FILE_LIMIT,
  );
  if (planned.error) throw new Error('load_failed');
  const files = await mapInWindows(
    planned.data,
    async (file) =>
      [file.archive_name, await readStorageObject({ organizationId, path: file.source_path })] as const,
    () => false,
  );
  return Object.fromEntries(files);
}

type BuildablePart = {
  exportId: string;
  kind: string;
  archivePath: string;
  partCount: number;
};

/**
 * Claims the part for this build: of the caller's organization, not ready, of
 * an export inside its seven days. The same call queues the part's archive
 * for the purge seven days from now, before this build stores anything.
 */
async function claimPartBuild(
  admin: AdminClient,
  context: ExportContext,
  partId: string,
): Promise<BuildablePart> {
  const { data, error } = await admin.rpc('claim_organization_export_part_build', {
    p_actor_id: context.userId,
    p_organization_id: context.organizationId,
    p_part_id: partId,
  });
  if (error) throw refusal(error, 'export_part_claim_failed');
  const claimed = isJsonRecord(data) ? data : {};
  const { exportId, kind, archivePath, partCount } = claimed;
  if (
    typeof exportId !== 'string' ||
    typeof kind !== 'string' ||
    typeof archivePath !== 'string' ||
    typeof partCount !== 'number'
  )
    throw new Error('load_failed');
  return { exportId, kind, archivePath, partCount };
}

/**
 * Packs the part's archive and stores it at the part's path, unless an
 * archive is there already: the first archive stored for a part never
 * changes, so a second build, concurrent or after a lost completion, records
 * the stored archive's size instead of its own bytes.
 */
async function packAndStore(
  admin: AdminClient,
  organizationId: string,
  partId: string,
  part: BuildablePart,
): Promise<number> {
  const files =
    part.kind === 'data'
      ? await buildDataPartFiles(admin, {
          organizationId,
          exportId: part.exportId,
          partCount: part.partCount,
        })
      : await readFilePartFiles(admin, organizationId, partId);
  const archive = buildStoredZip(files);
  const stored = await putStorageObject({
    organizationId,
    path: part.archivePath,
    body: archive,
    contentType: 'application/zip',
    ifAbsent: true,
  });
  if (stored.created) return archive.length;
  if (stored.sizeBytes === null) throw new Error('load_failed');
  return stored.sizeBytes;
}

/**
 * Builds one part in this request: claims it, packs its archive, stores it
 * at the part's fixed path and records it ready until its purge falls due. A failure records
 * the part failed with a stable reason and rethrows; only this part builds
 * again. Either way the build ends in one database call.
 */
export async function buildExportPart(
  admin: AdminClient,
  context: ExportContext,
  partId: string,
): Promise<void> {
  const part = await claimPartBuild(admin, context, partId);
  const outcome = await packAndStore(admin, context.organizationId, partId, part).then(
    (archiveBytes) => ({ archiveBytes, error: null }),
    (error: unknown) => ({ archiveBytes: null, error }),
  );
  if (outcome.archiveBytes !== null) {
    const { error } = await admin.rpc('complete_organization_export_part', {
      p_actor_id: context.userId,
      p_organization_id: context.organizationId,
      p_part_id: partId,
      p_archive_bytes: outcome.archiveBytes,
    });
    // A stored archive whose completion failed is deleted with its claim's purge entry.
    if (error) throw refusal(error, 'export_part_complete_failed');
    return;
  }
  const { error: failError } = await admin.rpc('fail_organization_export_part', {
    p_actor_id: context.userId,
    p_organization_id: context.organizationId,
    p_part_id: partId,
    p_failure_reason: partFailureReason(outcome.error),
  });
  if (failError) logError('buildExportPart: fail_organization_export_part failed', failError);
  throw outcome.error;
}

/** Records the download of a ready part and signs a short-lived URL for its archive. */
export async function signExportDownload(
  admin: AdminClient,
  context: ExportContext,
  partId: string,
): Promise<string> {
  const { data, error } = await admin.rpc('record_organization_export_download', {
    p_actor_id: context.userId,
    p_organization_id: context.organizationId,
    p_part_id: partId,
  });
  if (error) throw refusal(error, 'export_download_failed');
  const download = isJsonRecord(data) ? data : {};
  const { archivePath, partNumber, partCount, requestedAt } = download;
  if (typeof archivePath !== 'string' || typeof requestedAt !== 'string')
    throw new Error('export_download_failed');
  return createSignedDownloadUrl({
    organizationId: context.organizationId,
    path: archivePath,
    disposition: 'attachment',
    downloadFileName: `WerkFlow-Datenexport-${requestedAt.slice(0, 10)}-Teil-${String(partNumber)}-von-${String(partCount)}.zip`,
  });
}

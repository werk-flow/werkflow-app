import 'server-only';

import type { PostgrestError, PostgrestSingleResponse } from '@supabase/supabase-js';

import type { ActionFailure } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { discardStorageObjects } from '@/lib/storage/r2';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';

import { mapArtifactError } from './errors';

/**
 * Removes a generated export object after its registration failed, unless a
 * document owns its path: a committed export of the same content writes the
 * same key. A failed read keeps the object, since only a completed read
 * proves that no document owns it.
 */
export async function discardUnreferencedExportObject(
  admin: AdminClient,
  organizationId: string,
  storagePath: string,
  failureLabel: string,
): Promise<void> {
  const reference = await admin
    .from('documents')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('storage_path', storagePath)
    .limit(1);
  if (reference.error) logError(failureLabel, reference.error);
  if (!reference.error && (reference.data?.length ?? 0) === 0) {
    await discardStorageObjects({ organizationId, paths: [storagePath] });
  }
}

/** The document a committed export of this revision, renderer and content already registered. */
export async function readRenderedExport(
  admin: AdminClient,
  organizationId: string,
  revisionId: string,
  exportFile: { rendererVersion: string; contentHash: string },
): Promise<{ data: { document_id: string } | null; error: PostgrestError | null }> {
  return loggedRead(
    'exportWorkArtifact: work_artifact_revision_documents read failed',
    admin
      .from('work_artifact_revision_documents')
      .select('document_id')
      .eq('organization_id', organizationId)
      .eq('revision_id', revisionId)
      .eq('relation', 'rendered_export')
      .eq('renderer_version', exportFile.rendererVersion)
      .eq('content_hash', exportFile.contentHash)
      .maybeSingle(),
  );
}

/**
 * Registers a stored export: one transaction writes the document, its link,
 * the artifact relation and action and the audit event, or refuses and
 * changes nothing.
 */
export async function registerWorkArtifactExport(
  admin: AdminClient,
  registration: {
    organizationId: string;
    actorId: string;
    artifactId: string;
    revisionId: string;
    input: { linkId: string; actionId: string; expectedVersion: number; documentId: string };
    storagePath: string;
    exportFile: { fileName: string; bytes: Buffer; rendererVersion: string; contentHash: string };
  },
): Promise<PostgrestSingleResponse<Json>> {
  const { input, exportFile } = registration;
  return admin.rpc('export_work_artifact', {
    p_organization_id: registration.organizationId,
    p_actor_id: registration.actorId,
    p_artifact_id: registration.artifactId,
    p_revision_id: registration.revisionId,
    p_link_id: input.linkId,
    p_action_id: input.actionId,
    p_expected_version: input.expectedVersion,
    p_document_id: input.documentId,
    p_storage_path: registration.storagePath,
    p_file_name: exportFile.fileName,
    p_size_bytes: exportFile.bytes.byteLength,
    p_renderer_version: exportFile.rendererVersion,
    p_content_hash: exportFile.contentHash,
  });
}

/** The failure of a refused export registration, after its unreferenced object is removed. */
export async function refuseWorkArtifactExport(
  admin: AdminClient,
  organizationId: string,
  storagePath: string,
  error: { message?: string } | null,
): Promise<ActionFailure> {
  // A committed export of the same content owns an object of this same path.
  await discardUnreferencedExportObject(
    admin,
    organizationId,
    storagePath,
    'Failed to verify a work artifact export reference',
  );
  logError('Failed to export work artifact', error);
  const code = mapArtifactError(error);
  return {
    success: false,
    error: code === 'work_artifact_action_failed' ? 'work_artifact_export_failed' : code,
  };
}

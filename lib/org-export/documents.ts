import 'server-only';

import { getFolderPath } from '@/lib/documents/folder-tree';
import { toDocumentFolder, type DocumentFolder } from '@/lib/documents/types';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { readCompleteRows } from '@/lib/supabase/query-batches';
import type { ExportSourceFile } from './plan';

// The organization's documents as the export reads them: for the file plan
// at the start, and for the manifest in the data part. Every read filters on
// the caller's organization.

/** The most rows one read of the export takes; above it the export fails as too large. */
export const EXPORT_ROW_CAP = 1_000_000;

export type DocumentArchiveRows = {
  documents: Tables<'documents'>[];
  versions: Tables<'document_versions'>[];
  folders: Map<string, DocumentFolder>;
  links: Tables<'document_links'>[];
  /** The personnel access class of each personnel document. */
  personnelClasses: Map<string, Tables<'personnel_documents'>['access_class']>;
};

function rowsOrThrow<Row>(result: { data: Row[]; error: { message: string } | null }): Row[] {
  if (result.error) throw new Error('load_failed');
  return result.data;
}

/** Every document, version, folder, link and personnel class of the organization. */
export async function readDocumentArchive(
  admin: AdminClient,
  organizationId: string,
): Promise<DocumentArchiveRows> {
  const [documents, versions, folders, links, personnel] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin.from('documents').select('*').eq('organization_id', organizationId).order('id').range(from, to),
      EXPORT_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('document_versions')
          .select('*')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      EXPORT_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('document_folders')
          .select('*')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      EXPORT_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('document_links')
          .select('*')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      EXPORT_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('personnel_documents')
          .select('document_id, access_class')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      EXPORT_ROW_CAP,
    ),
  ]);
  return {
    documents: rowsOrThrow(documents),
    versions: rowsOrThrow(versions),
    folders: new Map(rowsOrThrow(folders).map((row) => [row.id, toDocumentFolder(row)])),
    links: rowsOrThrow(links),
    personnelClasses: new Map(rowsOrThrow(personnel).map((row) => [row.document_id, row.access_class])),
  };
}

/** The folder names from the library root down to the document's folder. */
function folderNames(archive: DocumentArchiveRows, folderId: string | null): string[] {
  return getFolderPath(archive.folders, folderId).map((folder) => folder.name);
}

/**
 * Where a document's files go below `Dateien/`: its library folders, or
 * `Ohne Ordner`. A personnel file goes under `Personalakten`, a trashed
 * document under `Papierkorb`, so neither mixes with the library's files.
 */
function exportLocation(archive: DocumentArchiveRows, document: Tables<'documents'>): string[] {
  const folders = folderNames(archive, document.folder_id);
  const base = archive.personnelClasses.has(document.id)
    ? ['Personalakten', ...folders]
    : folders.length > 0
      ? folders
      : ['Ohne Ordner'];
  return document.deleted_at ? ['Papierkorb', ...base] : base;
}

/** Every stored original of the organization: each current file and each earlier version. */
export function exportSourceFiles(archive: DocumentArchiveRows): ExportSourceFile[] {
  const documents = new Map(archive.documents.map((document) => [document.id, document]));
  const current = archive.documents.map((document) => ({
    sourcePath: document.storage_path,
    documentId: document.id,
    versionNumber: null,
    fileBytes: document.size_bytes,
    displayName: document.display_name,
    originalFileName: document.original_file_name,
    location: exportLocation(archive, document),
  }));
  const earlier = archive.versions.flatMap((version) => {
    const document = documents.get(version.document_id);
    // A version always belongs to a document of the same organization; one
    // without it would be a broken row, and the start refuses the plan.
    if (!document) return [];
    return [
      {
        sourcePath: version.storage_path,
        documentId: version.document_id,
        versionNumber: version.version_number,
        fileBytes: version.size_bytes,
        displayName: document.display_name,
        originalFileName: version.original_file_name,
        location: exportLocation(archive, document),
      },
    ];
  });
  return [...current, ...earlier];
}

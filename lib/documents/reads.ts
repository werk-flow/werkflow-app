import 'server-only';

import { loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import type { AuthorizedDocumentContext } from './access';
import { documentRowsFromOrdinaryView, hydrateDocuments } from './hydration';
import { newestDocumentsFirst } from './ordering';
import { toDocumentFolder, type DocumentFolder, type DocumentListResult } from './types';

// Server reads of the document actions. They take the context of a caller
// whose access to the target the action has already checked.

export type DocumentLinkColumn =
  | 'job_id'
  | 'project_id'
  | 'client_id'
  | 'employee_id'
  | 'request_id'
  | 'equipment_id'
  | 'service_case_id'
  | 'maintenance_coverage_id';

/** The ordinary documents linked to one target, newest first. */
export async function readLinkedDocuments(
  context: AuthorizedDocumentContext,
  column: DocumentLinkColumn,
  targetId: string,
): Promise<DocumentListResult> {
  const { data: links, error: linksError } = await readCompleteRows(
    (from, to) =>
      context.admin
        .from('document_links')
        .select('document_id')
        .eq('organization_id', context.orgId)
        .eq(column, targetId)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (linksError) {
    logReadErrors(`readLinkedDocuments: ${column} links read failed`, linksError);
    return { success: false, error: 'documents_failed' };
  }

  const documentIds = (links ?? []).map((link) => link.document_id);
  if (documentIds.length === 0) return { success: true, documents: [] };

  const { data: documents, error: documentsError } = await readInBatches(documentIds, (ids) =>
    context.admin
      .from('ordinary_documents')
      .select('*')
      .eq('organization_id', context.orgId)
      .in('id', [...ids])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id'),
  );
  if (documentsError) {
    logReadErrors(`readLinkedDocuments: ${column} documents read failed`, documentsError);
    return { success: false, error: 'documents_failed' };
  }

  try {
    return {
      success: true,
      documents: await hydrateDocuments(
        context.admin,
        newestDocumentsFirst(documentRowsFromOrdinaryView(documents ?? [])),
      ),
    };
  } catch (error) {
    logError(`readLinkedDocuments: ${column} hydration failed`, error);
    return { success: false, error: 'documents_failed' };
  }
}

/**
 * The current storage path of one document of the caller's organization:
 * `null` when no row exists, `undefined` when the read failed (logged).
 */
export async function readDocumentStoragePath(
  context: AuthorizedDocumentContext,
  documentId: string,
): Promise<string | null | undefined> {
  const { data, error } = await loggedRead(
    'readDocumentStoragePath: documents read failed',
    context.admin
      .from('documents')
      .select('storage_path')
      .eq('id', documentId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (error) return undefined;
  return data?.storage_path ?? null;
}

export async function getFolderBreadcrumbs({
  admin,
  orgId,
  folderId,
}: {
  admin: AuthorizedDocumentContext['admin'];
  orgId: string;
  folderId?: string | null;
}): Promise<DocumentFolder[]> {
  const breadcrumbs: DocumentFolder[] = [];
  const visited = new Set<string>();
  let currentId = folderId ?? null;
  while (currentId) {
    if (visited.has(currentId) || visited.size >= 100)
      throw new Error('Der Ordnerpfad konnte nicht geladen werden.');
    visited.add(currentId);
    const result = await admin
      .from('document_folders')
      .select('*')
      .eq('organization_id', orgId)
      .eq('id', currentId)
      .is('deleted_at', null)
      .maybeSingle();
    if (result.error || !result.data) throw new Error('Der Ordnerpfad konnte nicht geladen werden.');
    breadcrumbs.unshift(toDocumentFolder(result.data));
    currentId = result.data.parent_folder_id;
  }
  return breadcrumbs;
}

export function applyDocumentSearch<
  T extends {
    ilike: (column: string, pattern: string) => T;
    or: (filters: string) => T;
  },
>(query: T, searchQuery?: string | null): T {
  const search = searchQuery?.trim();
  if (!search) return query;

  const escapedSearch = search.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[%_]/g, '\\$&');
  const pattern = `"%${escapedSearch}%"`;

  return query.or(`display_name.ilike.${pattern},original_file_name.ilike.${pattern}`);
}

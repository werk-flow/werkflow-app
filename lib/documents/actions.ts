'use server';

import { randomUUID } from 'crypto';
import type { ActionResult } from '@/lib/action-result';
import { loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { entityIdPageSchema } from '@/lib/jobs/list-page';
import type { Job } from '@/lib/jobs/types';
import { logError } from '@/lib/logging';
import { getOrgMembersForUser } from '@/lib/members/queries';
import {
  copyStorageObject,
  createSignedDownloadUrl,
  createSignedUploadUrl,
  deleteStorageObjects,
  discardStorageObjects,
} from '@/lib/storage/r2';
import { readAllRows, readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { LIST_PAGE_SIZE, parseListPage } from '@/lib/ui/list-pagination';
import { uuidSchema } from '@/lib/validation/uuid';
import {
  authorizeDocumentUploadTarget,
  ensureClientManagerAccess,
  ensureEmployeeManagerAccess,
  ensureEquipmentManagerAccess,
  ensureFolder,
  ensureJobAccess,
  ensureMaintenanceCoverageManagerAccess,
  ensureProjectManagerAccess,
  ensureProjectWorkAccess,
  ensureRequestManagerAccess,
  ensureServiceCaseManagerAccess,
  getAuthorizedDocument,
  getAuthorizedDocumentContext,
  getDeletedDocumentForManager,
  getFolderById,
  getVersionableDocument,
  normalizeUploadTarget,
  requireManager,
  type NormalizedUploadTarget,
} from './access';
import {
  attachableDocumentsInputSchema,
  copyDocumentInputSchema,
  copyFolderInputSchema,
  createDocumentUploadTicketInputSchema,
  createDocumentVersionUploadTicketInputSchema,
  createFolderInputSchema,
  documentLibraryInputSchema,
  finalizeDocumentUploadInputSchema,
  finalizeDocumentVersionUploadInputSchema,
  INVALID_INPUT,
  linkDocumentsToTargetInputSchema,
  moveDocumentInputSchema,
  moveFolderInputSchema,
  parseActionInput,
  projectOverviewJobsSchema,
  renameDocumentInputSchema,
  renameFolderInputSchema,
  signedUrlOptionsSchema,
  unlinkDocumentInputSchema,
  updateDocumentCategoryInputSchema,
  updateDocumentLinksInputSchema,
  type AttachableDocumentsInput,
  type CopyDocumentInput,
  type CopyFolderInput,
  type CreateDocumentUploadTicketInput,
  type CreateDocumentVersionUploadTicketInput,
  type CreateFolderInput,
  type DocumentLibraryInput,
  type FinalizeDocumentUploadInput,
  type FinalizeDocumentVersionUploadInput,
  type MoveDocumentInput,
  type MoveFolderInput,
  type RenameDocumentInput,
  type RenameFolderInput,
  type UnlinkDocumentInput,
  type UpdateDocumentCategoryInput,
} from './action-schemas';
import { inferDocumentCategory } from './category-inference';
import { copyFolderTree, orderCopiedFolderTree } from './folder-copy';
import { getDescendantFolderIds } from './folder-tree';
import {
  documentRowsFromOrdinaryView,
  hydrateDocumentAuditEvents,
  hydrateDocuments,
  hydrateDocumentsOrNull,
  hydrateDocumentVersions,
  hydrateFolders,
  hydrateWrittenDocument,
} from './hydration';
import { linkDocumentToTarget, singleLinkTarget, writeDocumentLinks, type DocumentLinkTarget } from './links';
import { getCopyDisplayName } from './names';
import {
  applyDocumentSearch,
  getFolderBreadcrumbs,
  readDocumentStoragePath,
  readLinkedDocuments,
  type DocumentLinkColumn,
} from './reads';
import { buildDocumentStoragePath, buildDocumentVersionStoragePath } from './storage-path';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_MAX_FILE_SIZE_BYTES,
  DOCUMENT_STORAGE_BUCKET,
  toDocumentCategory,
  toDocumentFolder,
  type DocumentAuditEventRow,
  type DocumentCategory,
  type DocumentDetailsResult,
  type DocumentEmployee,
  type DocumentFolder,
  type DocumentFolderRow,
  type DocumentLibraryResult,
  type DocumentLinkRow,
  type DocumentListResult,
  type DocumentMutationResult,
  type DocumentResult,
  type DocumentRow,
  type DocumentUploadTicketResult,
  type DocumentVersion,
  type DocumentVersionRow,
  type DocumentVersionUploadTicketResult,
  type FolderResult,
  type LinkDocumentsToTargetInput,
  type LinkDocumentsToTargetResult,
  type ProjectDocumentsOverviewResult,
  type SignedDocumentUrlResult,
  type UpdateDocumentLinksInput,
  type UpdateDocumentLinksResult,
  type VersionResult,
} from './types';
import {
  documentWriteFailure,
  getAvailableDisplayName,
  revalidateDocuments,
  verifyUploadedObject,
} from './write-support';

function parseDocumentCategory(value: FormDataEntryValue | null): DocumentCategory | null {
  if (typeof value !== 'string') return null;
  const category = toDocumentCategory(value);
  return DOCUMENT_CATEGORIES.includes(category) ? category : null;
}

// Types the in-app viewer actually previews. Everything else is delivered as a
// download so uploader-controlled active content (HTML, SVG) can never render
// inline from the storage origin.
const SAFE_INLINE_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'text/plain',
]);

function inlineSafeDisposition(mimeType: string | null): 'inline' | 'attachment' {
  return mimeType && SAFE_INLINE_MIME_TYPES.has(mimeType.toLowerCase()) ? 'inline' : 'attachment';
}

const UPLOAD_LINK_KINDS = [
  ['job', 'jobId'],
  ['project', 'projectId'],
  ['client', 'clientId'],
  ['employee', 'employeeId'],
  ['request', 'requestId'],
  ['equipment', 'equipmentId'],
  ['service_case', 'serviceCaseId'],
  ['maintenance_coverage', 'maintenanceCoverageId'],
] as const;

/** The one record an upload links to, or null for a library upload. */
function uploadLinkTarget(target: NormalizedUploadTarget): { kind: string; id: string } | null {
  for (const [kind, key] of UPLOAD_LINK_KINDS) {
    const id = target[key];
    if (id) return { kind, id };
  }
  return null;
}

export async function getDocumentLibrary(
  rawInput: DocumentLibraryInput = {},
): Promise<DocumentLibraryResult> {
  const input = parseActionInput(documentLibraryInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;
  const { context } = auth;
  const manager = requireManager(context);
  if (!manager.success) return manager;
  const folderId = input.folderId ?? null;
  const view = input.view ?? 'folders';
  const sort = input.sort ?? 'name';
  const page = parseListPage(input.page);
  const folderPage = parseListPage(input.folderPage);
  if (view !== 'trash') {
    const folderCheck = await ensureFolder(context.admin, context.orgId, folderId);
    if (!folderCheck.success) return folderCheck;
  }
  const isFolderView = view === 'folders' || Boolean(folderId);
  let foldersQuery = context.admin
    .from('document_folders')
    .select('*', { count: 'exact' })
    .eq('organization_id', context.orgId)
    .is('deleted_at', null)
    .order('name')
    .order('id');
  foldersQuery = folderId
    ? foldersQuery.eq('parent_folder_id', folderId)
    : foldersQuery.is('parent_folder_id', null);
  const [selection, foldersResult] = await Promise.all([
    context.admin.rpc('list_document_page', {
      p_organization_id: context.orgId,
      p_filters: {
        folderId,
        view,
        sort,
        searchQuery: (input.searchQuery ?? '').trim().slice(0, 250),
        category: input.category ?? 'all',
        linkFilter: input.linkFilter ?? 'all',
        page,
        pageSize: LIST_PAGE_SIZE,
      },
    }),
    isFolderView && view !== 'trash'
      ? foldersQuery.range((folderPage - 1) * LIST_PAGE_SIZE, folderPage * LIST_PAGE_SIZE - 1)
      : Promise.resolve({ data: [], error: null, count: 0 }),
  ]);
  const selected = entityIdPageSchema.safeParse(selection.data);
  if (selection.error || !selected.success || foldersResult.error)
    return { success: false, error: 'documents_failed' };
  const documentsResult = await readInBatches(selected.data.ids, (ids) =>
    context.admin
      .from('ordinary_documents')
      .select('*')
      .eq('organization_id', context.orgId)
      .in('id', [...ids]),
  );
  if (documentsResult.error) {
    logReadErrors('getDocumentLibrary: read failed', documentsResult.error);
    return { success: false, error: 'documents_failed' };
  }
  const rows = selected.data.ids.flatMap((id) => {
    const row = documentsResult.data.find((row) => row.id === id);
    return row ? [row] : [];
  });
  try {
    const [breadcrumbs, folders, documents] = await Promise.all([
      view === 'trash' ? [] : getFolderBreadcrumbs({ admin: context.admin, orgId: context.orgId, folderId }),
      hydrateFolders(context.admin, foldersResult.data),
      hydrateDocuments(context.admin, documentRowsFromOrdinaryView(rows)),
    ]);
    return {
      success: true,
      page,
      total: selected.data.total,
      folderPage,
      folderTotal: foldersResult.count ?? 0,
      breadcrumbs,
      folders,
      documents,
    };
  } catch (error) {
    logError('Error hydrating the document library', error);
    return { success: false, error: 'documents_failed' };
  }
}
export async function getDocumentFolderOptions(): Promise<ActionResult<{ folders: DocumentFolder[] }>> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const { data, error, overflow } = await readAllRows(
    (from, to) =>
      auth.context.admin
        .from('document_folders')
        .select('*')
        .eq('organization_id', auth.context.orgId)
        .is('deleted_at', null)
        .order('name')
        .order('id')
        .range(from, to),
    { cap: LIST_ROW_CAP },
  );
  if (error || overflow) {
    logError('Failed to load document folder options', error);
    return { success: false, error: 'folders_failed' };
  }

  try {
    return {
      success: true,
      folders: await hydrateFolders(auth.context.admin, (data ?? []) as DocumentFolderRow[]),
    };
  } catch (hydrationError) {
    logError('Failed to hydrate document folder options', hydrationError);
    return { success: false, error: 'folders_failed' };
  }
}

const ATTACHABLE_DOCUMENT_PAGE_SIZE = 50;

export async function getAttachableDocuments(
  rawInput: AttachableDocumentsInput,
): Promise<DocumentListResult & { hasMore?: boolean }> {
  const input = parseActionInput(attachableDocumentsInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  let access: ActionResult;
  let linkColumn: Exclude<DocumentLinkColumn, 'request_id'>;
  switch (input.targetType) {
    case 'job':
      access = await ensureJobAccess(auth.context, input.targetId);
      linkColumn = 'job_id';
      break;
    case 'project':
      access = await ensureProjectManagerAccess(auth.context, input.targetId);
      linkColumn = 'project_id';
      break;
    case 'client':
      access = await ensureClientManagerAccess(auth.context, input.targetId);
      linkColumn = 'client_id';
      break;
    case 'employee':
      access = await ensureEmployeeManagerAccess(auth.context, input.targetId);
      linkColumn = 'employee_id';
      break;
    case 'equipment':
      access = await ensureEquipmentManagerAccess(auth.context, input.targetId);
      linkColumn = 'equipment_id';
      break;
    case 'service_case':
      access = await ensureServiceCaseManagerAccess(auth.context, input.targetId);
      linkColumn = 'service_case_id';
      break;
    case 'maintenance_coverage':
      access = await ensureMaintenanceCoverageManagerAccess(auth.context, input.targetId);
      linkColumn = 'maintenance_coverage_id';
      break;
    default:
      return { success: false, error: 'invalid_target' };
  }
  if (!access.success) return access;
  let query = auth.context.admin
    .from('ordinary_documents')
    .select('*, existing:document_links()')
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null)
    .eq('existing.organization_id', auth.context.orgId)
    .eq(`existing.${linkColumn}`, input.targetId)
    .is('existing', null);

  query = applyDocumentSearch(query, input.searchQuery);

  if (input.category && input.category !== 'all') {
    query = query.eq('category', input.category);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(ATTACHABLE_DOCUMENT_PAGE_SIZE + 1);

  if (error) {
    logError('Failed to load attachable documents', error);
    return { success: false, error: 'documents_failed' };
  }

  // One row beyond the page tells the dialog that a search can find more.
  const rows = (data ?? []) as DocumentRow[];
  const documents = await hydrateDocumentsOrNull(
    auth.context.admin,
    rows.slice(0, ATTACHABLE_DOCUMENT_PAGE_SIZE),
    'Failed to hydrate attachable documents',
  );
  if (!documents) return { success: false, error: 'documents_failed' };
  return { success: true, documents, hasMore: rows.length > ATTACHABLE_DOCUMENT_PAGE_SIZE };
}

export async function getJobDocuments(rawJobId: string): Promise<DocumentListResult> {
  const jobId = parseActionInput(uuidSchema, rawJobId);
  if (!jobId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const access = await ensureJobAccess(auth.context, jobId);
  if (!access.success) return access;

  return readLinkedDocuments(auth.context, 'job_id', jobId);
}

// Attachments of one request (Anfrage); manager-only like the request surface.
export async function getRequestDocuments(rawRequestId: string): Promise<DocumentListResult> {
  const requestId = parseActionInput(uuidSchema, rawRequestId);
  if (!requestId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const access = await ensureRequestManagerAccess(auth.context, requestId);
  if (!access.success) return access;

  return readLinkedDocuments(auth.context, 'request_id', requestId);
}

// An assigned employee reads the project's own documents; each job group below keeps its own job check.
async function getProjectDocuments(projectId: string): Promise<DocumentListResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const access = await ensureProjectWorkAccess(auth.context, projectId);
  if (!access.success) return access;

  return readLinkedDocuments(auth.context, 'project_id', projectId);
}

const JOB_DOCUMENT_READ_CONCURRENCY = 8;

export async function getProjectDocumentsOverview(
  rawProjectId: string,
  rawJobs: Array<Pick<Job, 'id' | 'jobNumber' | 'title'>>,
): Promise<ProjectDocumentsOverviewResult> {
  const projectId = parseActionInput(uuidSchema, rawProjectId);
  if (!projectId) return INVALID_INPUT;
  const jobs = parseActionInput(projectOverviewJobsSchema, rawJobs);
  if (!jobs) return INVALID_INPUT;
  const projectResult = await getProjectDocuments(projectId);
  if (!projectResult.success) return projectResult;

  // Bounded fan-out: each job read checks its own access and runs several queries.
  const jobDocumentResults: DocumentListResult[] = [];
  for (let start = 0; start < jobs.length; start += JOB_DOCUMENT_READ_CONCURRENCY) {
    const chunk = jobs.slice(start, start + JOB_DOCUMENT_READ_CONCURRENCY);
    jobDocumentResults.push(...(await Promise.all(chunk.map((job) => getJobDocuments(job.id)))));
  }

  const jobDocumentGroups = jobs
    .map((job, index) => {
      const jobResult = jobDocumentResults[index];
      return {
        jobId: job.id,
        jobNumber: job.jobNumber,
        jobTitle: job.title,
        documents: jobResult?.success ? jobResult.documents : [],
      };
    })
    .filter((group) => group.documents.length > 0);

  return {
    success: true,
    projectDocuments: projectResult.documents,
    jobDocumentGroups,
  };
}

/** The staff choices of the link dialog. Its other choices are searched in bounded pages. */
export async function getDocumentLinkEmployees(): Promise<ActionResult<{ employees: DocumentEmployee[] }>> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const membersRead = await getOrgMembersForUser(auth.context.orgId, auth.context.userId);
  if (!membersRead.success) return membersRead;
  return {
    success: true,
    employees: membersRead.members.map((member) => ({
      userId: member.user_id,
      name: [member.first_name, member.last_name].filter(Boolean).join(' '),
      email: member.email,
    })),
  };
}

export async function getClientDocuments(rawClientId: string): Promise<DocumentListResult> {
  const clientId = parseActionInput(uuidSchema, rawClientId);
  if (!clientId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const access = await ensureClientManagerAccess(auth.context, clientId);
  if (!access.success) return access;

  return readLinkedDocuments(auth.context, 'client_id', clientId);
}

export async function getEquipmentDocuments(rawEquipmentId: string): Promise<DocumentListResult> {
  const equipmentId = parseActionInput(uuidSchema, rawEquipmentId);
  if (!equipmentId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const access = await ensureEquipmentManagerAccess(auth.context, equipmentId);
  if (!access.success) return access;

  return readLinkedDocuments(auth.context, 'equipment_id', equipmentId);
}

export async function getServiceCaseDocuments(rawServiceCaseId: string): Promise<DocumentListResult> {
  const serviceCaseId = parseActionInput(uuidSchema, rawServiceCaseId);
  if (!serviceCaseId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;
  const access = await ensureServiceCaseManagerAccess(auth.context, serviceCaseId);
  if (!access.success) return access;

  return readLinkedDocuments(auth.context, 'service_case_id', serviceCaseId);
}

export async function getMaintenanceCoverageDocuments(
  rawMaintenanceCoverageId: string,
): Promise<DocumentListResult> {
  const maintenanceCoverageId = parseActionInput(uuidSchema, rawMaintenanceCoverageId);
  if (!maintenanceCoverageId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;
  const access = await ensureMaintenanceCoverageManagerAccess(auth.context, maintenanceCoverageId);
  if (!access.success) return access;

  return readLinkedDocuments(auth.context, 'maintenance_coverage_id', maintenanceCoverageId);
}

export async function getEmployeeDocuments(rawEmployeeId: string): Promise<DocumentListResult> {
  const employeeId = parseActionInput(uuidSchema, rawEmployeeId);
  if (!employeeId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const access = await ensureEmployeeManagerAccess(auth.context, employeeId);
  if (!access.success) return access;

  return readLinkedDocuments(auth.context, 'employee_id', employeeId);
}

export async function createDocumentFolder(rawInput: CreateFolderInput): Promise<FolderResult> {
  const input = parseActionInput(createFolderInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const name = input.name.trim();
  if (!name) {
    return { success: false, error: 'name_required' };
  }

  const folderCheck = await ensureFolder(auth.context.admin, auth.context.orgId, input.parentFolderId);
  if (!folderCheck.success) return folderCheck;

  const { data, error } = await auth.context.admin
    .from('document_folders')
    .insert({
      organization_id: auth.context.orgId,
      parent_folder_id: input.parentFolderId || null,
      name,
      created_by: auth.context.userId,
    })
    .select('*')
    .single();

  if (error || !data) {
    logError('Failed to create document folder', error);
    return { success: false, error: 'create_failed' };
  }

  revalidateDocuments();
  return { success: true, folder: toDocumentFolder(data as DocumentFolderRow) };
}

export async function renameDocumentFolder(rawInput: RenameFolderInput): Promise<FolderResult> {
  const input = parseActionInput(renameFolderInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const name = input.name.trim();
  if (!name) {
    return { success: false, error: 'name_required' };
  }

  const { data, error } = await auth.context.admin
    .from('document_folders')
    .update({ name })
    .eq('id', input.folderId)
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null)
    .select('*')
    .single();

  if (error || !data) {
    logError('Failed to rename document folder', error);
    return { success: false, error: 'update_failed' };
  }

  revalidateDocuments();
  return { success: true, folder: toDocumentFolder(data as DocumentFolderRow) };
}

export async function moveDocumentFolder(rawInput: MoveFolderInput): Promise<FolderResult> {
  const input = parseActionInput(moveFolderInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  if (input.parentFolderId === input.folderId) {
    return { success: false, error: 'invalid_target' };
  }

  const folder = await getFolderById(auth.context.admin, auth.context.orgId, input.folderId);
  if (!folder) return { success: false, error: 'folder_not_found' };

  if ((folder.parent_folder_id ?? null) === (input.parentFolderId ?? null)) {
    return { success: false, error: 'invalid_target' };
  }

  const targetCheck = await ensureFolder(auth.context.admin, auth.context.orgId, input.parentFolderId);
  if (!targetCheck.success) return targetCheck;

  const { data: allFolders, error: allFoldersError } = await readCompleteRows(
    (from, to) =>
      auth.context.admin
        .from('document_folders')
        .select('id, parent_folder_id')
        .eq('organization_id', auth.context.orgId)
        .is('deleted_at', null)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (allFoldersError) {
    logError('Failed to load the folder tree', allFoldersError);
    return { success: false, error: 'update_failed' };
  }

  const descendantIds = getDescendantFolderIds(
    (allFolders ?? []).map((row) => ({ id: row.id, parentFolderId: row.parent_folder_id })),
    new Set([input.folderId]),
  );

  if (input.parentFolderId && descendantIds.has(input.parentFolderId)) {
    return { success: false, error: 'invalid_target' };
  }

  const { data, error } = await auth.context.admin
    .from('document_folders')
    .update({ parent_folder_id: input.parentFolderId || null })
    .eq('id', input.folderId)
    .eq('organization_id', auth.context.orgId)
    .select('*')
    .single();

  if (error || !data) {
    logError('Failed to move document folder', error);
    return { success: false, error: 'update_failed' };
  }

  revalidateDocuments();
  return { success: true, folder: toDocumentFolder(data as DocumentFolderRow) };
}

export async function copyDocumentFolder(rawInput: CopyFolderInput): Promise<FolderResult> {
  const input = parseActionInput(copyFolderInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const sourceFolder = await getFolderById(auth.context.admin, auth.context.orgId, input.folderId);
  if (!sourceFolder) return { success: false, error: 'folder_not_found' };

  const targetCheck = await ensureFolder(auth.context.admin, auth.context.orgId, input.targetParentFolderId);
  if (!targetCheck.success) return targetCheck;

  const { data: allFolders, error: allFoldersError } = await readCompleteRows(
    (from, to) =>
      auth.context.admin
        .from('document_folders')
        .select('*')
        .eq('organization_id', auth.context.orgId)
        .is('deleted_at', null)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (allFoldersError) {
    logError('Failed to load the folder tree', allFoldersError);
    return { success: false, error: 'copy_failed' };
  }

  const { sourceFolderIds, orderedSourceFolders } = orderCopiedFolderTree(
    (allFolders ?? []) as DocumentFolderRow[],
    input.folderId,
  );

  if (input.targetParentFolderId && sourceFolderIds.has(input.targetParentFolderId)) {
    return { success: false, error: 'invalid_target' };
  }

  const copy = await copyFolderTree({
    context: auth.context,
    sourceFolder,
    targetParentFolderId: input.targetParentFolderId,
    sourceFolderIds,
    orderedSourceFolders,
  });
  if (!copy.success) return copy;

  revalidateDocuments();
  return { success: true, folder: toDocumentFolder(copy.rootFolder) };
}

export async function deleteDocumentFolder(rawFolderId: string): Promise<DocumentMutationResult> {
  const folderId = parseActionInput(uuidSchema, rawFolderId);
  if (!folderId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  // One transaction trashes the folder, its subfolders and their documents with the audit events.
  const { error } = await auth.context.admin.rpc('delete_document_folder', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_folder_id: folderId,
  });
  if (error) {
    return documentWriteFailure(
      'Failed to delete document folder',
      error,
      ['folder_not_found'],
      'delete_failed',
    );
  }

  revalidateDocuments();
  return { success: true };
}

export async function createDocumentUploadTicket(
  rawInput: CreateDocumentUploadTicketInput,
): Promise<DocumentUploadTicketResult> {
  const input = parseActionInput(createDocumentUploadTicketInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  if (input.fileSizeBytes <= 0) {
    return { success: false, error: 'file_empty' };
  }

  if (input.fileSizeBytes > DOCUMENT_MAX_FILE_SIZE_BYTES) {
    return { success: false, error: 'file_too_large' };
  }

  const target = normalizeUploadTarget(input);
  const access = await authorizeDocumentUploadTarget(auth.context, target);
  if (!access.success) return access;

  const originalFileName = input.fileName.trim() || 'Dokument';
  const documentId = randomUUID();
  const storagePath = buildDocumentStoragePath({
    organizationId: auth.context.orgId,
    documentId,
    fileName: originalFileName,
  });

  try {
    const uploadUrl = await createSignedUploadUrl({
      path: storagePath,
      organizationId: auth.context.orgId,
      contentType: input.mimeType || 'application/octet-stream',
    });

    return { success: true, ticket: { documentId, storagePath, uploadUrl } };
  } catch (error) {
    logError('Failed to create document upload ticket', error);
    return { success: false, error: 'ticket_failed' };
  }
}

export async function finalizeDocumentUpload(rawInput: FinalizeDocumentUploadInput): Promise<DocumentResult> {
  const input = parseActionInput(finalizeDocumentUploadInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const originalFileName = input.fileName.trim() || 'Dokument';
  // The storage path is recomputed server-side from the authenticated org and
  // the document id, so a client can never register a foreign object key.
  const storagePath = buildDocumentStoragePath({
    organizationId: auth.context.orgId,
    documentId: input.documentId,
    fileName: originalFileName,
  });

  if (await readDocumentStoragePath(auth.context, input.documentId)) {
    return { success: false, error: 'already_finalized' };
  }

  const target = normalizeUploadTarget(input);
  const access = await authorizeDocumentUploadTarget(auth.context, target);
  if (!access.success) {
    await discardStorageObjects({ organizationId: auth.context.orgId, paths: [storagePath] });
    return access;
  }

  const head = await verifyUploadedObject({
    organizationId: auth.context.orgId,
    storagePath,
    failureLabel: 'Failed to verify uploaded document object',
  });
  if (!head.success) return head;
  const { contentType } = head;
  const category =
    parseDocumentCategory(input.category ?? null) ??
    inferDocumentCategory({
      fileName: originalFileName,
      mimeType: contentType,
    });
  const displayName = await getAvailableDisplayName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    folderId: target.folderId,
    preferredName: originalFileName,
  });

  // One transaction writes the document, its link and their audit events.
  const linkTarget = uploadLinkTarget(target);
  const { data: documentRow, error } = await auth.context.admin.rpc(
    'finalize_document_upload',
    rpcArgs('finalize_document_upload', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_document_id: input.documentId,
      p_folder_id: target.folderId,
      p_storage_path: storagePath,
      p_original_file_name: originalFileName,
      p_display_name: displayName,
      p_category: category,
      p_mime_type: contentType,
      p_size_bytes: head.sizeBytes,
      p_link_kind: linkTarget?.kind ?? null,
      p_link_target_id: linkTarget?.id ?? null,
    }),
  );
  if (error || !documentRow) {
    const failure = documentWriteFailure(
      'Failed to finalize document upload',
      error,
      [
        'already_finalized',
        'link_failed',
        'folder_not_found',
        'invalid_target',
        'not_a_member',
        'not_authorized',
      ],
      'create_failed',
    );
    // A concurrent finalize of the same upload committed first and owns the object.
    if (failure.error !== 'already_finalized') {
      await discardStorageObjects({ organizationId: auth.context.orgId, paths: [storagePath] });
    }
    return failure;
  }

  revalidateDocuments();
  return hydrateWrittenDocument(auth.context.admin, documentRow);
}

export async function renameDocument(rawInput: RenameDocumentInput): Promise<DocumentResult> {
  const input = parseActionInput(renameDocumentInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  const displayName = input.displayName.trim();
  if (!displayName) {
    return { success: false, error: 'name_required' };
  }

  const { data, error } = await auth.context.admin.rpc('rename_document', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_document_id: existing.document.id,
    p_display_name: displayName,
  });
  if (error || !data) {
    return documentWriteFailure('Failed to rename document', error, ['document_not_found'], 'update_failed');
  }

  revalidateDocuments();
  return hydrateWrittenDocument(auth.context.admin, data);
}

export async function updateDocumentCategory(rawInput: UpdateDocumentCategoryInput): Promise<DocumentResult> {
  const input = parseActionInput(updateDocumentCategoryInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  const { data, error } = await auth.context.admin.rpc('update_document_category', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_document_id: existing.document.id,
    p_category: input.category,
  });
  if (error || !data) {
    return documentWriteFailure(
      'Failed to update document category',
      error,
      ['document_not_found'],
      'update_failed',
    );
  }

  revalidateDocuments();
  return hydrateWrittenDocument(auth.context.admin, data);
}

export async function moveDocument(rawInput: MoveDocumentInput): Promise<DocumentResult> {
  const input = parseActionInput(moveDocumentInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  const displayName = await getAvailableDisplayName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    folderId: input.folderId,
    preferredName: existing.document.display_name,
  });

  // The function refuses a protected personnel document, the same folder and a missing target folder.
  const { data, error } = await auth.context.admin.rpc(
    'move_document',
    rpcArgs('move_document', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_document_id: existing.document.id,
      p_folder_id: input.folderId || null,
      p_display_name: displayName,
    }),
  );
  if (error || !data) {
    return documentWriteFailure(
      'Failed to move document',
      error,
      ['document_not_found', 'protected_document_boundary', 'invalid_target', 'folder_not_found'],
      'update_failed',
    );
  }

  revalidateDocuments();
  return hydrateWrittenDocument(auth.context.admin, data);
}

export async function copyDocument(rawInput: CopyDocumentInput): Promise<DocumentResult> {
  const input = parseActionInput(copyDocumentInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  const { data: protectedDocument } = await loggedRead(
    'copyDocument: personnel_documents read failed',
    auth.context.admin
      .from('personnel_documents')
      .select('id')
      .eq('organization_id', auth.context.orgId)
      .eq('document_id', existing.document.id)
      .maybeSingle(),
  );
  if (protectedDocument) {
    return { success: false, error: 'protected_document_boundary' };
  }

  const folderCheck = await ensureFolder(auth.context.admin, auth.context.orgId, input.targetFolderId);
  if (!folderCheck.success) return folderCheck;

  const documentId = randomUUID();
  const displayName = await getAvailableDisplayName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    folderId: input.targetFolderId,
    preferredName: getCopyDisplayName(existing.document.display_name),
  });
  const storagePath = buildDocumentStoragePath({
    organizationId: auth.context.orgId,
    documentId,
    fileName: existing.document.original_file_name,
  });

  try {
    await copyStorageObject({
      organizationId: auth.context.orgId,
      sourcePath: existing.document.storage_path,
      targetPath: storagePath,
      contentType: existing.document.mime_type,
    });
  } catch (storageCopyError) {
    logError('Failed to copy document storage object', storageCopyError);
    return { success: false, error: 'copy_failed' };
  }

  // The object exists first; a refused registration discards it.
  const { data, error } = await auth.context.admin.rpc(
    'copy_document',
    rpcArgs('copy_document', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_source_document_id: existing.document.id,
      p_document_id: documentId,
      p_folder_id: input.targetFolderId || null,
      p_storage_path: storagePath,
      p_display_name: displayName,
    }),
  );
  if (error || !data) {
    await discardStorageObjects({ organizationId: auth.context.orgId, paths: [storagePath] });
    return documentWriteFailure(
      'Failed to create copied document metadata',
      error,
      ['document_not_found', 'protected_document_boundary', 'folder_not_found'],
      'copy_failed',
    );
  }

  revalidateDocuments();
  return hydrateWrittenDocument(auth.context.admin, data);
}

export async function deleteDocument(rawDocumentId: string): Promise<DocumentMutationResult> {
  const documentId = parseActionInput(uuidSchema, rawDocumentId);
  if (!documentId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, documentId);
  if (!existing.success) return existing;

  const { error } = await auth.context.admin.rpc('trash_document', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_document_id: existing.document.id,
  });
  if (error) {
    return documentWriteFailure(
      'Failed to delete document metadata',
      error,
      ['document_not_found'],
      'delete_failed',
    );
  }

  revalidateDocuments();
  return { success: true };
}

export async function unlinkDocument(rawInput: UnlinkDocumentInput): Promise<DocumentMutationResult> {
  const input = parseActionInput(unlinkDocumentInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const { data: link, error: linkLoadError } = await auth.context.admin
    .from('document_links')
    .select('*')
    .eq('id', input.linkId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();

  if (linkLoadError || !link) {
    logError('Failed to load document link for unlink', linkLoadError);
    return { success: false, error: 'link_not_found' };
  }

  const result = await writeDocumentLinks(auth.context, (link as DocumentLinkRow).document_id, {
    removeLinkIds: [input.linkId],
    additions: [],
    fallback: 'unlink_failed',
  });
  return result.success ? { success: true } : result;
}

export async function updateDocumentLinks(
  rawInput: UpdateDocumentLinksInput,
): Promise<UpdateDocumentLinksResult> {
  const input = parseActionInput(updateDocumentLinksInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const document = await getAuthorizedDocument(auth.context, input.documentId);
  if (!document.success) return document;

  const additions: DocumentLinkTarget[] = [
    ...(input.addJobIds ?? []).map((jobId) => ({ kind: 'job' as const, jobId })),
    ...(input.addProjectIds ?? []).map((projectId) => ({ kind: 'project' as const, projectId })),
    ...(input.addClientIds ?? []).map((clientId) => ({ kind: 'client' as const, clientId })),
    ...(input.addEmployeeIds ?? []).map((employeeId) => ({ kind: 'employee' as const, employeeId })),
    ...(input.addServiceCaseIds ?? []).map((serviceCaseId) => ({
      kind: 'service_case' as const,
      serviceCaseId,
    })),
    ...(input.addMaintenanceCoverageIds ?? []).map((maintenanceCoverageId) => ({
      kind: 'maintenance_coverage' as const,
      maintenanceCoverageId,
    })),
    ...(input.addEquipmentIds ?? []).map((equipmentId) => ({ kind: 'equipment' as const, equipmentId })),
  ];
  // All or nothing: one refused target or link leaves every link as it was.
  return writeDocumentLinks(auth.context, input.documentId, {
    removeLinkIds: input.removeLinkIds ?? [],
    additions,
    fallback: 'update_failed',
  });
}

export async function linkDocumentsToTarget(
  rawInput: LinkDocumentsToTargetInput,
): Promise<LinkDocumentsToTargetResult> {
  const input = parseActionInput(linkDocumentsToTargetInputSchema, rawInput);
  if (!input) return { ...INVALID_INPUT, linkedCount: 0, failedCount: 0 };
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) {
    return {
      success: false,
      error: auth.error,
      linkedCount: 0,
      failedCount: 0,
    };
  }

  const target = singleLinkTarget(input);
  if (!target) {
    return {
      success: false,
      error: 'invalid_target',
      linkedCount: 0,
      failedCount: input.documentIds.length,
    };
  }

  let linkedCount = 0;
  let failedCount = 0;

  for (const documentId of input.documentIds) {
    const result = await linkDocumentToTarget(auth.context, documentId, target);
    if (result.success) linkedCount++;
    else failedCount++;
  }

  if (failedCount > 0) {
    return {
      success: false,
      error: linkedCount > 0 ? 'partial_update' : 'link_failed',
      linkedCount,
      failedCount,
    };
  }

  return { success: true, linkedCount };
}

export async function getDocumentSignedUrl(rawDocumentId: string): Promise<SignedDocumentUrlResult> {
  const documentId = parseActionInput(uuidSchema, rawDocumentId);
  if (!documentId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getAuthorizedDocument(auth.context, documentId);
  if (!existing.success) return existing;

  try {
    const signedUrl = await createSignedDownloadUrl({
      path: existing.document.storage_path,
      organizationId: auth.context.orgId,
      disposition: 'attachment',
      downloadFileName: existing.document.display_name,
    });
    return { success: true, signedUrl };
  } catch (error) {
    logError('Failed to create document signed URL', error);
    return { success: false, error: 'signed_url_failed' };
  }
}

export async function getDocumentViewSignedUrl(rawDocumentId: string): Promise<SignedDocumentUrlResult> {
  const documentId = parseActionInput(uuidSchema, rawDocumentId);
  if (!documentId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getAuthorizedDocument(auth.context, documentId);
  if (!existing.success) return existing;

  try {
    const signedUrl = await createSignedDownloadUrl({
      path: existing.document.storage_path,
      organizationId: auth.context.orgId,
      disposition: inlineSafeDisposition(existing.document.mime_type),
      downloadFileName:
        inlineSafeDisposition(existing.document.mime_type) === 'attachment'
          ? existing.document.display_name
          : undefined,
    });
    return { success: true, signedUrl };
  } catch (error) {
    logError('Failed to create document view signed URL', error);
    return { success: false, error: 'signed_url_failed' };
  }
}

export async function getDocumentVersionSignedUrl(
  rawVersionId: string,
  rawOptions: { download?: boolean } = {},
): Promise<SignedDocumentUrlResult> {
  const versionId = parseActionInput(uuidSchema, rawVersionId);
  if (!versionId) return INVALID_INPUT;
  const options = parseActionInput(signedUrlOptionsSchema, rawOptions);
  if (!options) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const { data: version, error } = await auth.context.admin
    .from('document_versions')
    .select('*')
    .eq('id', versionId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();

  if (error || !version) {
    logError('Failed to load document version', error);
    return { success: false, error: 'version_not_found' };
  }

  const versionRow = version as DocumentVersionRow;
  const existing = await getAuthorizedDocument(auth.context, versionRow.document_id, {
    protectedVersionNumber: versionRow.version_number,
  });
  if (!existing.success) return existing;
  if (
    existing.protectedAccess?.releasedVersionNumbers &&
    !existing.protectedAccess.releasedVersionNumbers.includes(versionRow.version_number)
  ) {
    return { success: false, error: 'not_authorized' };
  }

  try {
    const disposition = options.download ? 'attachment' : inlineSafeDisposition(versionRow.mime_type);
    const signedUrl = await createSignedDownloadUrl({
      path: versionRow.storage_path,
      organizationId: auth.context.orgId,
      disposition,
      downloadFileName: disposition === 'attachment' ? versionRow.original_file_name : undefined,
    });
    return { success: true, signedUrl };
  } catch (signedUrlError) {
    logError('Failed to create version signed URL', signedUrlError);
    return { success: false, error: 'signed_url_failed' };
  }
}

export async function getDocumentDetails(rawDocumentId: string): Promise<DocumentDetailsResult> {
  const documentId = parseActionInput(uuidSchema, rawDocumentId);
  if (!documentId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getAuthorizedDocument(auth.context, documentId);
  if (!existing.success) return existing;

  const releasedVersionNumbers = existing.protectedAccess?.releasedVersionNumbers ?? null;

  const baseVersionsQuery = auth.context.admin
    .from('document_versions')
    .select('*')
    .eq('document_id', existing.document.id)
    .eq('organization_id', auth.context.orgId);
  const scopedVersionsQuery = releasedVersionNumbers
    ? baseVersionsQuery.in('version_number', releasedVersionNumbers)
    : baseVersionsQuery;
  const versionsPromise =
    releasedVersionNumbers?.length === 0
      ? Promise.resolve({ data: [], error: null })
      : scopedVersionsQuery.order('version_number', { ascending: false });
  const [versionsResult, auditResult] = await Promise.all([
    versionsPromise,
    existing.protectedAccess && !existing.protectedAccess.canInspectHistory
      ? Promise.resolve({ data: [], error: null })
      : auth.context.admin
          .from('document_audit_events')
          .select('*')
          .eq('document_id', existing.document.id)
          .eq('organization_id', auth.context.orgId)
          .order('created_at', { ascending: false })
          .limit(50),
  ]);

  const [document] = await hydrateDocuments(auth.context.admin, [existing.document]);
  if (!document) {
    return { success: false, error: 'document_not_found' };
  }

  if (versionsResult.error) {
    logError('Failed to load document versions', versionsResult.error);
    return { success: false, error: 'versions_failed', document };
  }

  if (auditResult.error) {
    logError('Failed to load document audit events', auditResult.error);
    return { success: false, error: 'audit_failed', document };
  }

  const [versions, auditEvents] = await Promise.all([
    hydrateDocumentVersions(auth.context.admin, versionsResult.data as DocumentVersionRow[]),
    hydrateDocumentAuditEvents(auth.context.admin, auditResult.data as DocumentAuditEventRow[]),
  ]);
  if (!versions) return { success: false, error: 'versions_failed', document };
  if (!auditEvents) return { success: false, error: 'audit_failed', document };
  return { success: true, document, versions, auditEvents };
}

export async function restoreDocument(rawDocumentId: string): Promise<DocumentMutationResult> {
  const documentId = parseActionInput(uuidSchema, rawDocumentId);
  if (!documentId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getDeletedDocumentForManager(auth.context, documentId);
  if (!existing.success) return existing;

  let restoreFolderId = existing.document.folder_id;
  if (restoreFolderId) {
    const folder = await getFolderById(auth.context.admin, auth.context.orgId, restoreFolderId);
    restoreFolderId = folder ? restoreFolderId : null;
  }

  const displayName = await getAvailableDisplayName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    folderId: restoreFolderId,
    preferredName: existing.document.display_name,
  });

  const { error } = await auth.context.admin.rpc('restore_document', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_document_id: existing.document.id,
    p_display_name: displayName,
  });
  if (error) {
    return documentWriteFailure(
      'Failed to restore document',
      error,
      ['document_not_found'],
      'restore_failed',
    );
  }

  revalidateDocuments();
  return { success: true };
}

export async function permanentlyDeleteDocument(rawDocumentId: string): Promise<DocumentMutationResult> {
  const documentId = parseActionInput(uuidSchema, rawDocumentId);
  if (!documentId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getDeletedDocumentForManager(auth.context, documentId);
  if (!existing.success) return existing;

  // The row goes first, in one transaction with its version rows, links and
  // audit event: a refused delete (a protected personnel document, a released
  // handover or another `on delete restrict` reference) leaves the files in
  // place, while storage that fails after the row is gone only leaves an
  // orphaned object.
  const { data: storagePaths, error } = await auth.context.admin.rpc('permanently_delete_document', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_document_id: existing.document.id,
  });
  if (error || !storagePaths) {
    return documentWriteFailure(
      'Failed to permanently delete document metadata',
      error,
      ['document_not_found', 'document_has_equipment_history'],
      'delete_failed',
    );
  }

  try {
    await deleteStorageObjects({ organizationId: auth.context.orgId, paths: storagePaths });
  } catch (storageError) {
    logError('Failed to remove the storage of a permanently deleted document', storageError);
  }

  revalidateDocuments();
  return { success: true };
}

export async function createDocumentVersionUploadTicket(
  rawInput: CreateDocumentVersionUploadTicketInput,
): Promise<DocumentVersionUploadTicketResult> {
  const input = parseActionInput(createDocumentVersionUploadTicketInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getVersionableDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  if (input.fileSizeBytes <= 0) {
    return { success: false, error: 'file_empty' };
  }

  if (input.fileSizeBytes > DOCUMENT_MAX_FILE_SIZE_BYTES) {
    return { success: false, error: 'file_too_large' };
  }

  const nextVersionNumber = existing.document.current_version_number + 1;
  const storagePath = buildDocumentVersionStoragePath({
    organizationId: auth.context.orgId,
    documentId: existing.document.id,
    versionNumber: nextVersionNumber,
    fileName: input.fileName.trim() || 'Dokument',
  });

  try {
    const uploadUrl = await createSignedUploadUrl({
      path: storagePath,
      organizationId: auth.context.orgId,
      contentType: input.mimeType || 'application/octet-stream',
    });

    return {
      success: true,
      ticket: {
        documentId: existing.document.id,
        versionNumber: nextVersionNumber,
        storagePath,
        uploadUrl,
      },
    };
  } catch (error) {
    logError('Failed to create version upload ticket', error);
    return { success: false, error: 'ticket_failed' };
  }
}

export async function finalizeDocumentVersionUpload(
  rawInput: FinalizeDocumentVersionUploadInput,
): Promise<VersionResult> {
  const input = parseActionInput(finalizeDocumentVersionUploadInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getVersionableDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  const nextVersionNumber = existing.document.current_version_number + 1;
  if (input.versionNumber !== nextVersionNumber) {
    // Another version landed between ticket and finalize; the uploaded object
    // sits at a now-stale version path and must not become the current file.
    // Only clean up paths above the current version number — lower numbers
    // could collide with legitimately archived version objects.
    if (input.versionNumber > existing.document.current_version_number) {
      const staleStoragePath = buildDocumentVersionStoragePath({
        organizationId: auth.context.orgId,
        documentId: existing.document.id,
        versionNumber: input.versionNumber,
        fileName: input.fileName.trim() || 'Dokument',
      });
      await discardStorageObjects({ organizationId: auth.context.orgId, paths: [staleStoragePath] });
    }
    return { success: false, error: 'version_conflict' };
  }

  const originalFileName = input.fileName.trim() || 'Dokument';
  const storagePath = buildDocumentVersionStoragePath({
    organizationId: auth.context.orgId,
    documentId: existing.document.id,
    versionNumber: nextVersionNumber,
    fileName: originalFileName,
  });

  const head = await verifyUploadedObject({
    organizationId: auth.context.orgId,
    storagePath,
    failureLabel: 'Failed to verify uploaded version object',
  });
  if (!head.success) return head;
  const { contentType } = head;

  // One transaction archives the current file, makes the upload current and records it.
  const { data: updatedDocument, error } = await auth.context.admin.rpc('finalize_document_version_upload', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_document_id: existing.document.id,
    p_expected_version_number: existing.document.current_version_number,
    p_storage_path: storagePath,
    p_original_file_name: originalFileName,
    p_mime_type: contentType,
    p_size_bytes: head.sizeBytes,
  });
  if (error || !updatedDocument) {
    const failure = documentWriteFailure(
      'Failed to store the new document version',
      error,
      ['version_conflict', 'document_not_found', 'versioning_not_supported'],
      'version_failed',
    );
    // A concurrent finalize may have made an object of this same path current:
    // on a conflict the object is kept, as an orphan is safer than a lost file.
    if (failure.error !== 'version_conflict') {
      await discardStorageObjects({ organizationId: auth.context.orgId, paths: [storagePath] });
    }
    return failure;
  }

  const version: DocumentVersion = {
    id: 'latest',
    organizationId: auth.context.orgId,
    documentId: existing.document.id,
    versionNumber: nextVersionNumber,
    storageBucket: DOCUMENT_STORAGE_BUCKET,
    storagePath,
    originalFileName,
    mimeType: contentType,
    sizeBytes: head.sizeBytes,
    uploadedBy: auth.context.userId,
    createdAt: updatedDocument.updated_at,
    uploader: null,
  };

  revalidateDocuments();
  return { success: true, version };
}

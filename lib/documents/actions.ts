'use server';

import { randomUUID } from 'crypto';
import { revalidatePath, updateTag } from 'next/cache';

import { CACHE_TAGS } from '@/lib/data/cached';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_MAX_FILE_SIZE_BYTES,
  DOCUMENT_STORAGE_BUCKET,
  toDocumentFolder,
  toDocumentLink,
  toDocumentAuditEvent,
  toDocumentVersion,
  toOrganizationDocument,
  toDocumentCategory,
  type DocumentCategory,
  type DocumentAuditEvent,
  type DocumentAuditEventRow,
  type DocumentEmployee,
  type DocumentLibraryCategoryFilter,
  type DocumentLibraryLinkFilter,
  type DocumentDetailsResult,
  type DocumentFolder,
  type DocumentFolderRow,
  type DocumentLibrarySort,
  type DocumentLibraryResult,
  type DocumentLibraryView,
  type DocumentLink,
  type DocumentLinkRow,
  type DocumentListResult,
  type DocumentMutationResult,
  type DocumentResult,
  type DocumentRow,
  type DocumentUploader,
  type DocumentVersion,
  type DocumentVersionRow,
  type FolderResult,
  type LinkDocumentsToTargetInput,
  type LinkDocumentsToTargetResult,
  type OrganizationDocument,
  type ProjectDocumentsOverviewResult,
  type SignedDocumentUrlResult,
  type StorageCleanupReportResult,
  type UpdateDocumentLinksInput,
  type UpdateDocumentLinksResult,
  type VersionResult,
} from './types';
import { getOrgClients } from '@/lib/clients/actions';
import { getOrgJobs } from '@/lib/jobs/actions';
import { getOrgProjects } from '@/lib/projects/actions';
import { getOrgMembersForUser } from '@/lib/members/actions';
import type { Client, Job, ProjectWithDetails } from '@/lib/jobs/types';

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

type AuthorizedDocumentContext = {
  admin: SupabaseAdmin;
  orgId: string;
  userId: string;
  isManagerOrAbove: boolean;
};

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_path: string | null;
};

type CreateFolderInput = {
  name: string;
  parentFolderId?: string | null;
};

type RenameFolderInput = {
  folderId: string;
  name: string;
};

type MoveFolderInput = {
  folderId: string;
  parentFolderId?: string | null;
};

type CopyFolderInput = {
  folderId: string;
  targetParentFolderId?: string | null;
};

type RenameDocumentInput = {
  documentId: string;
  displayName: string;
};

type UpdateDocumentCategoryInput = {
  documentId: string;
  category: DocumentCategory;
};

type MoveDocumentInput = {
  documentId: string;
  folderId?: string | null;
};

type CopyDocumentInput = {
  documentId: string;
  targetFolderId?: string | null;
};

type LinkDocumentToJobInput = {
  documentId: string;
  jobId: string;
};

type LinkDocumentToProjectInput = {
  documentId: string;
  projectId: string;
};

type LinkDocumentToClientInput = {
  documentId: string;
  clientId: string;
};

type LinkDocumentToEmployeeInput = {
  documentId: string;
  employeeId: string;
};

type UnlinkDocumentInput = {
  linkId: string;
};

type UploadDocumentVersionInput = {
  documentId: string;
  formData: FormData;
};

type RecordDocumentAuditEventInput = {
  documentId?: string | null;
  folderId?: string | null;
  eventType:
    | 'uploaded'
    | 'renamed'
    | 'moved'
    | 'copied'
    | 'category_changed'
    | 'linked'
    | 'unlinked'
    | 'deleted'
    | 'restored'
    | 'version_uploaded'
    | 'permanently_deleted'
    | 'storage_cleanup';
  eventPayload?: Record<string, unknown>;
};

type DocumentLibraryInput = {
  folderId?: string | null;
  view?: DocumentLibraryView;
  searchQuery?: string | null;
  sort?: DocumentLibrarySort;
  category?: DocumentLibraryCategoryFilter | null;
  linkFilter?: DocumentLibraryLinkFilter | null;
};

type AttachableDocumentsInput =
  | {
      targetType: 'job';
      targetId: string;
      searchQuery?: string | null;
      category?: DocumentCategory | 'all' | null;
    }
  | {
      targetType: 'project';
      targetId: string;
      searchQuery?: string | null;
      category?: DocumentCategory | 'all' | null;
    }
  | {
      targetType: 'client';
      targetId: string;
      searchQuery?: string | null;
      category?: DocumentCategory | 'all' | null;
    }
  | {
      targetType: 'employee';
      targetId: string;
      searchQuery?: string | null;
      category?: DocumentCategory | 'all' | null;
    };

function mapProfileToUploader(profile?: ProfileRow | null): DocumentUploader | null {
  if (!profile) return null;

  return {
    userId: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    email: profile.email,
    avatarPath: profile.avatar_path,
  };
}

function trimName(name: string): string {
  return name.trim();
}

function splitFileName(fileName: string): { baseName: string; extension: string } {
  const trimmed = trimName(fileName);
  const lastDotIndex = trimmed.lastIndexOf('.');

  if (lastDotIndex <= 0 || lastDotIndex === trimmed.length - 1) {
    return { baseName: trimmed || 'Dokument', extension: '' };
  }

  return {
    baseName: trimmed.slice(0, lastDotIndex),
    extension: trimmed.slice(lastDotIndex),
  };
}

function getCopyDisplayName(fileName: string): string {
  return `Kopie von ${trimName(fileName) || 'Dokument'}`;
}

function inferDocumentCategory({
  fileName,
  mimeType,
}: {
  fileName: string;
  mimeType: string;
}): DocumentCategory {
  const lowerName = fileName.toLowerCase();
  const lowerMimeType = mimeType.toLowerCase();

  if (lowerMimeType.startsWith('image/')) return 'photo';
  if (
    lowerName.includes('rechnung') ||
    lowerName.includes('invoice') ||
    lowerName.includes('quittung')
  ) {
    return 'invoice';
  }
  if (
    lowerName.includes('vertrag') ||
    lowerName.includes('contract') ||
    lowerName.includes('vereinbarung')
  ) {
    return 'contract';
  }
  if (
    lowerName.includes('angebot') ||
    lowerName.includes('offer') ||
    lowerName.includes('kostenvoranschlag')
  ) {
    return 'offer';
  }
  if (
    lowerName.includes('bericht') ||
    lowerName.includes('protokoll') ||
    lowerName.includes('report')
  ) {
    return 'report';
  }

  return 'other';
}

function parseDocumentCategory(value: FormDataEntryValue | null): DocumentCategory | null {
  if (typeof value !== 'string') return null;
  const category = toDocumentCategory(value);
  return DOCUMENT_CATEGORIES.includes(category) ? category : null;
}

function sanitizeStorageFileName(fileName: string): string {
  const trimmed = trimName(fileName) || 'document';
  return trimmed
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140) || 'document';
}

function buildStoragePath({
  orgId,
  documentId,
  fileName,
}: {
  orgId: string;
  documentId: string;
  fileName: string;
}): string {
  return `${orgId}/${documentId}/${sanitizeStorageFileName(fileName)}`;
}

async function copyStorageObject({
  admin,
  sourcePath,
  targetPath,
  contentType,
}: {
  admin: SupabaseAdmin;
  sourcePath: string;
  targetPath: string;
  contentType: string | null;
}): Promise<{ success: true } | { success: false; error: unknown }> {
  const { error: copyError } = await admin.storage
    .from(DOCUMENT_STORAGE_BUCKET)
    .copy(sourcePath, targetPath);

  if (!copyError) return { success: true };

  console.error('Supabase storage copy failed, falling back to download/upload:', copyError);

  const { data: sourceBlob, error: downloadError } = await admin.storage
    .from(DOCUMENT_STORAGE_BUCKET)
    .download(sourcePath);

  if (downloadError || !sourceBlob) {
    return { success: false, error: downloadError ?? 'download_failed' };
  }

  const fileBuffer = Buffer.from(await sourceBlob.arrayBuffer());
  const { error: uploadError } = await admin.storage
    .from(DOCUMENT_STORAGE_BUCKET)
    .upload(targetPath, fileBuffer, {
      cacheControl: '3600',
      contentType: contentType || 'application/octet-stream',
      upsert: false,
    });

  if (uploadError) {
    return { success: false, error: uploadError };
  }

  return { success: true };
}

function revalidateDocuments(orgId: string): void {
  updateTag(CACHE_TAGS.documents(orgId));
  revalidatePath('/dokumente');
  revalidatePath('/auftraege', 'layout');
  revalidatePath('/mitarbeiter', 'layout');
  revalidatePath('/kunden', 'layout');
}

async function getAuthorizedDocumentContext(): Promise<
  | { success: true; context: AuthorizedDocumentContext }
  | { success: false; error: string }
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;

  return {
    success: true,
    context: {
      admin: createSupabaseAdminClient(),
      orgId: auth.context.orgId,
      userId: auth.context.userId,
      isManagerOrAbove: auth.context.isManagerOrAbove,
    },
  };
}

function requireManager(context: AuthorizedDocumentContext): DocumentMutationResult {
  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  return { success: true };
}

async function getFolderById(
  admin: SupabaseAdmin,
  orgId: string,
  folderId: string
): Promise<DocumentFolderRow | null> {
  const { data } = await admin
    .from('document_folders')
    .select('*')
    .eq('id', folderId)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .maybeSingle();

  return (data as DocumentFolderRow | null) ?? null;
}

async function ensureFolder(
  admin: SupabaseAdmin,
  orgId: string,
  folderId: string | null | undefined
): Promise<{ success: true } | { success: false; error: string }> {
  if (!folderId) return { success: true };

  const folder = await getFolderById(admin, orgId, folderId);
  if (!folder) {
    return { success: false, error: 'folder_not_found' };
  }

  return { success: true };
}

async function ensureJobAccess(
  context: AuthorizedDocumentContext,
  jobId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const { data: job } = await context.admin
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('organization_id', context.orgId)
    .maybeSingle();

  if (!job) {
    return { success: false, error: 'job_not_found' };
  }

  if (context.isManagerOrAbove) {
    return { success: true };
  }

  const { data: assignment } = await context.admin
    .from('job_assignments')
    .select('id')
    .eq('job_id', jobId)
    .eq('user_id', context.userId)
    .maybeSingle();

  if (!assignment) {
    return { success: false, error: 'not_authorized' };
  }

  return { success: true };
}

async function ensureProjectManagerAccess(
  context: AuthorizedDocumentContext,
  projectId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const { data: project } = await context.admin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('organization_id', context.orgId)
    .maybeSingle();

  if (!project) {
    return { success: false, error: 'project_not_found' };
  }

  return { success: true };
}

async function ensureClientManagerAccess(
  context: AuthorizedDocumentContext,
  clientId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const { data: client } = await context.admin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('organization_id', context.orgId)
    .maybeSingle();

  if (!client) {
    return { success: false, error: 'client_not_found' };
  }

  return { success: true };
}

async function ensureEmployeeManagerAccess(
  context: AuthorizedDocumentContext,
  employeeId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const { data: membership } = await context.admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', context.orgId)
    .eq('user_id', employeeId)
    .maybeSingle();

  if (!membership) {
    return { success: false, error: 'employee_not_found' };
  }

  return { success: true };
}

async function getAvailableDisplayName({
  admin,
  orgId,
  folderId,
  preferredName,
}: {
  admin: SupabaseAdmin;
  orgId: string;
  folderId?: string | null;
  preferredName: string;
}): Promise<string> {
  const trimmed = trimName(preferredName) || 'Dokument';
  let query = admin
    .from('documents')
    .select('display_name')
    .eq('organization_id', orgId)
    .is('deleted_at', null);

  query = folderId ? query.eq('folder_id', folderId) : query.is('folder_id', null);
  const { data } = await query;
  const existingNames = new Set(
    ((data ?? []) as Pick<DocumentRow, 'display_name'>[]).map((row) =>
      row.display_name.toLowerCase()
    )
  );

  if (!existingNames.has(trimmed.toLowerCase())) {
    return trimmed;
  }

  const { baseName, extension } = splitFileName(trimmed);
  let counter = 1;
  let candidate = `${baseName} (${counter})${extension}`;

  while (existingNames.has(candidate.toLowerCase())) {
    counter++;
    candidate = `${baseName} (${counter})${extension}`;
  }

  return candidate;
}

async function getAvailableFolderName({
  admin,
  orgId,
  parentFolderId,
  preferredName,
}: {
  admin: SupabaseAdmin;
  orgId: string;
  parentFolderId?: string | null;
  preferredName: string;
}): Promise<string> {
  const trimmed = trimName(preferredName) || 'Ordner';
  let query = admin
    .from('document_folders')
    .select('name')
    .eq('organization_id', orgId)
    .is('deleted_at', null);

  query = parentFolderId
    ? query.eq('parent_folder_id', parentFolderId)
    : query.is('parent_folder_id', null);

  const { data } = await query;
  const existingNames = new Set(
    ((data ?? []) as Pick<DocumentFolderRow, 'name'>[]).map((row) =>
      row.name.toLowerCase()
    )
  );

  if (!existingNames.has(trimmed.toLowerCase())) {
    return trimmed;
  }

  let counter = 1;
  let candidate = `${trimmed} (${counter})`;

  while (existingNames.has(candidate.toLowerCase())) {
    counter++;
    candidate = `${trimmed} (${counter})`;
  }

  return candidate;
}

async function hydrateDocuments(
  admin: SupabaseAdmin,
  rows: DocumentRow[]
): Promise<OrganizationDocument[]> {
  if (rows.length === 0) return [];

  const documentIds = rows.map((row) => row.id);
  const uploaderIds = Array.from(new Set(rows.map((row) => row.uploaded_by)));

  const [linksResult, profilesResult] = await Promise.all([
    admin
      .from('document_links')
      .select('*')
      .in('document_id', documentIds),
    admin
      .from('profiles')
      .select('id, first_name, last_name, email, avatar_path')
      .in('id', uploaderIds),
  ]);

  const linkRows = (linksResult.data ?? []) as DocumentLinkRow[];
  const jobIds = Array.from(
    new Set(linkRows.map((link) => link.job_id).filter((id): id is string => Boolean(id)))
  );
  const projectIds = Array.from(
    new Set(
      linkRows
        .map((link) => link.project_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const clientIds = Array.from(
    new Set(
      linkRows
        .map((link) => link.client_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const employeeIds = Array.from(
    new Set(
      linkRows
        .map((link) => link.employee_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  const [jobsResult, projectsResult, clientsResult, employeesResult] = await Promise.all([
    jobIds.length > 0
      ? admin
          .from('jobs')
          .select('id, title, job_number')
          .in('id', jobIds)
      : Promise.resolve({ data: [] }),
    projectIds.length > 0
      ? admin
          .from('projects')
          .select('id, name, project_number')
          .in('id', projectIds)
      : Promise.resolve({ data: [] }),
    clientIds.length > 0
      ? admin
          .from('clients')
          .select('id, name')
          .in('id', clientIds)
      : Promise.resolve({ data: [] }),
    employeeIds.length > 0
      ? admin
          .from('profiles')
          .select('id, first_name, last_name, email')
          .in('id', employeeIds)
      : Promise.resolve({ data: [] }),
  ]);

  const jobsById = new Map(
    ((jobsResult.data ?? []) as Array<{
      id: string;
      title: string;
      job_number: string | null;
    }>).map((job) => [job.id, job])
  );
  const projectsById = new Map(
    ((projectsResult.data ?? []) as Array<{
      id: string;
      name: string;
      project_number: string | null;
    }>).map((project) => [project.id, project])
  );
  const clientsById = new Map(
    ((clientsResult.data ?? []) as Array<{
      id: string;
      name: string;
    }>).map((client) => [client.id, client])
  );
  const employeesById = new Map(
    ((employeesResult.data ?? []) as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }>).map((employee) => [employee.id, employee])
  );

  const linksByDocumentId = new Map<string, DocumentLink[]>();
  for (const linkRow of linkRows) {
    const job = linkRow.job_id ? jobsById.get(linkRow.job_id) : null;
    const project = linkRow.project_id ? projectsById.get(linkRow.project_id) : null;
    const client = linkRow.client_id ? clientsById.get(linkRow.client_id) : null;
    const employee = linkRow.employee_id ? employeesById.get(linkRow.employee_id) : null;
    const employeeName = employee
      ? [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.email
      : null;
    const links = linksByDocumentId.get(linkRow.document_id) ?? [];
    links.push(
      toDocumentLink(linkRow, {
        jobTitle: job?.title ?? null,
        jobNumber: job?.job_number ?? null,
        projectName: project?.name ?? null,
        projectNumber: project?.project_number ?? null,
        clientName: client?.name ?? null,
        employeeName: employeeName ?? null,
        employeeEmail: employee?.email ?? null,
      })
    );
    linksByDocumentId.set(linkRow.document_id, links);
  }

  const profilesById = new Map(
    ((profilesResult.data ?? []) as ProfileRow[]).map((profile) => [
      profile.id,
      profile,
    ])
  );

  return rows.map((row) =>
    toOrganizationDocument({
      row,
      uploader: mapProfileToUploader(profilesById.get(row.uploaded_by)),
      links: linksByDocumentId.get(row.id) ?? [],
    })
  );
}

async function hydrateFolders(
  admin: SupabaseAdmin,
  rows: DocumentFolderRow[]
): Promise<DocumentFolder[]> {
  if (rows.length === 0) return [];

  const creatorIds = Array.from(new Set(rows.map((row) => row.created_by)));
  const { data: profiles } = creatorIds.length
    ? await admin
        .from('profiles')
        .select('id, first_name, last_name, email, avatar_path')
        .in('id', creatorIds)
    : { data: [] };

  const profilesById = new Map(
    ((profiles ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
  );

  return rows.map((row) =>
    toDocumentFolder(row, mapProfileToUploader(profilesById.get(row.created_by)))
  );
}

async function getFolderBreadcrumbs({
  admin,
  orgId,
  folderId,
}: {
  admin: SupabaseAdmin;
  orgId: string;
  folderId?: string | null;
}): Promise<DocumentFolder[]> {
  if (!folderId) return [];

  const { data } = await admin
    .from('document_folders')
    .select('*')
    .eq('organization_id', orgId)
    .is('deleted_at', null);

  const folderById = new Map(
    ((data ?? []) as DocumentFolderRow[]).map((folder) => [folder.id, folder])
  );
  const breadcrumbs: DocumentFolder[] = [];
  let current = folderById.get(folderId);

  while (current) {
    breadcrumbs.unshift(toDocumentFolder(current));
    current = current.parent_folder_id
      ? folderById.get(current.parent_folder_id)
      : undefined;
  }

  return breadcrumbs;
}

async function getAuthorizedDocument(
  context: AuthorizedDocumentContext,
  documentId: string
): Promise<
  | { success: true; document: DocumentRow }
  | { success: false; error: string }
> {
  const { data: document } = await context.admin
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .eq('organization_id', context.orgId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!document) {
    return { success: false, error: 'document_not_found' };
  }

  const row = document as DocumentRow;
  if (context.isManagerOrAbove) {
    return { success: true, document: row };
  }

  const { data: links } = await context.admin
    .from('document_links')
    .select('job_id')
    .eq('document_id', row.id)
    .eq('organization_id', context.orgId)
    .not('job_id', 'is', null);

  const jobIds = ((links ?? []) as Pick<DocumentLinkRow, 'job_id'>[])
    .map((link) => link.job_id)
    .filter((jobId): jobId is string => Boolean(jobId));

  if (jobIds.length === 0) {
    return { success: false, error: 'not_authorized' };
  }

  const { data: assignment } = await context.admin
    .from('job_assignments')
    .select('id')
    .in('job_id', jobIds)
    .eq('user_id', context.userId)
    .limit(1)
    .maybeSingle();

  if (!assignment) {
    return { success: false, error: 'not_authorized' };
  }

  return { success: true, document: row };
}

async function getDeletedDocumentForManager(
  context: AuthorizedDocumentContext,
  documentId: string
): Promise<
  | { success: true; document: DocumentRow }
  | { success: false; error: string }
> {
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const { data: document } = await context.admin
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .eq('organization_id', context.orgId)
    .not('deleted_at', 'is', null)
    .maybeSingle();

  if (!document) {
    return { success: false, error: 'document_not_found' };
  }

  return { success: true, document: document as DocumentRow };
}

async function recordDocumentAuditEvent(
  context: AuthorizedDocumentContext,
  input: RecordDocumentAuditEventInput
): Promise<void> {
  const { error } = await context.admin.from('document_audit_events').insert({
    organization_id: context.orgId,
    document_id: input.documentId ?? null,
    folder_id: input.folderId ?? null,
    actor_id: context.userId,
    event_type: input.eventType,
    event_payload: input.eventPayload ?? {},
  });

  if (error) {
    console.error('Failed to record document audit event', error);
  }
}

async function hydrateDocumentVersions(
  admin: SupabaseAdmin,
  rows: DocumentVersionRow[]
): Promise<DocumentVersion[]> {
  if (rows.length === 0) return [];

  const uploaderIds = Array.from(new Set(rows.map((row) => row.uploaded_by)));
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, first_name, last_name, email, avatar_path')
    .in('id', uploaderIds);

  const profilesById = new Map(
    ((profiles ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
  );

  return rows.map((row) =>
    toDocumentVersion({
      row,
      uploader: mapProfileToUploader(profilesById.get(row.uploaded_by)),
    })
  );
}

async function hydrateDocumentAuditEvents(
  admin: SupabaseAdmin,
  rows: DocumentAuditEventRow[]
): Promise<DocumentAuditEvent[]> {
  if (rows.length === 0) return [];

  const actorIds = Array.from(
    new Set(rows.map((row) => row.actor_id).filter((actorId): actorId is string => Boolean(actorId)))
  );
  const { data: profiles } = actorIds.length
    ? await admin
        .from('profiles')
        .select('id, first_name, last_name, email, avatar_path')
        .in('id', actorIds)
    : { data: [] };

  const profilesById = new Map(
    ((profiles ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
  );

  return rows.map((row) =>
    toDocumentAuditEvent({
      row,
      actor: row.actor_id ? mapProfileToUploader(profilesById.get(row.actor_id)) : null,
    })
  );
}

function applyDocumentSearch<T extends { ilike: (column: string, pattern: string) => T; or: (filters: string) => T }>(
  query: T,
  searchQuery?: string | null
): T {
  const search = searchQuery?.trim();
  if (!search) return query;

  const escapedSearch = search
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[%_]/g, '\\$&');
  const pattern = `"%${escapedSearch}%"`;

  return query.or(
    `display_name.ilike.${pattern},original_file_name.ilike.${pattern}`
  );
}

function applyDocumentSort<T extends { order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => T }>(
  query: T,
  sort: DocumentLibrarySort
): T {
  if (sort === 'name') {
    return query.order('display_name', { ascending: true });
  }

  if (sort === 'size_bytes') {
    return query.order('size_bytes', { ascending: false });
  }

  if (sort === 'type') {
    return query.order('mime_type', { ascending: true, nullsFirst: false });
  }

  if (sort === 'category') {
    return query.order('category', { ascending: true });
  }

  if (sort === 'updated_at') {
    return query.order('updated_at', { ascending: false });
  }

  return query.order('created_at', { ascending: false });
}

function getCategoryForView(view: DocumentLibraryView): DocumentCategory | null {
  if (view === 'photos') return 'photo';
  if (view === 'contracts') return 'contract';
  if (view === 'invoices') return 'invoice';
  if (view === 'offers') return 'offer';
  if (view === 'reports') return 'report';
  if (view === 'other') return 'other';
  return null;
}

export async function getDocumentLibrary(
  input: DocumentLibraryInput = {}
): Promise<DocumentLibraryResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const { context } = auth;
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const folderId = input.folderId ?? null;
  const view = input.view ?? 'folders';
  const sort = input.sort ?? 'name';
  const categoryFilter = input.category ?? 'all';
  const linkFilter = input.linkFilter ?? 'all';
  if (view !== 'trash') {
    const folderCheck = await ensureFolder(context.admin, context.orgId, folderId);
    if (!folderCheck.success) return folderCheck;
  }
  const isFolderView = view === 'folders' || Boolean(folderId);

  let foldersQuery = context.admin
    .from('document_folders')
    .select('*')
    .eq('organization_id', context.orgId)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (isFolderView) {
    foldersQuery = folderId
      ? foldersQuery.eq('parent_folder_id', folderId)
      : foldersQuery.is('parent_folder_id', null);
  }

  let documentsQuery = context.admin
    .from('documents')
    .select('*')
    .eq('organization_id', context.orgId);

  documentsQuery =
    view === 'trash'
      ? documentsQuery.not('deleted_at', 'is', null)
      : documentsQuery.is('deleted_at', null);

  documentsQuery = applyDocumentSearch(documentsQuery, input.searchQuery);

  const categoryForView =
    categoryFilter !== 'all' ? categoryFilter : getCategoryForView(view);
  if (categoryForView) {
    documentsQuery = documentsQuery.eq('category', categoryForView);
  }

  if (isFolderView && view !== 'trash') {
    documentsQuery = folderId
      ? documentsQuery.eq('folder_id', folderId)
      : documentsQuery.is('folder_id', null);
  }

  if (view === 'unorganized') {
    documentsQuery = documentsQuery.is('folder_id', null);
  }

  if (
    view === 'work' ||
    view === 'jobs' ||
    view === 'projects' ||
    view === 'clients' ||
    view === 'employees' ||
    view === 'unorganized' ||
    linkFilter !== 'all'
  ) {
    const { data: links, error: linksError } = await context.admin
      .from('document_links')
      .select('document_id, job_id, project_id, client_id, employee_id')
      .eq('organization_id', context.orgId);

    if (linksError) {
      console.error('Failed to load document links for library view:', linksError);
      return { success: false, error: 'documents_failed' };
    }

    const linkRows = (links ?? []) as Pick<
      DocumentLinkRow,
      'document_id' | 'job_id' | 'project_id' | 'client_id' | 'employee_id'
    >[];
    const linkedIds = new Set<string>();
    const filterDocumentIds = new Set<string>();

    for (const link of linkRows) {
      if (view === 'work' && (link.job_id || link.project_id || link.client_id || link.employee_id)) {
        linkedIds.add(link.document_id);
      }
      if (view === 'jobs' && link.job_id) linkedIds.add(link.document_id);
      if (view === 'projects' && link.project_id) linkedIds.add(link.document_id);
      if (view === 'clients' && link.client_id) linkedIds.add(link.document_id);
      if (view === 'employees' && link.employee_id) linkedIds.add(link.document_id);
      if (view === 'unorganized') linkedIds.add(link.document_id);
      if (linkFilter === 'jobs' && link.job_id) filterDocumentIds.add(link.document_id);
      if (linkFilter === 'projects' && link.project_id) filterDocumentIds.add(link.document_id);
      if (linkFilter === 'clients' && link.client_id) filterDocumentIds.add(link.document_id);
      if (linkFilter === 'employees' && link.employee_id) filterDocumentIds.add(link.document_id);
      if (linkFilter === 'unlinked') filterDocumentIds.add(link.document_id);
    }

    if (view === 'unorganized' || linkFilter === 'unlinked') {
      const allLinkedIds = Array.from(
        view === 'unorganized' ? linkedIds : filterDocumentIds
      );
      if (allLinkedIds.length > 0) {
        documentsQuery = documentsQuery.not('id', 'in', `(${allLinkedIds.join(',')})`);
      }
    } else {
      const viewDocumentIds = Array.from(
        linkFilter !== 'all' ? filterDocumentIds : linkedIds
      );
      if (viewDocumentIds.length === 0) {
        return {
          success: true,
          breadcrumbs: [],
          folders: [],
          documents: [],
        };
      }
      documentsQuery = documentsQuery.in('id', viewDocumentIds);
    }
  }

  documentsQuery = applyDocumentSort(documentsQuery, sort).limit(200);

  const [foldersResult, documentsResult] = await Promise.all([
    isFolderView && view !== 'trash'
      ? foldersQuery
      : Promise.resolve({ data: [], error: null }),
    documentsQuery,
  ]);

  if (foldersResult.error) {
    console.error('Failed to load document folders:', foldersResult.error);
    return { success: false, error: 'folders_failed' };
  }

  if (documentsResult.error) {
    console.error('Failed to load documents:', documentsResult.error);
    return { success: false, error: 'documents_failed' };
  }

  return {
    success: true,
    breadcrumbs:
      view === 'trash'
        ? []
        : await getFolderBreadcrumbs({
            admin: context.admin,
            orgId: context.orgId,
            folderId,
          }),
    folders: await hydrateFolders(
      context.admin,
      (foldersResult.data ?? []) as DocumentFolderRow[]
    ),
    documents: await hydrateDocuments(
      context.admin,
      (documentsResult.data ?? []) as DocumentRow[]
    ),
  };
}

export async function getDocumentFolderOptions(): Promise<
  | { success: true; folders: DocumentFolder[] }
  | { success: false; error: string }
> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const { data, error } = await auth.context.admin
    .from('document_folders')
    .select('*')
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to load document folder options:', error);
    return { success: false, error: 'folders_failed' };
  }

  return {
    success: true,
    folders: await hydrateFolders(auth.context.admin, (data ?? []) as DocumentFolderRow[]),
  };
}

export async function getAttachableDocuments(
  input: AttachableDocumentsInput
): Promise<DocumentListResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const access =
    input.targetType === 'job'
      ? await ensureJobAccess(auth.context, input.targetId)
      : input.targetType === 'project'
        ? await ensureProjectManagerAccess(auth.context, input.targetId)
        : input.targetType === 'client'
          ? await ensureClientManagerAccess(auth.context, input.targetId)
          : await ensureEmployeeManagerAccess(auth.context, input.targetId);
  if (!access.success) return access;

  const linkColumn =
    input.targetType === 'job'
      ? 'job_id'
      : input.targetType === 'project'
        ? 'project_id'
        : input.targetType === 'client'
          ? 'client_id'
          : 'employee_id';
  const { data: existingLinks, error: linksError } = await auth.context.admin
    .from('document_links')
    .select('document_id')
    .eq('organization_id', auth.context.orgId)
    .eq(linkColumn, input.targetId);

  if (linksError) {
    console.error('Failed to load existing document links:', linksError);
    return { success: false, error: 'documents_failed' };
  }

  const existingDocumentIds = ((existingLinks ?? []) as Pick<
    DocumentLinkRow,
    'document_id'
  >[]).map((link) => link.document_id);

  let query = auth.context.admin
    .from('documents')
    .select('*')
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null);

  query = applyDocumentSearch(query, input.searchQuery);

  if (input.category && input.category !== 'all') {
    query = query.eq('category', input.category);
  }

  if (existingDocumentIds.length > 0) {
    query = query.not('id', 'in', `(${existingDocumentIds.join(',')})`);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Failed to load attachable documents:', error);
    return { success: false, error: 'documents_failed' };
  }

  return {
    success: true,
    documents: await hydrateDocuments(auth.context.admin, (data ?? []) as DocumentRow[]),
  };
}

export async function getJobDocuments(jobId: string): Promise<DocumentListResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const access = await ensureJobAccess(auth.context, jobId);
  if (!access.success) return access;

  const { data: links, error: linksError } = await auth.context.admin
    .from('document_links')
    .select('document_id')
    .eq('organization_id', auth.context.orgId)
    .eq('job_id', jobId);

  if (linksError) {
    console.error('Failed to load job document links:', linksError);
    return { success: false, error: 'documents_failed' };
  }

  const documentIds = ((links ?? []) as Pick<DocumentLinkRow, 'document_id'>[]).map(
    (link) => link.document_id
  );

  if (documentIds.length === 0) {
    return { success: true, documents: [] };
  }

  const { data: documents, error: documentsError } = await auth.context.admin
    .from('documents')
    .select('*')
    .in('id', documentIds)
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (documentsError) {
    console.error('Failed to load job documents:', documentsError);
    return { success: false, error: 'documents_failed' };
  }

  return {
    success: true,
    documents: await hydrateDocuments(
      auth.context.admin,
      (documents ?? []) as DocumentRow[]
    ),
  };
}

export async function getProjectDocuments(
  projectId: string
): Promise<DocumentListResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const access = await ensureProjectManagerAccess(auth.context, projectId);
  if (!access.success) return access;

  const { data: links, error: linksError } = await auth.context.admin
    .from('document_links')
    .select('document_id')
    .eq('organization_id', auth.context.orgId)
    .eq('project_id', projectId);

  if (linksError) {
    console.error('Failed to load project document links:', linksError);
    return { success: false, error: 'documents_failed' };
  }

  const documentIds = ((links ?? []) as Pick<DocumentLinkRow, 'document_id'>[]).map(
    (link) => link.document_id
  );

  if (documentIds.length === 0) {
    return { success: true, documents: [] };
  }

  const { data: documents, error: documentsError } = await auth.context.admin
    .from('documents')
    .select('*')
    .in('id', documentIds)
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (documentsError) {
    console.error('Failed to load project documents:', documentsError);
    return { success: false, error: 'documents_failed' };
  }

  return {
    success: true,
    documents: await hydrateDocuments(
      auth.context.admin,
      (documents ?? []) as DocumentRow[]
    ),
  };
}

export async function getProjectDocumentsOverview(
  projectId: string,
  jobs: Array<Pick<Job, 'id' | 'jobNumber' | 'title'>>
): Promise<ProjectDocumentsOverviewResult> {
  const projectResult = await getProjectDocuments(projectId);
  if (!projectResult.success) return projectResult;

  const jobDocumentResults = await Promise.all(
    jobs.map((job) => getJobDocuments(job.id))
  );

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

export async function getDocumentLinkCatalog(): Promise<
  | {
      success: true;
      jobs: Job[];
      projects: ProjectWithDetails[];
      clients: Client[];
      employees: DocumentEmployee[];
    }
  | { success: false; error: string }
> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const [jobsResult, projectsResult, clientsResult, membersResult] = await Promise.all([
    getOrgJobs(),
    getOrgProjects(),
    getOrgClients(),
    getOrgMembersForUser(auth.context.orgId, auth.context.userId),
  ]);

  if (!jobsResult.success) {
    return { success: false, error: jobsResult.error };
  }
  if (!projectsResult.success) {
    return { success: false, error: projectsResult.error };
  }
  if (!clientsResult.success) {
    return { success: false, error: clientsResult.error };
  }

  return {
    success: true,
    jobs: jobsResult.jobs,
    projects: projectsResult.projects,
    clients: clientsResult.clients,
    employees: membersResult.map((member) => ({
      userId: member.user_id,
      firstName: member.first_name,
      lastName: member.last_name,
      email: member.email,
      role: member.role,
    })),
  };
}

export async function getClientDocuments(
  clientId: string
): Promise<DocumentListResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const access = await ensureClientManagerAccess(auth.context, clientId);
  if (!access.success) return access;

  const { data: links, error: linksError } = await auth.context.admin
    .from('document_links')
    .select('document_id')
    .eq('organization_id', auth.context.orgId)
    .eq('client_id', clientId);

  if (linksError) {
    console.error('Failed to load client document links:', linksError);
    return { success: false, error: 'documents_failed' };
  }

  const documentIds = ((links ?? []) as Pick<DocumentLinkRow, 'document_id'>[]).map(
    (link) => link.document_id
  );

  if (documentIds.length === 0) {
    return { success: true, documents: [] };
  }

  const { data: documents, error: documentsError } = await auth.context.admin
    .from('documents')
    .select('*')
    .in('id', documentIds)
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (documentsError) {
    console.error('Failed to load client documents:', documentsError);
    return { success: false, error: 'documents_failed' };
  }

  return {
    success: true,
    documents: await hydrateDocuments(
      auth.context.admin,
      (documents ?? []) as DocumentRow[]
    ),
  };
}

export async function getEmployeeDocuments(
  employeeId: string
): Promise<DocumentListResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const access = await ensureEmployeeManagerAccess(auth.context, employeeId);
  if (!access.success) return access;

  const { data: links, error: linksError } = await auth.context.admin
    .from('document_links')
    .select('document_id')
    .eq('organization_id', auth.context.orgId)
    .eq('employee_id', employeeId);

  if (linksError) {
    console.error('Failed to load employee document links:', linksError);
    return { success: false, error: 'documents_failed' };
  }

  const documentIds = ((links ?? []) as Pick<DocumentLinkRow, 'document_id'>[]).map(
    (link) => link.document_id
  );

  if (documentIds.length === 0) {
    return { success: true, documents: [] };
  }

  const { data: documents, error: documentsError } = await auth.context.admin
    .from('documents')
    .select('*')
    .in('id', documentIds)
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (documentsError) {
    console.error('Failed to load employee documents:', documentsError);
    return { success: false, error: 'documents_failed' };
  }

  return {
    success: true,
    documents: await hydrateDocuments(
      auth.context.admin,
      (documents ?? []) as DocumentRow[]
    ),
  };
}

export async function createDocumentFolder(
  input: CreateFolderInput
): Promise<FolderResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const name = trimName(input.name);
  if (!name) {
    return { success: false, error: 'name_required' };
  }

  const folderCheck = await ensureFolder(
    auth.context.admin,
    auth.context.orgId,
    input.parentFolderId
  );
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
    console.error('Failed to create document folder:', error);
    return { success: false, error: 'create_failed' };
  }

  revalidateDocuments(auth.context.orgId);
  return { success: true, folder: toDocumentFolder(data as DocumentFolderRow) };
}

export async function renameDocumentFolder(
  input: RenameFolderInput
): Promise<FolderResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const name = trimName(input.name);
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
    console.error('Failed to rename document folder:', error);
    return { success: false, error: 'update_failed' };
  }

  revalidateDocuments(auth.context.orgId);
  return { success: true, folder: toDocumentFolder(data as DocumentFolderRow) };
}

export async function moveDocumentFolder(
  input: MoveFolderInput
): Promise<FolderResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  if (input.parentFolderId === input.folderId) {
    return { success: false, error: 'invalid_target' };
  }

  const folder = await getFolderById(
    auth.context.admin,
    auth.context.orgId,
    input.folderId
  );
  if (!folder) return { success: false, error: 'folder_not_found' };

  if ((folder.parent_folder_id ?? null) === (input.parentFolderId ?? null)) {
    return { success: false, error: 'invalid_target' };
  }

  const targetCheck = await ensureFolder(
    auth.context.admin,
    auth.context.orgId,
    input.parentFolderId
  );
  if (!targetCheck.success) return targetCheck;

  const { data: allFolders } = await auth.context.admin
    .from('document_folders')
    .select('id, parent_folder_id')
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null);

  const childIdsByParent = new Map<string, string[]>();
  for (const row of (allFolders ?? []) as Pick<
    DocumentFolderRow,
    'id' | 'parent_folder_id'
  >[]) {
    if (!row.parent_folder_id) continue;
    const ids = childIdsByParent.get(row.parent_folder_id) ?? [];
    ids.push(row.id);
    childIdsByParent.set(row.parent_folder_id, ids);
  }

  const descendantIds = new Set<string>();
  const stack = [...(childIdsByParent.get(input.folderId) ?? [])];
  while (stack.length > 0) {
    const nextId = stack.pop()!;
    descendantIds.add(nextId);
    stack.push(...(childIdsByParent.get(nextId) ?? []));
  }

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
    console.error('Failed to move document folder:', error);
    return { success: false, error: 'update_failed' };
  }

  revalidateDocuments(auth.context.orgId);
  return { success: true, folder: toDocumentFolder(data as DocumentFolderRow) };
}

export async function copyDocumentFolder(
  input: CopyFolderInput
): Promise<FolderResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;
  const { context } = auth;

  const sourceFolder = await getFolderById(
    auth.context.admin,
    auth.context.orgId,
    input.folderId
  );
  if (!sourceFolder) return { success: false, error: 'folder_not_found' };

  const targetCheck = await ensureFolder(
    auth.context.admin,
    auth.context.orgId,
    input.targetParentFolderId
  );
  if (!targetCheck.success) return targetCheck;

  const { data: allFolders } = await auth.context.admin
    .from('document_folders')
    .select('*')
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null);

  const childFoldersByParent = new Map<string, DocumentFolderRow[]>();
  for (const folder of (allFolders ?? []) as DocumentFolderRow[]) {
    if (!folder.parent_folder_id) continue;
    const siblings = childFoldersByParent.get(folder.parent_folder_id) ?? [];
    siblings.push(folder);
    childFoldersByParent.set(folder.parent_folder_id, siblings);
  }

  const sourceFolderIds = new Set<string>([input.folderId]);
  const stack = [...(childFoldersByParent.get(input.folderId) ?? [])];
  const orderedSourceFolders: DocumentFolderRow[] = [];
  while (stack.length > 0) {
    const folder = stack.shift()!;
    sourceFolderIds.add(folder.id);
    orderedSourceFolders.push(folder);
    stack.push(...(childFoldersByParent.get(folder.id) ?? []));
  }

  if (
    input.targetParentFolderId &&
    sourceFolderIds.has(input.targetParentFolderId)
  ) {
    return { success: false, error: 'invalid_target' };
  }

  const createdFolderIds: string[] = [];
  const createdDocumentIds: string[] = [];
  const createdStoragePaths: string[] = [];

  async function cleanupPartialCopy() {
    if (createdStoragePaths.length > 0) {
      await context.admin.storage
        .from(DOCUMENT_STORAGE_BUCKET)
        .remove(createdStoragePaths);
    }
    if (createdDocumentIds.length > 0) {
      await context.admin
        .from('documents')
        .delete()
        .eq('organization_id', context.orgId)
        .in('id', createdDocumentIds);
    }
    if (createdFolderIds.length > 0) {
      await context.admin
        .from('document_folders')
        .delete()
        .eq('organization_id', context.orgId)
        .in('id', createdFolderIds);
    }
  }

  const folderIdMap = new Map<string, string>();
  const rootFolderName = await getAvailableFolderName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    parentFolderId: input.targetParentFolderId,
    preferredName: getCopyDisplayName(sourceFolder.name),
  });

  const rootFolderId = randomUUID();
  const { data: copiedRootFolder, error: copiedRootFolderError } =
    await auth.context.admin
      .from('document_folders')
      .insert({
        id: rootFolderId,
        organization_id: auth.context.orgId,
        parent_folder_id: input.targetParentFolderId || null,
        name: rootFolderName,
        created_by: auth.context.userId,
      })
      .select('*')
      .single();

  if (copiedRootFolderError || !copiedRootFolder) {
    console.error('Failed to copy root document folder:', copiedRootFolderError);
    return { success: false, error: 'copy_failed' };
  }

  createdFolderIds.push(rootFolderId);
  folderIdMap.set(input.folderId, rootFolderId);

  for (const sourceChildFolder of orderedSourceFolders) {
    const parentFolderId = sourceChildFolder.parent_folder_id
      ? folderIdMap.get(sourceChildFolder.parent_folder_id)
      : rootFolderId;

    if (!parentFolderId) {
      await cleanupPartialCopy();
      return { success: false, error: 'copy_failed' };
    }

    const folderName = await getAvailableFolderName({
      admin: auth.context.admin,
      orgId: auth.context.orgId,
      parentFolderId,
      preferredName: getCopyDisplayName(sourceChildFolder.name),
    });
    const folderId = randomUUID();
    const { error } = await auth.context.admin.from('document_folders').insert({
      id: folderId,
      organization_id: auth.context.orgId,
      parent_folder_id: parentFolderId,
      name: folderName,
      created_by: auth.context.userId,
    });

    if (error) {
      console.error('Failed to copy child document folder:', error);
      await cleanupPartialCopy();
      return { success: false, error: 'copy_failed' };
    }

    createdFolderIds.push(folderId);
    folderIdMap.set(sourceChildFolder.id, folderId);
  }

  const { data: sourceDocuments, error: sourceDocumentsError } =
    await auth.context.admin
      .from('documents')
      .select('*')
      .eq('organization_id', auth.context.orgId)
      .in('folder_id', Array.from(sourceFolderIds))
      .is('deleted_at', null);

  if (sourceDocumentsError) {
    console.error('Failed to load documents for folder copy:', sourceDocumentsError);
    await cleanupPartialCopy();
    return { success: false, error: 'copy_failed' };
  }

  for (const sourceDocument of (sourceDocuments ?? []) as DocumentRow[]) {
    const targetFolderId = sourceDocument.folder_id
      ? folderIdMap.get(sourceDocument.folder_id)
      : rootFolderId;

    if (!targetFolderId) {
      await cleanupPartialCopy();
      return { success: false, error: 'copy_failed' };
    }

    const documentId = randomUUID();
    const storagePath = buildStoragePath({
      orgId: auth.context.orgId,
      documentId,
      fileName: sourceDocument.original_file_name,
    });
    const storageCopyResult = await copyStorageObject({
      admin: auth.context.admin,
      sourcePath: sourceDocument.storage_path,
      targetPath: storagePath,
      contentType: sourceDocument.mime_type,
    });

    if (!storageCopyResult.success) {
      console.error(
        'Failed to copy document storage object in folder:',
        storageCopyResult.error
      );
      await cleanupPartialCopy();
      return { success: false, error: 'copy_failed' };
    }

    createdStoragePaths.push(storagePath);
    const displayName = await getAvailableDisplayName({
      admin: auth.context.admin,
      orgId: auth.context.orgId,
      folderId: targetFolderId,
      preferredName: getCopyDisplayName(sourceDocument.display_name),
    });

    const { error: documentCopyError } = await auth.context.admin
      .from('documents')
      .insert({
        id: documentId,
        organization_id: auth.context.orgId,
        folder_id: targetFolderId,
        storage_bucket: DOCUMENT_STORAGE_BUCKET,
        storage_path: storagePath,
        original_file_name: sourceDocument.original_file_name,
        display_name: displayName,
        category: toDocumentCategory(sourceDocument.category),
        mime_type: sourceDocument.mime_type,
        size_bytes: sourceDocument.size_bytes,
        uploaded_by: auth.context.userId,
        copied_from_document_id: sourceDocument.id,
        metadata: sourceDocument.metadata,
      });

    if (documentCopyError) {
      console.error('Failed to create copied folder document metadata:', documentCopyError);
      await cleanupPartialCopy();
      return { success: false, error: 'copy_failed' };
    }

    createdDocumentIds.push(documentId);
    await recordDocumentAuditEvent(auth.context, {
      documentId,
      folderId: targetFolderId,
      eventType: 'copied',
      eventPayload: {
        copiedFromDocumentId: sourceDocument.id,
        copiedFromFolderId: input.folderId,
        sourceStoragePath: sourceDocument.storage_path,
        storagePath,
      },
    });
  }

  await recordDocumentAuditEvent(auth.context, {
    folderId: rootFolderId,
    eventType: 'copied',
    eventPayload: {
      copiedFromFolderId: input.folderId,
      toParentFolderId: input.targetParentFolderId ?? null,
      copiedFolderCount: createdFolderIds.length,
      copiedDocumentCount: createdDocumentIds.length,
    },
  });

  revalidateDocuments(auth.context.orgId);
  return {
    success: true,
    folder: toDocumentFolder(copiedRootFolder as DocumentFolderRow),
  };
}

export async function deleteDocumentFolder(
  folderId: string
): Promise<DocumentMutationResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const folder = await getFolderById(auth.context.admin, auth.context.orgId, folderId);
  if (!folder) return { success: false, error: 'folder_not_found' };

  const { data: allFolders } = await auth.context.admin
    .from('document_folders')
    .select('id, parent_folder_id')
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null);

  const childIdsByParent = new Map<string, string[]>();
  for (const row of (allFolders ?? []) as Pick<
    DocumentFolderRow,
    'id' | 'parent_folder_id'
  >[]) {
    if (!row.parent_folder_id) continue;
    const ids = childIdsByParent.get(row.parent_folder_id) ?? [];
    ids.push(row.id);
    childIdsByParent.set(row.parent_folder_id, ids);
  }

  const folderIds = new Set<string>([folderId]);
  const stack = [...(childIdsByParent.get(folderId) ?? [])];
  while (stack.length > 0) {
    const nextId = stack.pop()!;
    folderIds.add(nextId);
    stack.push(...(childIdsByParent.get(nextId) ?? []));
  }

  const { data: documents } = await auth.context.admin
    .from('documents')
    .select('id, storage_path')
    .eq('organization_id', auth.context.orgId)
    .in('folder_id', Array.from(folderIds))
    .is('deleted_at', null);

  const now = new Date().toISOString();
  const { error: documentsError } = await auth.context.admin
    .from('documents')
    .update({
      deleted_at: now,
      deleted_by: auth.context.userId,
      delete_reason: 'folder_deleted',
    })
    .eq('organization_id', auth.context.orgId)
    .in('folder_id', Array.from(folderIds))
    .is('deleted_at', null);

  if (documentsError) {
    console.error('Failed to delete documents in folder:', documentsError);
    return { success: false, error: 'delete_failed' };
  }

  const { error: foldersError } = await auth.context.admin
    .from('document_folders')
    .update({ deleted_at: now })
    .eq('organization_id', auth.context.orgId)
    .in('id', Array.from(folderIds));

  if (foldersError) {
    console.error('Failed to delete document folder:', foldersError);
    return { success: false, error: 'delete_failed' };
  }

  for (const document of (documents ?? []) as Pick<DocumentRow, 'id' | 'storage_path'>[]) {
    await recordDocumentAuditEvent(auth.context, {
      documentId: document.id,
      folderId,
      eventType: 'deleted',
      eventPayload: { reason: 'folder_deleted', storagePath: document.storage_path },
    });
  }

  revalidateDocuments(auth.context.orgId);
  return { success: true };
}

export async function uploadDocument(formData: FormData): Promise<DocumentResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const fileEntry = formData.get('file');
  if (!(fileEntry instanceof File)) {
    return { success: false, error: 'file_required' };
  }

  if (fileEntry.size <= 0) {
    return { success: false, error: 'file_empty' };
  }

  if (fileEntry.size > DOCUMENT_MAX_FILE_SIZE_BYTES) {
    return { success: false, error: 'file_too_large' };
  }

  const folderId = (formData.get('folderId')?.toString() || '').trim() || null;
  const jobId = (formData.get('jobId')?.toString() || '').trim() || null;
  const projectId = (formData.get('projectId')?.toString() || '').trim() || null;
  const clientId = (formData.get('clientId')?.toString() || '').trim() || null;
  const employeeId = (formData.get('employeeId')?.toString() || '').trim() || null;

  if ([jobId, projectId, clientId, employeeId].filter(Boolean).length > 1) {
    return { success: false, error: 'invalid_target' };
  }

  if (jobId) {
    const access = await ensureJobAccess(auth.context, jobId);
    if (!access.success) return access;
  } else if (projectId) {
    const access = await ensureProjectManagerAccess(auth.context, projectId);
    if (!access.success) return access;
  } else if (clientId) {
    const access = await ensureClientManagerAccess(auth.context, clientId);
    if (!access.success) return access;
  } else if (employeeId) {
    const access = await ensureEmployeeManagerAccess(auth.context, employeeId);
    if (!access.success) return access;
  } else {
    const manager = requireManager(auth.context);
    if (!manager.success) return manager;
  }

  if (folderId && !auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const folderCheck = await ensureFolder(
    auth.context.admin,
    auth.context.orgId,
    folderId
  );
  if (!folderCheck.success) return folderCheck;

  const originalFileName = trimName(fileEntry.name) || 'Dokument';
  const displayName = await getAvailableDisplayName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    folderId,
    preferredName: originalFileName,
  });
  const documentId = randomUUID();
  const storagePath = buildStoragePath({
    orgId: auth.context.orgId,
    documentId,
    fileName: originalFileName,
  });
  const fileBuffer = Buffer.from(await fileEntry.arrayBuffer());
  const contentType = fileEntry.type || 'application/octet-stream';
  const category =
    parseDocumentCategory(formData.get('category')) ??
    inferDocumentCategory({
      fileName: originalFileName,
      mimeType: contentType,
    });

  const { error: uploadError } = await auth.context.admin.storage
    .from(DOCUMENT_STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, {
      cacheControl: '3600',
      contentType,
      upsert: false,
    });

  if (uploadError) {
    console.error('Failed to upload document:', uploadError);
    return { success: false, error: 'upload_failed' };
  }

  const { data: documentRow, error: insertError } = await auth.context.admin
    .from('documents')
    .insert({
      id: documentId,
      organization_id: auth.context.orgId,
      folder_id: folderId,
      storage_bucket: DOCUMENT_STORAGE_BUCKET,
      storage_path: storagePath,
      original_file_name: originalFileName,
      display_name: displayName,
      category,
      mime_type: contentType,
      size_bytes: fileEntry.size,
      uploaded_by: auth.context.userId,
    })
    .select('*')
    .single();

  if (insertError || !documentRow) {
    await auth.context.admin.storage.from(DOCUMENT_STORAGE_BUCKET).remove([storagePath]);
    console.error('Failed to create document metadata:', insertError);
    return { success: false, error: 'create_failed' };
  }

  if (jobId || projectId || clientId || employeeId) {
    const { error: linkError } = await auth.context.admin
      .from('document_links')
      .insert({
        organization_id: auth.context.orgId,
        document_id: documentId,
        job_id: jobId,
        project_id: projectId,
        client_id: clientId,
        employee_id: employeeId,
        created_by: auth.context.userId,
      });

    if (linkError) {
      await auth.context.admin
        .from('documents')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', documentId);
      await auth.context.admin.storage
        .from(DOCUMENT_STORAGE_BUCKET)
        .remove([storagePath]);
      console.error('Failed to create document link:', linkError);
      return { success: false, error: 'link_failed' };
    }
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId,
    folderId,
    eventType: 'uploaded',
    eventPayload: {
      displayName,
      originalFileName,
      category,
      sizeBytes: fileEntry.size,
      mimeType: contentType,
      jobId,
      projectId,
      clientId,
      employeeId,
    },
  });

  if (jobId || projectId || clientId || employeeId) {
    await recordDocumentAuditEvent(auth.context, {
      documentId,
      eventType: 'linked',
      eventPayload: { jobId, projectId, clientId, employeeId },
    });
  }

  revalidateDocuments(auth.context.orgId);
  const [document] = await hydrateDocuments(auth.context.admin, [
    documentRow as DocumentRow,
  ]);

  return { success: true, document };
}

export async function renameDocument(
  input: RenameDocumentInput
): Promise<DocumentResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  const displayName = trimName(input.displayName);
  if (!displayName) {
    return { success: false, error: 'name_required' };
  }

  const { data, error } = await auth.context.admin
    .from('documents')
    .update({ display_name: displayName })
    .eq('id', existing.document.id)
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null)
    .select('*')
    .single();

  if (error || !data) {
    console.error('Failed to rename document:', error);
    return { success: false, error: 'update_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId: existing.document.id,
    folderId: existing.document.folder_id,
    eventType: 'renamed',
    eventPayload: {
      from: existing.document.display_name,
      to: displayName,
    },
  });

  revalidateDocuments(auth.context.orgId);
  const [document] = await hydrateDocuments(auth.context.admin, [data as DocumentRow]);
  return { success: true, document };
}

export async function updateDocumentCategory(
  input: UpdateDocumentCategoryInput
): Promise<DocumentResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  if (!DOCUMENT_CATEGORIES.includes(input.category)) {
    return { success: false, error: 'invalid_category' };
  }

  const { data, error } = await auth.context.admin
    .from('documents')
    .update({ category: input.category })
    .eq('id', existing.document.id)
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null)
    .select('*')
    .single();

  if (error || !data) {
    console.error('Failed to update document category:', error);
    return { success: false, error: 'update_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId: existing.document.id,
    folderId: existing.document.folder_id,
    eventType: 'category_changed',
    eventPayload: {
      from: existing.document.category,
      to: input.category,
    },
  });

  revalidateDocuments(auth.context.orgId);
  const [document] = await hydrateDocuments(auth.context.admin, [data as DocumentRow]);
  return { success: true, document };
}

export async function moveDocument(input: MoveDocumentInput): Promise<DocumentResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  if ((existing.document.folder_id ?? null) === (input.folderId ?? null)) {
    return { success: false, error: 'invalid_target' };
  }

  const folderCheck = await ensureFolder(
    auth.context.admin,
    auth.context.orgId,
    input.folderId
  );
  if (!folderCheck.success) return folderCheck;

  const displayName = await getAvailableDisplayName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    folderId: input.folderId,
    preferredName: existing.document.display_name,
  });

  const { data, error } = await auth.context.admin
    .from('documents')
    .update({
      folder_id: input.folderId || null,
      display_name: displayName,
    })
    .eq('id', existing.document.id)
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null)
    .select('*')
    .single();

  if (error || !data) {
    console.error('Failed to move document:', error);
    return { success: false, error: 'update_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId: existing.document.id,
    folderId: input.folderId ?? null,
    eventType: 'moved',
    eventPayload: {
      fromFolderId: existing.document.folder_id,
      toFolderId: input.folderId ?? null,
      displayNameChanged: existing.document.display_name !== displayName,
    },
  });

  revalidateDocuments(auth.context.orgId);
  const [document] = await hydrateDocuments(auth.context.admin, [data as DocumentRow]);
  return { success: true, document };
}

export async function copyDocument(input: CopyDocumentInput): Promise<DocumentResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  const folderCheck = await ensureFolder(
    auth.context.admin,
    auth.context.orgId,
    input.targetFolderId
  );
  if (!folderCheck.success) return folderCheck;

  const documentId = randomUUID();
  const displayName = await getAvailableDisplayName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    folderId: input.targetFolderId,
    preferredName: getCopyDisplayName(existing.document.display_name),
  });
  const storagePath = buildStoragePath({
    orgId: auth.context.orgId,
    documentId,
    fileName: existing.document.original_file_name,
  });

  const storageCopyResult = await copyStorageObject({
    admin: auth.context.admin,
    sourcePath: existing.document.storage_path,
    targetPath: storagePath,
    contentType: existing.document.mime_type,
  });

  if (!storageCopyResult.success) {
    console.error('Failed to copy document storage object:', storageCopyResult.error);
    return { success: false, error: 'copy_failed' };
  }

  const { data, error } = await auth.context.admin
    .from('documents')
    .insert({
      id: documentId,
      organization_id: auth.context.orgId,
      folder_id: input.targetFolderId || null,
      storage_bucket: DOCUMENT_STORAGE_BUCKET,
      storage_path: storagePath,
      original_file_name: existing.document.original_file_name,
      display_name: displayName,
      category: toDocumentCategory(existing.document.category),
      mime_type: existing.document.mime_type,
      size_bytes: existing.document.size_bytes,
      uploaded_by: auth.context.userId,
      copied_from_document_id: existing.document.id,
      metadata: existing.document.metadata,
    })
    .select('*')
    .single();

  if (error || !data) {
    await auth.context.admin.storage.from(DOCUMENT_STORAGE_BUCKET).remove([storagePath]);
    console.error('Failed to create copied document metadata:', error);
    return { success: false, error: 'copy_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId,
    folderId: input.targetFolderId ?? null,
    eventType: 'copied',
    eventPayload: {
      copiedFromDocumentId: existing.document.id,
      sourceStoragePath: existing.document.storage_path,
      storagePath,
    },
  });

  revalidateDocuments(auth.context.orgId);
  const [document] = await hydrateDocuments(auth.context.admin, [data as DocumentRow]);
  return { success: true, document };
}

export async function deleteDocument(
  documentId: string
): Promise<DocumentMutationResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, documentId);
  if (!existing.success) return existing;

  const { error } = await auth.context.admin
    .from('documents')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: auth.context.userId,
      delete_reason: 'user_deleted',
    })
    .eq('id', existing.document.id)
    .eq('organization_id', auth.context.orgId);

  if (error) {
    console.error('Failed to delete document metadata:', error);
    return { success: false, error: 'delete_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId: existing.document.id,
    folderId: existing.document.folder_id,
    eventType: 'deleted',
    eventPayload: {
      reason: 'user_deleted',
      storagePath: existing.document.storage_path,
    },
  });

  revalidateDocuments(auth.context.orgId);
  return { success: true };
}

export async function linkDocumentToJob(
  input: LinkDocumentToJobInput
): Promise<DocumentMutationResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const document = await getAuthorizedDocument(auth.context, input.documentId);
  if (!document.success) return document;

  const jobAccess = await ensureJobAccess(auth.context, input.jobId);
  if (!jobAccess.success) return jobAccess;

  const { error } = await auth.context.admin
    .from('document_links')
    .insert({
      organization_id: auth.context.orgId,
      document_id: input.documentId,
      job_id: input.jobId,
      created_by: auth.context.userId,
    });

  if (error) {
    if (error.code === '23505') {
      return { success: true };
    }
    console.error('Failed to link document to job:', error);
    return { success: false, error: 'link_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId: input.documentId,
    eventType: 'linked',
    eventPayload: { jobId: input.jobId },
  });

  revalidateDocuments(auth.context.orgId);
  return { success: true };
}

export async function linkDocumentToProject(
  input: LinkDocumentToProjectInput
): Promise<DocumentMutationResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const document = await getAuthorizedDocument(auth.context, input.documentId);
  if (!document.success) return document;

  const projectAccess = await ensureProjectManagerAccess(auth.context, input.projectId);
  if (!projectAccess.success) return projectAccess;

  const { error } = await auth.context.admin
    .from('document_links')
    .insert({
      organization_id: auth.context.orgId,
      document_id: input.documentId,
      project_id: input.projectId,
      created_by: auth.context.userId,
    });

  if (error) {
    if (error.code === '23505') {
      return { success: true };
    }
    console.error('Failed to link document to project:', error);
    return { success: false, error: 'link_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId: input.documentId,
    eventType: 'linked',
    eventPayload: { projectId: input.projectId },
  });

  revalidateDocuments(auth.context.orgId);
  return { success: true };
}

export async function linkDocumentToClient(
  input: LinkDocumentToClientInput
): Promise<DocumentMutationResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const document = await getAuthorizedDocument(auth.context, input.documentId);
  if (!document.success) return document;

  const clientAccess = await ensureClientManagerAccess(auth.context, input.clientId);
  if (!clientAccess.success) return clientAccess;

  const { error } = await auth.context.admin
    .from('document_links')
    .insert({
      organization_id: auth.context.orgId,
      document_id: input.documentId,
      client_id: input.clientId,
      created_by: auth.context.userId,
    });

  if (error) {
    if (error.code === '23505') {
      return { success: true };
    }
    console.error('Failed to link document to client:', error);
    return { success: false, error: 'link_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId: input.documentId,
    eventType: 'linked',
    eventPayload: { clientId: input.clientId },
  });

  revalidateDocuments(auth.context.orgId);
  return { success: true };
}

export async function linkDocumentToEmployee(
  input: LinkDocumentToEmployeeInput
): Promise<DocumentMutationResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const document = await getAuthorizedDocument(auth.context, input.documentId);
  if (!document.success) return document;

  const employeeAccess = await ensureEmployeeManagerAccess(
    auth.context,
    input.employeeId
  );
  if (!employeeAccess.success) return employeeAccess;

  const { error } = await auth.context.admin
    .from('document_links')
    .insert({
      organization_id: auth.context.orgId,
      document_id: input.documentId,
      employee_id: input.employeeId,
      created_by: auth.context.userId,
    });

  if (error) {
    if (error.code === '23505') {
      return { success: true };
    }
    console.error('Failed to link document to employee:', error);
    return { success: false, error: 'link_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId: input.documentId,
    eventType: 'linked',
    eventPayload: { employeeId: input.employeeId },
  });

  revalidateDocuments(auth.context.orgId);
  return { success: true };
}

export async function unlinkDocument(
  input: UnlinkDocumentInput
): Promise<DocumentMutationResult> {
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
    console.error('Failed to load document link for unlink:', linkLoadError);
    return { success: false, error: 'link_not_found' };
  }

  const linkRow = link as DocumentLinkRow;

  const { error } = await auth.context.admin
    .from('document_links')
    .delete()
    .eq('id', input.linkId)
    .eq('organization_id', auth.context.orgId);

  if (error) {
    console.error('Failed to unlink document:', error);
    return { success: false, error: 'unlink_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId: linkRow.document_id,
    eventType: 'unlinked',
    eventPayload: {
      jobId: linkRow.job_id,
      projectId: linkRow.project_id,
      clientId: linkRow.client_id,
      employeeId: linkRow.employee_id,
    },
  });

  revalidateDocuments(auth.context.orgId);
  return { success: true };
}

export async function updateDocumentLinks(
  input: UpdateDocumentLinksInput
): Promise<UpdateDocumentLinksResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) {
    return {
      success: false,
      error: auth.error,
      addedCount: 0,
      removedCount: 0,
      failedCount: 0,
    };
  }

  const manager = requireManager(auth.context);
  if (!manager.success) {
    return {
      success: false,
      error: manager.error,
      addedCount: 0,
      removedCount: 0,
      failedCount: 0,
    };
  }

  const document = await getAuthorizedDocument(auth.context, input.documentId);
  if (!document.success) {
    return {
      success: false,
      error: document.error,
      addedCount: 0,
      removedCount: 0,
      failedCount: 0,
    };
  }

  let addedCount = 0;
  let removedCount = 0;
  let failedCount = 0;

  for (const linkId of input.removeLinkIds ?? []) {
    const result = await unlinkDocument({ linkId });
    if (result.success) removedCount++;
    else failedCount++;
  }

  for (const jobId of input.addJobIds ?? []) {
    const result = await linkDocumentToJob({
      documentId: input.documentId,
      jobId,
    });
    if (result.success) addedCount++;
    else failedCount++;
  }

  for (const projectId of input.addProjectIds ?? []) {
    const result = await linkDocumentToProject({
      documentId: input.documentId,
      projectId,
    });
    if (result.success) addedCount++;
    else failedCount++;
  }

  for (const clientId of input.addClientIds ?? []) {
    const result = await linkDocumentToClient({
      documentId: input.documentId,
      clientId,
    });
    if (result.success) addedCount++;
    else failedCount++;
  }

  for (const employeeId of input.addEmployeeIds ?? []) {
    const result = await linkDocumentToEmployee({
      documentId: input.documentId,
      employeeId,
    });
    if (result.success) addedCount++;
    else failedCount++;
  }

  if (failedCount > 0) {
    return {
      success: false,
      error: addedCount > 0 || removedCount > 0 ? 'partial_update' : 'update_failed',
      addedCount,
      removedCount,
      failedCount,
    };
  }

  return { success: true, addedCount, removedCount };
}

export async function linkDocumentsToTarget(
  input: LinkDocumentsToTargetInput
): Promise<LinkDocumentsToTargetResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) {
    return { success: false, error: auth.error, linkedCount: 0, failedCount: 0 };
  }

  const targetCount = [
    input.jobId,
    input.projectId,
    input.clientId,
    input.employeeId,
  ].filter(Boolean).length;
  if (targetCount !== 1) {
    return {
      success: false,
      error: 'invalid_target',
      linkedCount: 0,
      failedCount: input.documentIds.length,
    };
  }

  if (input.documentIds.length === 0) {
    return { success: true, linkedCount: 0 };
  }

  let linkedCount = 0;
  let failedCount = 0;

  for (const documentId of input.documentIds) {
    const result = input.jobId
      ? await linkDocumentToJob({ documentId, jobId: input.jobId })
      : input.projectId
        ? await linkDocumentToProject({ documentId, projectId: input.projectId })
        : input.clientId
          ? await linkDocumentToClient({ documentId, clientId: input.clientId })
          : await linkDocumentToEmployee({
              documentId,
              employeeId: input.employeeId!,
            });

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

export async function getDocumentSignedUrl(
  documentId: string
): Promise<SignedDocumentUrlResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getAuthorizedDocument(auth.context, documentId);
  if (!existing.success) return existing;

  const { data, error } = await auth.context.admin.storage
    .from(DOCUMENT_STORAGE_BUCKET)
    .createSignedUrl(existing.document.storage_path, 60 * 10, {
      download: existing.document.display_name,
    });

  if (error || !data?.signedUrl) {
    console.error('Failed to create document signed URL:', error);
    return { success: false, error: 'signed_url_failed' };
  }

  return { success: true, signedUrl: data.signedUrl };
}

export async function getDocumentViewSignedUrl(
  documentId: string
): Promise<SignedDocumentUrlResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getAuthorizedDocument(auth.context, documentId);
  if (!existing.success) return existing;

  const { data, error } = await auth.context.admin.storage
    .from(DOCUMENT_STORAGE_BUCKET)
    .createSignedUrl(existing.document.storage_path, 60 * 10);

  if (error || !data?.signedUrl) {
    console.error('Failed to create document view signed URL:', error);
    return { success: false, error: 'signed_url_failed' };
  }

  return { success: true, signedUrl: data.signedUrl };
}

export async function getDocumentVersionSignedUrl(
  versionId: string,
  options: { download?: boolean } = {}
): Promise<SignedDocumentUrlResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const { data: version, error } = await auth.context.admin
    .from('document_versions')
    .select('*')
    .eq('id', versionId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();

  if (error || !version) {
    console.error('Failed to load document version:', error);
    return { success: false, error: 'version_not_found' };
  }

  const versionRow = version as DocumentVersionRow;
  const existing = await getAuthorizedDocument(auth.context, versionRow.document_id);
  if (!existing.success) return existing;

  const { data, error: signedUrlError } = await auth.context.admin.storage
    .from(DOCUMENT_STORAGE_BUCKET)
    .createSignedUrl(versionRow.storage_path, 60 * 10, {
      download: options.download ? versionRow.original_file_name : undefined,
    });

  if (signedUrlError || !data?.signedUrl) {
    console.error('Failed to create version signed URL:', signedUrlError);
    return { success: false, error: 'signed_url_failed' };
  }

  return { success: true, signedUrl: data.signedUrl };
}

export async function getDocumentDetails(
  documentId: string
): Promise<DocumentDetailsResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getAuthorizedDocument(auth.context, documentId);
  if (!existing.success) return existing;

  const [versionsResult, auditResult] = await Promise.all([
    auth.context.admin
      .from('document_versions')
      .select('*')
      .eq('document_id', existing.document.id)
      .eq('organization_id', auth.context.orgId)
      .order('version_number', { ascending: false }),
    auth.context.admin
      .from('document_audit_events')
      .select('*')
      .eq('document_id', existing.document.id)
      .eq('organization_id', auth.context.orgId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (versionsResult.error) {
    console.error('Failed to load document versions:', versionsResult.error);
    return { success: false, error: 'versions_failed' };
  }

  if (auditResult.error) {
    console.error('Failed to load document audit events:', auditResult.error);
    return { success: false, error: 'audit_failed' };
  }

  return {
    success: true,
    versions: await hydrateDocumentVersions(
      auth.context.admin,
      (versionsResult.data ?? []) as DocumentVersionRow[]
    ),
    auditEvents: await hydrateDocumentAuditEvents(
      auth.context.admin,
      (auditResult.data ?? []) as DocumentAuditEventRow[]
    ),
  };
}

export async function getDeletedDocuments(): Promise<DocumentListResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const { data, error } = await auth.context.admin
    .from('documents')
    .select('*')
    .eq('organization_id', auth.context.orgId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) {
    console.error('Failed to load deleted documents:', error);
    return { success: false, error: 'documents_failed' };
  }

  return {
    success: true,
    documents: await hydrateDocuments(auth.context.admin, (data ?? []) as DocumentRow[]),
  };
}

export async function restoreDocument(
  documentId: string
): Promise<DocumentMutationResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getDeletedDocumentForManager(auth.context, documentId);
  if (!existing.success) return existing;

  let restoreFolderId = existing.document.folder_id;
  if (restoreFolderId) {
    const folder = await getFolderById(
      auth.context.admin,
      auth.context.orgId,
      restoreFolderId
    );
    restoreFolderId = folder ? restoreFolderId : null;
  }

  const displayName = await getAvailableDisplayName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    folderId: restoreFolderId,
    preferredName: existing.document.display_name,
  });
  const restoredToRoot = Boolean(existing.document.folder_id && !restoreFolderId);

  const { error } = await auth.context.admin
    .from('documents')
    .update({
      folder_id: restoreFolderId,
      display_name: displayName,
      deleted_at: null,
      deleted_by: null,
      delete_reason: null,
    })
    .eq('id', existing.document.id)
    .eq('organization_id', auth.context.orgId);

  if (error) {
    console.error('Failed to restore document:', error);
    return { success: false, error: 'restore_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId: existing.document.id,
    folderId: restoreFolderId,
    eventType: 'restored',
    eventPayload: {
      deletedAt: existing.document.deleted_at,
      deletedBy: existing.document.deleted_by,
      deleteReason: existing.document.delete_reason,
      originalFolderId: existing.document.folder_id,
      restoredToRoot,
      displayNameChanged: displayName !== existing.document.display_name,
    },
  });

  revalidateDocuments(auth.context.orgId);
  return { success: true };
}

export async function permanentlyDeleteDocument(
  documentId: string
): Promise<DocumentMutationResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getDeletedDocumentForManager(auth.context, documentId);
  if (!existing.success) return existing;

  const { data: versions } = await auth.context.admin
    .from('document_versions')
    .select('storage_path')
    .eq('document_id', existing.document.id)
    .eq('organization_id', auth.context.orgId);

  const storagePaths = [
    existing.document.storage_path,
    ...((versions ?? []) as Pick<DocumentVersionRow, 'storage_path'>[]).map(
      (version) => version.storage_path
    ),
  ];

  const { error: storageError } = await auth.context.admin.storage
    .from(DOCUMENT_STORAGE_BUCKET)
    .remove(storagePaths);

  if (storageError) {
    console.error('Failed to permanently remove document storage:', storageError);
    return { success: false, error: 'storage_delete_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId: existing.document.id,
    folderId: existing.document.folder_id,
    eventType: 'permanently_deleted',
    eventPayload: {
      documentId: existing.document.id,
      displayName: existing.document.display_name,
      storagePaths,
    },
  });

  const { error } = await auth.context.admin
    .from('documents')
    .delete()
    .eq('id', existing.document.id)
    .eq('organization_id', auth.context.orgId);

  if (error) {
    console.error('Failed to permanently delete document metadata:', error);
    return { success: false, error: 'delete_failed' };
  }

  revalidateDocuments(auth.context.orgId);
  return { success: true };
}

export async function uploadDocumentVersion(
  input: UploadDocumentVersionInput
): Promise<VersionResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  const category = toDocumentCategory(existing.document.category);
  if (!['contract', 'invoice', 'offer', 'report'].includes(category)) {
    return { success: false, error: 'versioning_not_supported' };
  }

  const fileEntry = input.formData.get('file');
  if (!(fileEntry instanceof File)) {
    return { success: false, error: 'file_required' };
  }

  if (fileEntry.size <= 0) {
    return { success: false, error: 'file_empty' };
  }

  if (fileEntry.size > DOCUMENT_MAX_FILE_SIZE_BYTES) {
    return { success: false, error: 'file_too_large' };
  }

  const nextVersionNumber = existing.document.current_version_number + 1;
  const originalFileName = trimName(fileEntry.name) || 'Dokument';
  const storagePath = `${auth.context.orgId}/${existing.document.id}/versions/${nextVersionNumber}-${sanitizeStorageFileName(originalFileName)}`;
  const fileBuffer = Buffer.from(await fileEntry.arrayBuffer());
  const contentType = fileEntry.type || 'application/octet-stream';

  const { error: uploadError } = await auth.context.admin.storage
    .from(DOCUMENT_STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, {
      cacheControl: '3600',
      contentType,
      upsert: false,
    });

  if (uploadError) {
    console.error('Failed to upload document version storage object:', uploadError);
    return { success: false, error: 'upload_failed' };
  }

  const { data: archivedVersion, error: versionInsertError } = await auth.context.admin
    .from('document_versions')
    .insert({
      organization_id: auth.context.orgId,
      document_id: existing.document.id,
      version_number: existing.document.current_version_number,
      storage_bucket: DOCUMENT_STORAGE_BUCKET,
      storage_path: existing.document.storage_path,
      original_file_name: existing.document.original_file_name,
      mime_type: existing.document.mime_type,
      size_bytes: existing.document.size_bytes,
      uploaded_by: existing.document.uploaded_by,
    })
    .select('id')
    .single();

  if (versionInsertError) {
    await auth.context.admin.storage.from(DOCUMENT_STORAGE_BUCKET).remove([storagePath]);
    console.error('Failed to store previous document version:', versionInsertError);
    return { success: false, error: 'version_failed' };
  }

  const { data: updatedDocument, error: updateError } = await auth.context.admin
    .from('documents')
    .update({
      current_version_number: nextVersionNumber,
      storage_path: storagePath,
      original_file_name: originalFileName,
      mime_type: contentType,
      size_bytes: fileEntry.size,
      uploaded_by: auth.context.userId,
    })
    .eq('id', existing.document.id)
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null)
    .select('*')
    .single();

  if (updateError || !updatedDocument) {
    await auth.context.admin.storage.from(DOCUMENT_STORAGE_BUCKET).remove([storagePath]);
    if (archivedVersion?.id) {
      await auth.context.admin
        .from('document_versions')
        .delete()
        .eq('id', archivedVersion.id)
        .eq('organization_id', auth.context.orgId);
    }
    console.error('Failed to update document latest version:', updateError);
    return { success: false, error: 'version_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    documentId: existing.document.id,
    folderId: existing.document.folder_id,
    eventType: 'version_uploaded',
    eventPayload: {
      previousVersionNumber: existing.document.current_version_number,
      currentVersionNumber: nextVersionNumber,
      storagePath,
      originalFileName,
      mimeType: contentType,
      sizeBytes: fileEntry.size,
    },
  });

  const version: DocumentVersion = {
    id: 'latest',
    organizationId: auth.context.orgId,
    documentId: existing.document.id,
    versionNumber: nextVersionNumber,
    storageBucket: DOCUMENT_STORAGE_BUCKET,
    storagePath,
    originalFileName,
    mimeType: contentType,
    sizeBytes: fileEntry.size,
    uploadedBy: auth.context.userId,
    createdAt: (updatedDocument as DocumentRow).updated_at,
    uploader: null,
  };

  revalidateDocuments(auth.context.orgId);
  return { success: true, version };
}

type StorageObject = {
  id: string | null;
  name: string;
  metadata: unknown | null;
};

async function listStorageObjectPaths(
  admin: SupabaseAdmin,
  prefix: string
): Promise<string[]> {
  const paths: string[] = [];

  async function walk(path: string): Promise<void> {
    let offset = 0;
    const limit = 100;

    while (true) {
      const { data, error } = await admin.storage
        .from(DOCUMENT_STORAGE_BUCKET)
        .list(path, { limit, offset, sortBy: { column: 'name', order: 'asc' } });

      if (error) {
        throw error;
      }

      const objects = (data ?? []) as StorageObject[];
      for (const object of objects) {
        const objectPath = path ? `${path}/${object.name}` : object.name;
        if (object.id || object.metadata) {
          paths.push(objectPath);
        } else {
          await walk(objectPath);
        }
      }

      if (objects.length < limit) break;
      offset += limit;
    }
  }

  await walk(prefix);
  return paths;
}

export async function getDocumentStorageCleanupReport(): Promise<StorageCleanupReportResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  try {
    const [storagePaths, documentsResult, versionsResult] = await Promise.all([
      listStorageObjectPaths(auth.context.admin, auth.context.orgId),
      auth.context.admin
        .from('documents')
        .select('storage_path, deleted_at')
        .eq('organization_id', auth.context.orgId),
      auth.context.admin
        .from('document_versions')
        .select('storage_path')
        .eq('organization_id', auth.context.orgId),
    ]);

    if (documentsResult.error || versionsResult.error) {
      console.error('Failed to load cleanup metadata:', {
        documentsError: documentsResult.error,
        versionsError: versionsResult.error,
      });
      return { success: false, error: 'cleanup_report_failed' };
    }

    const documentRows = (documentsResult.data ?? []) as Pick<
      DocumentRow,
      'storage_path' | 'deleted_at'
    >[];
    const versionRows = (versionsResult.data ?? []) as Pick<
      DocumentVersionRow,
      'storage_path'
    >[];
    const referencedPaths = new Set([
      ...documentRows.map((document) => document.storage_path),
      ...versionRows.map((version) => version.storage_path),
    ]);
    const existingPaths = new Set(storagePaths);

    return {
      success: true,
      report: {
        orphanedStoragePaths: storagePaths.filter((path) => !referencedPaths.has(path)),
        missingStoragePaths: Array.from(referencedPaths).filter(
          (path) => !existingPaths.has(path)
        ),
        deletedDocumentStoragePaths: documentRows
          .filter((document) => document.deleted_at)
          .map((document) => document.storage_path),
      },
    };
  } catch (error) {
    console.error('Failed to build storage cleanup report:', error);
    return { success: false, error: 'cleanup_report_failed' };
  }
}

export async function deleteOrphanedStorageObjects(
  storagePaths: string[]
): Promise<DocumentMutationResult> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const report = await getDocumentStorageCleanupReport();
  if (!report.success) return report;

  const allowedPaths = new Set(report.report.orphanedStoragePaths);
  const safePaths = storagePaths.filter(
    (path) => path.startsWith(`${auth.context.orgId}/`) && allowedPaths.has(path)
  );

  if (safePaths.length === 0) {
    return { success: false, error: 'no_orphans_selected' };
  }

  const { error } = await auth.context.admin.storage
    .from(DOCUMENT_STORAGE_BUCKET)
    .remove(safePaths);

  if (error) {
    console.error('Failed to delete orphaned storage objects:', error);
    return { success: false, error: 'storage_delete_failed' };
  }

  await recordDocumentAuditEvent(auth.context, {
    eventType: 'storage_cleanup',
    eventPayload: { deletedStoragePaths: safePaths },
  });

  return { success: true };
}

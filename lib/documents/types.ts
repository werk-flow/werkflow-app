import type { ActionFailure, ActionResult } from '@/lib/action-result';
import type { ProfileReference } from '@/lib/profile-reference';
import type { Database, Json } from '@/lib/supabase/database.types';

export const DOCUMENT_STORAGE_BUCKET = 'organization-documents';
export const DOCUMENT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export const DOCUMENT_CATEGORIES = ['photo', 'contract', 'invoice', 'offer', 'report', 'other'] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  photo: 'Fotos',
  contract: 'Verträge',
  invoice: 'Rechnungen',
  offer: 'Angebote',
  report: 'Berichte',
  other: 'Sonstige',
};

export type DocumentFolderRow = Database['public']['Tables']['document_folders']['Row'];
export type DocumentRow = Database['public']['Tables']['documents']['Row'];
export type DocumentLinkRow = Database['public']['Tables']['document_links']['Row'];
export type DocumentAuditEventRow = Database['public']['Tables']['document_audit_events']['Row'];
export type DocumentVersionRow = Database['public']['Tables']['document_versions']['Row'];

export type DocumentUploader = ProfileReference;

/** What a document link records about an employee; no role or split name is read for it. */
export type DocumentEmployee = {
  userId: string;
  name: string;
  email: string | null;
};

export type DocumentContextTarget =
  | { kind: 'job'; jobId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'client'; clientId: string }
  | { kind: 'employee'; employeeId: string }
  | { kind: 'request'; requestId: string }
  | { kind: 'equipment'; equipmentId: string }
  | { kind: 'service_case'; serviceCaseId: string }
  | { kind: 'maintenance_coverage'; maintenanceCoverageId: string };

export type DocumentUploadTarget =
  | { kind: 'library'; folderId?: string | null }
  | (DocumentContextTarget & { folderId?: string | null });

export type DocumentFolder = {
  id: string;
  organizationId: string;
  parentFolderId: string | null;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  creator: DocumentUploader | null;
};

export type DocumentLink = {
  id: string;
  organizationId: string;
  documentId: string;
  jobId: string | null;
  projectId: string | null;
  clientId: string | null;
  employeeId: string | null;
  requestId: string | null;
  equipmentId: string | null;
  serviceCaseId: string | null;
  maintenanceCoverageId: string | null;
  jobTitle: string | null;
  jobNumber: string | null;
  projectName: string | null;
  projectNumber: string | null;
  clientName: string | null;
  employeeName: string | null;
  employeeEmail: string | null;
  requestNumber: string | null;
  requestSummary: string | null;
  equipmentNumber: string | null;
  equipmentName: string | null;
  serviceCaseNumber: string | null;
  serviceCaseSummary: string | null;
  maintenanceCoverageNumber: string | null;
  createdBy: string;
  createdAt: string;
};

export type OrganizationDocument = {
  id: string;
  organizationId: string;
  folderId: string | null;
  category: DocumentCategory;
  storageBucket: string;
  storagePath: string;
  originalFileName: string;
  displayName: string;
  mimeType: string | null;
  sizeBytes: number;
  uploadedBy: string;
  copiedFromDocumentId: string | null;
  currentVersionNumber: number;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
  metadata: Json;
  createdAt: string;
  updatedAt: string;
  uploader: DocumentUploader | null;
  links: DocumentLink[];
};

export const DOCUMENT_LIBRARY_VIEWS = [
  'all',
  'unorganized',
  'work',
  'jobs',
  'projects',
  'clients',
  'employees',
  'folders',
  'photos',
  'contracts',
  'invoices',
  'offers',
  'reports',
  'other',
  'trash',
] as const;

export type DocumentLibraryView = (typeof DOCUMENT_LIBRARY_VIEWS)[number];

export const DOCUMENT_LIBRARY_LINK_FILTERS = [
  'all',
  'unlinked',
  'jobs',
  'projects',
  'clients',
  'employees',
] as const;

export type DocumentLibraryLinkFilter = (typeof DOCUMENT_LIBRARY_LINK_FILTERS)[number];

export type DocumentLibraryCategoryFilter = DocumentCategory | 'all';

export const DOCUMENT_LIBRARY_SORTS = [
  'name',
  'created_at',
  'updated_at',
  'size_bytes',
  'type',
  'category',
] as const;

export type DocumentLibrarySort = (typeof DOCUMENT_LIBRARY_SORTS)[number];

export type DocumentLibraryResult = ActionResult<{
  page: number;
  total: number;
  folderPage: number;
  folderTotal: number;
  breadcrumbs: DocumentFolder[];
  folders: DocumentFolder[];
  documents: OrganizationDocument[];
}>;

export type DocumentListResult = ActionResult<{ documents: OrganizationDocument[] }>;

export type DocumentMutationResult = ActionResult;

export type UpdateDocumentLinksInput = {
  documentId: string;
  addJobIds?: string[];
  addProjectIds?: string[];
  addClientIds?: string[];
  addEmployeeIds?: string[];
  addEquipmentIds?: string[];
  addServiceCaseIds?: string[];
  addMaintenanceCoverageIds?: string[];
  removeLinkIds?: string[];
};

/** All or nothing: a failure changed no link. */
export type UpdateDocumentLinksResult = ActionResult<{ addedCount: number; removedCount: number }>;

export type LinkDocumentsToTargetInput = {
  documentIds: string[];
  jobId?: string;
  projectId?: string;
  clientId?: string;
  employeeId?: string;
  equipmentId?: string;
  serviceCaseId?: string;
  maintenanceCoverageId?: string;
};

export type LinkDocumentsToTargetResult =
  | { success: true; linkedCount: number }
  | (ActionFailure & { linkedCount: number; failedCount: number });

export type ProjectJobDocumentGroup = {
  jobId: string;
  jobNumber: string | null;
  jobTitle: string;
  documents: OrganizationDocument[];
};

export type ProjectDocumentsOverviewResult = ActionResult<{
  projectDocuments: OrganizationDocument[];
  jobDocumentGroups: ProjectJobDocumentGroup[];
}>;

export type DocumentResult = ActionResult<{ document: OrganizationDocument }>;

export type FolderResult = ActionResult<{ folder: DocumentFolder }>;

export type SignedDocumentUrlResult = ActionResult<{ signedUrl: string }>;

type DocumentUploadTicket = {
  documentId: string;
  storagePath: string;
  uploadUrl: string;
};

export type DocumentUploadTicketResult = ActionResult<{ ticket: DocumentUploadTicket }>;

type DocumentVersionUploadTicket = {
  documentId: string;
  versionNumber: number;
  storagePath: string;
  uploadUrl: string;
};

export type DocumentVersionUploadTicketResult = ActionResult<{ ticket: DocumentVersionUploadTicket }>;

export type DocumentAuditEvent = {
  id: string;
  organizationId: string;
  documentId: string | null;
  folderId: string | null;
  actorId: string | null;
  eventType: string;
  eventPayload: Json;
  createdAt: string;
  actor: DocumentUploader | null;
};

export type DocumentVersion = {
  id: string;
  organizationId: string;
  documentId: string;
  versionNumber: number;
  storageBucket: string;
  storagePath: string;
  originalFileName: string;
  mimeType: string | null;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  uploader: DocumentUploader | null;
};

export type DocumentDetailsResult =
  | {
      success: true;
      document: OrganizationDocument;
      auditEvents: DocumentAuditEvent[];
      versions: DocumentVersion[];
    }
  | (ActionFailure & { document?: OrganizationDocument });

export type VersionResult = ActionResult<{ version: DocumentVersion }>;

export function toDocumentFolder(
  row: DocumentFolderRow,
  creator: DocumentUploader | null = null,
): DocumentFolder {
  return {
    id: row.id,
    organizationId: row.organization_id,
    parentFolderId: row.parent_folder_id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    creator,
  };
}

export function toDocumentLink(
  row: DocumentLinkRow,
  context?: {
    jobTitle?: string | null;
    jobNumber?: string | null;
    projectName?: string | null;
    projectNumber?: string | null;
    clientName?: string | null;
    employeeName?: string | null;
    employeeEmail?: string | null;
    requestNumber?: string | null;
    requestSummary?: string | null;
    equipmentNumber?: string | null;
    equipmentName?: string | null;
    serviceCaseNumber?: string | null;
    serviceCaseSummary?: string | null;
    maintenanceCoverageNumber?: string | null;
  },
): DocumentLink {
  return {
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    jobId: row.job_id,
    projectId: row.project_id,
    clientId: row.client_id,
    employeeId: row.employee_id,
    requestId: row.request_id,
    equipmentId: row.equipment_id,
    serviceCaseId: row.service_case_id,
    maintenanceCoverageId: row.maintenance_coverage_id,
    jobTitle: context?.jobTitle ?? null,
    jobNumber: context?.jobNumber ?? null,
    projectName: context?.projectName ?? null,
    projectNumber: context?.projectNumber ?? null,
    clientName: context?.clientName ?? null,
    employeeName: context?.employeeName ?? null,
    employeeEmail: context?.employeeEmail ?? null,
    requestNumber: context?.requestNumber ?? null,
    requestSummary: context?.requestSummary ?? null,
    equipmentNumber: context?.equipmentNumber ?? null,
    equipmentName: context?.equipmentName ?? null,
    serviceCaseNumber: context?.serviceCaseNumber ?? null,
    serviceCaseSummary: context?.serviceCaseSummary ?? null,
    maintenanceCoverageNumber: context?.maintenanceCoverageNumber ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function toDocumentCategory(value: string | null | undefined): DocumentCategory {
  return DOCUMENT_CATEGORIES.includes(value as DocumentCategory) ? (value as DocumentCategory) : 'other';
}

export function toOrganizationDocument({
  row,
  uploader,
  links,
}: {
  row: DocumentRow;
  uploader: DocumentUploader | null;
  links: DocumentLink[];
}): OrganizationDocument {
  return {
    id: row.id,
    organizationId: row.organization_id,
    folderId: row.folder_id,
    category: toDocumentCategory(row.category),
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    originalFileName: row.original_file_name,
    displayName: row.display_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedBy: row.uploaded_by,
    copiedFromDocumentId: row.copied_from_document_id,
    currentVersionNumber: row.current_version_number,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    uploader,
    links,
  };
}

export function toDocumentAuditEvent({
  row,
  actor,
}: {
  row: DocumentAuditEventRow;
  actor: DocumentUploader | null;
}): DocumentAuditEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    folderId: row.folder_id,
    actorId: row.actor_id,
    eventType: row.event_type,
    eventPayload: row.event_payload,
    createdAt: row.created_at,
    actor,
  };
}

export function toDocumentVersion({
  row,
  uploader,
}: {
  row: DocumentVersionRow;
  uploader: DocumentUploader | null;
}): DocumentVersion {
  return {
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    uploader,
  };
}

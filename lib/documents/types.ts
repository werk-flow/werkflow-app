import type { Database, Json } from '@/lib/supabase/database.types';

export const DOCUMENT_STORAGE_BUCKET = 'organization-documents';
export const DOCUMENT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export const DOCUMENT_CATEGORIES = [
  'photo',
  'contract',
  'invoice',
  'offer',
  'report',
  'other',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  photo: 'Fotos',
  contract: 'Verträge',
  invoice: 'Rechnungen',
  offer: 'Angebote',
  report: 'Berichte',
  other: 'Sonstige',
};

export type DocumentFolderRow =
  Database['public']['Tables']['document_folders']['Row'];
export type DocumentRow = Database['public']['Tables']['documents']['Row'];
export type DocumentLinkRow =
  Database['public']['Tables']['document_links']['Row'];
export type DocumentAuditEventRow =
  Database['public']['Tables']['document_audit_events']['Row'];
export type DocumentVersionRow =
  Database['public']['Tables']['document_versions']['Row'];

export type DocumentUploader = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatarPath: string | null;
};

export type DocumentEmployee = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string;
};

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
  jobTitle: string | null;
  jobNumber: string | null;
  projectName: string | null;
  projectNumber: string | null;
  clientName: string | null;
  employeeName: string | null;
  employeeEmail: string | null;
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

export type DocumentLibraryView =
  | 'all'
  | 'unorganized'
  | 'work'
  | 'jobs'
  | 'projects'
  | 'clients'
  | 'employees'
  | 'folders'
  | 'photos'
  | 'contracts'
  | 'invoices'
  | 'offers'
  | 'reports'
  | 'other'
  | 'trash';

export type DocumentLibraryLinkFilter =
  | 'all'
  | 'unlinked'
  | 'jobs'
  | 'projects'
  | 'clients'
  | 'employees';

export type DocumentLibraryCategoryFilter = DocumentCategory | 'all';

export type DocumentLibrarySort =
  | 'name'
  | 'created_at'
  | 'updated_at'
  | 'size_bytes'
  | 'type'
  | 'category';

export type DocumentLibraryResult =
  | {
      success: true;
      breadcrumbs: DocumentFolder[];
      folders: DocumentFolder[];
      documents: OrganizationDocument[];
    }
  | { success: false; error: string };

export type DocumentListResult =
  | { success: true; documents: OrganizationDocument[] }
  | { success: false; error: string };

export type DocumentMutationResult =
  | { success: true }
  | { success: false; error: string };

export type UpdateDocumentLinksInput = {
  documentId: string;
  addJobIds?: string[];
  addProjectIds?: string[];
  addClientIds?: string[];
  addEmployeeIds?: string[];
  removeLinkIds?: string[];
};

export type UpdateDocumentLinksResult =
  | {
      success: true;
      addedCount: number;
      removedCount: number;
    }
  | {
      success: false;
      error: string;
      addedCount: number;
      removedCount: number;
      failedCount: number;
    };

export type LinkDocumentsToTargetInput = {
  documentIds: string[];
  jobId?: string;
  projectId?: string;
  clientId?: string;
  employeeId?: string;
};

export type LinkDocumentsToTargetResult =
  | { success: true; linkedCount: number }
  | {
      success: false;
      error: string;
      linkedCount: number;
      failedCount: number;
    };

export type ProjectJobDocumentGroup = {
  jobId: string;
  jobNumber: string | null;
  jobTitle: string;
  documents: OrganizationDocument[];
};

export type ProjectDocumentsOverviewResult =
  | {
      success: true;
      projectDocuments: OrganizationDocument[];
      jobDocumentGroups: ProjectJobDocumentGroup[];
    }
  | { success: false; error: string };

export type DocumentResult =
  | { success: true; document: OrganizationDocument }
  | { success: false; error: string };

export type FolderResult =
  | { success: true; folder: DocumentFolder }
  | { success: false; error: string };

export type SignedDocumentUrlResult =
  | { success: true; signedUrl: string }
  | { success: false; error: string };

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
      auditEvents: DocumentAuditEvent[];
      versions: DocumentVersion[];
    }
  | { success: false; error: string };

export type VersionResult =
  | { success: true; version: DocumentVersion }
  | { success: false; error: string };

export type StorageCleanupReport = {
  orphanedStoragePaths: string[];
  missingStoragePaths: string[];
  deletedDocumentStoragePaths: string[];
};

export type StorageCleanupReportResult =
  | { success: true; report: StorageCleanupReport }
  | { success: false; error: string };

export function toDocumentFolder(
  row: DocumentFolderRow,
  creator: DocumentUploader | null = null
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
  }
): DocumentLink {
  return {
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    jobId: row.job_id,
    projectId: row.project_id,
    clientId: row.client_id,
    employeeId: row.employee_id,
    jobTitle: context?.jobTitle ?? null,
    jobNumber: context?.jobNumber ?? null,
    projectName: context?.projectName ?? null,
    projectNumber: context?.projectNumber ?? null,
    clientName: context?.clientName ?? null,
    employeeName: context?.employeeName ?? null,
    employeeEmail: context?.employeeEmail ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function toDocumentCategory(value: string | null | undefined): DocumentCategory {
  return DOCUMENT_CATEGORIES.includes(value as DocumentCategory)
    ? (value as DocumentCategory)
    : 'other';
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

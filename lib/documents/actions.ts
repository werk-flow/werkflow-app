'use server';

import type { ActionResult } from '@/lib/action-result';
import type { Job } from '@/lib/jobs/types';
import { logError } from '@/lib/logging';
import { getOrgMembersForUser } from '@/lib/members/queries';
import { createSignedDownloadUrl, discardStorageObjects } from '@/lib/storage/r2';
import { uuidSchema } from '@/lib/validation/uuid';
import {
  ensureClientManagerAccess,
  ensureEmployeeManagerAccess,
  ensureEquipmentManagerAccess,
  ensureJobAccess,
  ensureMaintenanceCoverageManagerAccess,
  ensureProjectManagerAccess,
  ensureProjectWorkAccess,
  ensureRequestManagerAccess,
  ensureServiceCaseManagerAccess,
  getAuthorizedDocument,
  getAuthorizedDocumentContext,
  getDeletedDocumentForManager,
  requireManager,
} from './access';
import {
  attachableDocumentsInputSchema,
  INVALID_INPUT,
  linkDocumentsToTargetInputSchema,
  parseActionInput,
  projectOverviewJobsSchema,
  signedUrlOptionsSchema,
  unlinkDocumentInputSchema,
  updateDocumentLinksInputSchema,
  type AttachableDocumentsInput,
  type UnlinkDocumentInput,
} from './action-schemas';
import {
  documentRowsFromOrdinaryView,
  hydrateDocumentAuditEvents,
  hydrateDocuments,
  hydrateDocumentsOrNull,
  hydrateDocumentVersions,
} from './hydration';
import { linkDocumentToTarget, singleLinkTarget, writeDocumentLinks, type DocumentLinkTarget } from './links';
import { applyDocumentSearch, readLinkedDocuments, type DocumentLinkColumn } from './reads';
import type {
  DocumentDetailsResult,
  DocumentEmployee,
  DocumentListResult,
  DocumentMutationResult,
  LinkDocumentsToTargetInput,
  LinkDocumentsToTargetResult,
  ProjectDocumentsOverviewResult,
  SignedDocumentUrlResult,
  UpdateDocumentLinksInput,
  UpdateDocumentLinksResult,
} from './types';
import { documentWriteFailure, revalidateDocuments } from './write-support';

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
  const rows = documentRowsFromOrdinaryView(data ?? []);
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

  const result = await writeDocumentLinks(auth.context, link.document_id, {
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

  const versionRow = version;
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
    hydrateDocumentVersions(auth.context.admin, versionsResult.data),
    hydrateDocumentAuditEvents(auth.context.admin, auditResult.data),
  ]);
  if (!versions) return { success: false, error: 'versions_failed', document };
  if (!auditEvents) return { success: false, error: 'audit_failed', document };
  return { success: true, document, versions, auditEvents };
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

  // The row is gone, so a storage failure leaves only an orphaned object, which discardStorageObjects logs.
  await discardStorageObjects({ organizationId: auth.context.orgId, paths: storagePaths });

  revalidateDocuments();
  return { success: true };
}

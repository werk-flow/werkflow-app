import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure, loggedRead } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { readJobAssignmentOfUser, readOrganizationJob } from '@/lib/jobs/job-access-reads';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { ParsedDocumentUploadTarget } from './action-schemas';
import { earlyDeletionRefusal } from './retention';
import { toDocumentCategory, type DocumentFolderRow, type DocumentLinkRow, type DocumentRow } from './types';

// The authorization layer of the document Server Actions: the caller's
// context, the per-target access checks and the per-document check that also
// guards protected personnel files. Postgres RLS is the second layer
// (docs/technical/document-storage-and-access.md).

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export type AuthorizedDocumentContext = {
  admin: SupabaseAdmin;
  orgId: string;
  userId: string;
  role: 'admin' | 'buero' | 'employee';
  isManagerOrAbove: boolean;
};

type ProtectedDocumentAccess = {
  personnelDocumentId: string;
  releasedVersionNumbers: number[] | null;
  /** The caller manages the file by role; a release alone lets them read it, never change it. */
  managedByCaller: boolean;
};

type AuthorizedDocument = ActionResult<{
  document: DocumentRow;
  protectedAccess: ProtectedDocumentAccess | null;
}>;

export async function getAuthorizedDocumentContext(): Promise<
  ActionResult<{ context: AuthorizedDocumentContext }>
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;

  return {
    success: true,
    context: {
      admin: createSupabaseAdminClient(),
      orgId: auth.context.orgId,
      userId: auth.context.userId,
      role: auth.context.role,
      isManagerOrAbove: auth.context.isManagerOrAbove,
    },
  };
}

export function requireManager(context: AuthorizedDocumentContext): ActionResult {
  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  return { success: true };
}

export async function getFolderById(
  admin: SupabaseAdmin,
  orgId: string,
  folderId: string,
): Promise<ActionResult<{ folder: DocumentFolderRow }>> {
  const { data, error } = await loggedRead(
    'getFolderById: document_folders read failed',
    admin
      .from('document_folders')
      .select('*')
      .eq('id', folderId)
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .maybeSingle(),
  );

  if (error) return { success: false, error: 'load_failed' };
  if (!data) return { success: false, error: 'folder_not_found' };
  return { success: true, folder: data };
}

export async function ensureFolder(
  admin: SupabaseAdmin,
  orgId: string,
  folderId: string | null | undefined,
): Promise<ActionResult> {
  if (!folderId) return { success: true };

  const folder = await getFolderById(admin, orgId, folderId);
  if (!folder.success) return folder;

  return { success: true };
}

export async function ensureJobAccess(
  context: AuthorizedDocumentContext,
  jobId: string,
): Promise<ActionResult> {
  const { data: job, error: jobError } = await readOrganizationJob(context.orgId, jobId);
  if (jobError) return { success: false, error: 'load_failed' };

  if (!job) {
    return { success: false, error: 'job_not_found' };
  }

  if (context.isManagerOrAbove) {
    return { success: true };
  }

  const { data: assignment, error: assignmentError } = await readJobAssignmentOfUser(
    context.orgId,
    jobId,
    context.userId,
  );
  if (assignmentError) return { success: false, error: 'load_failed' };

  if (!assignment) {
    return { success: false, error: 'not_authorized' };
  }

  return { success: true };
}

export async function ensureProjectManagerAccess(
  context: AuthorizedDocumentContext,
  projectId: string,
): Promise<ActionResult> {
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const { data: project, error: projectError } = await loggedRead(
    'ensureProjectManagerAccess: projects read failed',
    context.admin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (projectError) return { success: false, error: 'load_failed' };

  if (!project) {
    return { success: false, error: 'project_not_found' };
  }

  return { success: true };
}

/**
 * Managers reach every project of the organization. An employee reaches a
 * project through an assignment to one of its jobs, the same rule as the
 * project page itself. This grants reads only; every project-level write
 * requires a manager.
 */
export async function ensureProjectWorkAccess(
  context: AuthorizedDocumentContext,
  projectId: string,
): Promise<ActionResult> {
  if (context.isManagerOrAbove) {
    return ensureProjectManagerAccess(context, projectId);
  }
  const { data: assignedJob, error: assignedJobError } = await loggedRead(
    'ensureProjectWorkAccess: jobs read failed',
    context.admin
      .from('jobs')
      .select('job_assignments!inner(id)')
      .eq('organization_id', context.orgId)
      .eq('project_id', projectId)
      .eq('job_assignments.user_id', context.userId)
      .limit(1)
      .maybeSingle(),
  );
  if (assignedJobError) return { success: false, error: 'load_failed' };
  return assignedJob ? { success: true } : { success: false, error: 'not_authorized' };
}

export async function ensureClientManagerAccess(
  context: AuthorizedDocumentContext,
  clientId: string,
): Promise<ActionResult> {
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const { data: client, error: clientError } = await loggedRead(
    'ensureClientManagerAccess: clients read failed',
    context.admin
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (clientError) return { success: false, error: 'load_failed' };

  if (!client) {
    return { success: false, error: 'client_not_found' };
  }

  return { success: true };
}

export async function ensureEquipmentManagerAccess(
  context: AuthorizedDocumentContext,
  equipmentId: string,
): Promise<ActionResult> {
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const { data: equipment, error: equipmentError } = await loggedRead(
    'ensureEquipmentManagerAccess: installed_equipment read failed',
    context.admin
      .from('installed_equipment')
      .select('id')
      .eq('id', equipmentId)
      .eq('organization_id', context.orgId)
      .is('voided_at', null)
      .maybeSingle(),
  );
  if (equipmentError) return { success: false, error: 'load_failed' };

  return equipment ? { success: true } : { success: false, error: 'installed_equipment_not_found' };
}

export async function ensureServiceCaseManagerAccess(
  context: AuthorizedDocumentContext,
  serviceCaseId: string,
): Promise<ActionResult> {
  const manager = requireManager(context);
  if (!manager.success) return manager;
  const { data: serviceCase, error: serviceCaseError } = await loggedRead(
    'ensureServiceCaseManagerAccess: service_cases read failed',
    context.admin
      .from('service_cases')
      .select('id')
      .eq('id', serviceCaseId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (serviceCaseError) return { success: false, error: 'load_failed' };
  return serviceCase ? { success: true } : { success: false, error: 'service_case_not_found' };
}

export async function ensureMaintenanceCoverageManagerAccess(
  context: AuthorizedDocumentContext,
  maintenanceCoverageId: string,
): Promise<ActionResult> {
  const manager = requireManager(context);
  if (!manager.success) return manager;
  const { data: coverage, error: coverageError } = await loggedRead(
    'ensureMaintenanceCoverageManagerAccess: maintenance_coverages read failed',
    context.admin
      .from('maintenance_coverages')
      .select('id')
      .eq('id', maintenanceCoverageId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (coverageError) return { success: false, error: 'load_failed' };
  return coverage ? { success: true } : { success: false, error: 'maintenance_coverage_not_found' };
}

// Requests (Anfragen) are a manager-only surface; attachments follow suit.
export async function ensureRequestManagerAccess(
  context: AuthorizedDocumentContext,
  requestId: string,
): Promise<ActionResult> {
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const { data: request, error: requestError } = await loggedRead(
    'ensureRequestManagerAccess: client_requests read failed',
    context.admin
      .from('client_requests')
      .select('id')
      .eq('id', requestId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (requestError) return { success: false, error: 'load_failed' };

  if (!request) {
    return { success: false, error: 'request_not_found' };
  }

  return { success: true };
}

export async function ensureEmployeeManagerAccess(
  context: AuthorizedDocumentContext,
  employeeId: string,
): Promise<ActionResult> {
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const { data: membership, error: membershipError } = await loggedRead(
    'ensureEmployeeManagerAccess: organization_members read failed',
    context.admin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', context.orgId)
      .eq('user_id', employeeId)
      .maybeSingle(),
  );
  if (membershipError) return { success: false, error: 'load_failed' };

  if (!membership) {
    return { success: false, error: 'employee_not_found' };
  }

  return { success: true };
}

type Tables = Database['public']['Tables'];

/** The protection record of a personnel document with the versions released to its employee. */
type ProtectedDocumentRecord = Pick<
  Tables['personnel_documents']['Row'],
  'id' | 'access_class' | 'employee_record_id'
> & {
  personnel_document_releases: Array<
    Pick<Tables['personnel_document_releases']['Row'], 'document_version_number' | 'revoked_at'>
  >;
};

/**
 * Who reaches a protected personnel document: an Admin always, the office for
 * a standard file, and otherwise only its own employee, for a released version.
 */
async function authorizeProtectedDocument(
  context: AuthorizedDocumentContext,
  row: DocumentRow,
  protectedDocument: ProtectedDocumentRecord,
  options: { protectedVersionNumber?: number },
): Promise<AuthorizedDocument> {
  if (context.role === 'admin') {
    return {
      success: true,
      document: row,
      protectedAccess: {
        personnelDocumentId: protectedDocument.id,
        releasedVersionNumbers: null,
        managedByCaller: true,
      },
    };
  }
  if (context.role === 'buero' && protectedDocument.access_class === 'personnel_standard') {
    return {
      success: true,
      document: row,
      protectedAccess: {
        personnelDocumentId: protectedDocument.id,
        releasedVersionNumbers: null,
        managedByCaller: true,
      },
    };
  }
  const { data: employee, error: employeeError } = await loggedRead(
    'getAuthorizedDocument: employee_records read failed',
    context.admin
      .from('employee_records')
      .select('user_id')
      .eq('id', protectedDocument.employee_record_id)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (employeeError) return { success: false, error: 'load_failed' };
  const releases = protectedDocument.personnel_document_releases;
  const releasedVersionNumbers = releases
    .filter((release) => release.revoked_at === null)
    .map((release) => release.document_version_number);
  if (
    employee?.user_id !== context.userId ||
    !releasedVersionNumbers.includes(options.protectedVersionNumber ?? row.current_version_number)
  ) {
    return { success: false, error: 'not_authorized' };
  }
  return {
    success: true,
    document: row,
    protectedAccess: {
      personnelDocumentId: protectedDocument.id,
      releasedVersionNumbers,
      managedByCaller: false,
    },
  };
}

type LinkedWork = Pick<DocumentLinkRow, 'job_id' | 'project_id'> & { client_id?: string | null };

/**
 * The caller's assigned jobs that the links name: as the job itself, as its
 * project or as its customer. A job counts only through the caller's own
 * assignment, the rule of the job and project pages.
 */
async function readAssignedLinkedJobs(context: AuthorizedDocumentContext, links: LinkedWork[]) {
  const linkedIds = (column: 'job_id' | 'project_id' | 'client_id') =>
    links.flatMap((link) => {
      const id = link[column];
      return id ? [id] : [];
    });
  // A batch of linked projects or customers can hold more assigned jobs than one response returns.
  const assignedJobsWhere = (column: 'id' | 'project_id' | 'client_id', ids: string[]) =>
    readInBatches(ids, (batch) =>
      readCompleteRows(
        (from, to) =>
          context.admin
            .from('jobs')
            .select('id, project_id, client_id, job_assignments!inner(id)')
            .eq('organization_id', context.orgId)
            .in(column, [...batch])
            .eq('job_assignments.user_id', context.userId)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    );
  const results = await Promise.all([
    assignedJobsWhere('id', linkedIds('job_id')),
    assignedJobsWhere('project_id', linkedIds('project_id')),
    assignedJobsWhere('client_id', linkedIds('client_id')),
  ]);
  return {
    jobs: results.flatMap((result) => result.data),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

/**
 * The links a caller sees on a document they may read. Managers see every
 * link. A field worker sees a link to an assigned job, to that job's project
 * or customer, or to themselves, as their own job views show them; any other
 * link is left out, so no title, name or summary of a record they cannot open
 * reaches them. Throws when the assignments cannot be read.
 */
export async function readableDocumentLinks(
  context: AuthorizedDocumentContext,
  links: DocumentLinkRow[],
): Promise<DocumentLinkRow[]> {
  if (context.isManagerOrAbove) return links;
  const assigned = await readAssignedLinkedJobs(context, links);
  if (assigned.error) {
    logReadFailure('readableDocumentLinks: assignment read failed', assigned.error);
    throw new Error('Dokumentverknüpfungen konnten nicht geladen werden.');
  }
  const ids = (column: 'id' | 'project_id' | 'client_id') =>
    new Set(assigned.jobs.flatMap((job) => (job[column] ? [job[column]] : [])));
  const [jobIds, projectIds, clientIds] = [ids('id'), ids('project_id'), ids('client_id')];
  return links.filter(
    (link) =>
      (link.job_id !== null && jobIds.has(link.job_id)) ||
      (link.project_id !== null && projectIds.has(link.project_id)) ||
      (link.client_id !== null && clientIds.has(link.client_id)) ||
      link.employee_id === context.userId,
  );
}

export async function getAuthorizedDocument(
  context: AuthorizedDocumentContext,
  documentId: string,
  options: { protectedVersionNumber?: number } = {},
): Promise<AuthorizedDocument> {
  const { data: document, error: documentError } = await loggedRead(
    'getAuthorizedDocument: documents read failed',
    context.admin
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('organization_id', context.orgId)
      .is('deleted_at', null)
      .maybeSingle(),
  );
  if (documentError) return { success: false, error: 'load_failed' };

  if (!document) {
    return { success: false, error: 'document_not_found' };
  }

  const row = document;
  const { data: protectedDocument, error: protectedError } = await loggedRead(
    'getAuthorizedDocument: personnel_documents read failed',
    context.admin
      .from('personnel_documents')
      .select(
        'id, access_class, employee_record_id, personnel_document_releases(document_version_number, revoked_at)',
      )
      .eq('organization_id', context.orgId)
      .eq('document_id', row.id)
      .maybeSingle(),
  );
  // Fail closed: an unknown protection state would open a personnel document to every manager.
  if (protectedError) return { success: false, error: 'load_failed' };
  if (protectedDocument) {
    return authorizeProtectedDocument(context, row, protectedDocument, options);
  }
  if (context.isManagerOrAbove) {
    return { success: true, document: row, protectedAccess: null };
  }

  const { data: links, error: linksError } = await context.admin
    .from('document_links')
    .select('job_id, project_id')
    .eq('document_id', row.id)
    .eq('organization_id', context.orgId);

  const assigned = await readAssignedLinkedJobs(context, links ?? []);
  const accessError = linksError ?? assigned.error;
  if (accessError) {
    logReadFailure('getAuthorizedDocument: assignment access check failed', accessError);
    return { success: false, error: 'load_failed' };
  }

  // Only job and project links are read here: a customer link alone grants nothing.
  if (assigned.jobs.length === 0) {
    return { success: false, error: 'not_authorized' };
  }

  return { success: true, document: row, protectedAccess: null };
}

/**
 * The active document a write may change: any document of the organization
 * for a manager, except a protected personnel document the caller reads only
 * through its release. Every document write action authorizes through this.
 */
export async function getManageableDocument(
  context: AuthorizedDocumentContext,
  documentId: string,
): Promise<ActionResult<{ document: DocumentRow }>> {
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(context, documentId);
  if (!existing.success) return existing;
  if (existing.protectedAccess && !existing.protectedAccess.managedByCaller) {
    return { success: false, error: 'not_authorized' };
  }

  return { success: true, document: existing.document };
}

/**
 * The active document whose version and audit history the caller reads: an
 * ordinary document only for a manager, a protected personnel document under
 * its own rule. A job assignment opens the current version, never the history.
 */
export async function getDocumentWithHistory(
  context: AuthorizedDocumentContext,
  documentId: string,
  options: { protectedVersionNumber?: number } = {},
): Promise<AuthorizedDocument> {
  const existing = await getAuthorizedDocument(context, documentId, options);
  if (!existing.success || existing.protectedAccess) return existing;
  const manager = requireManager(context);
  if (!manager.success) return manager;
  return existing;
}

export async function getDeletedDocumentForManager(
  context: AuthorizedDocumentContext,
  documentId: string,
): Promise<ActionResult<{ document: DocumentRow }>> {
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const { data: document, error: documentError } = await loggedRead(
    'getDeletedDocumentForManager: documents read failed',
    context.admin
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('organization_id', context.orgId)
      .not('deleted_at', 'is', null)
      .maybeSingle(),
  );
  if (documentError) return { success: false, error: 'load_failed' };

  if (!document) {
    return { success: false, error: 'document_not_found' };
  }

  // An Admin-only personnel document comes back only through an Admin, as restore_document refuses.
  if (context.role !== 'admin') {
    const { data: protectedDocument, error: protectedError } = await loggedRead(
      'getDeletedDocumentForManager: personnel_documents read failed',
      context.admin
        .from('personnel_documents')
        .select('access_class')
        .eq('organization_id', context.orgId)
        .eq('document_id', document.id)
        .maybeSingle(),
    );
    if (protectedError) return { success: false, error: 'load_failed' };
    if (protectedDocument && protectedDocument.access_class !== 'personnel_standard') {
      return { success: false, error: 'not_authorized' };
    }
  }

  return { success: true, document };
}

/**
 * A filed document keeps its bytes and never reaches the trash. The trigger
 * documents_retention_guard repeats this under every write.
 */
export function refuseFiledDocument(document: DocumentRow): ActionResult {
  return document.filed_at ? { success: false, error: 'document_filed' } : { success: true };
}

/**
 * Permanent deletion never takes a filed document, nor one whose retention
 * end is today or later (Berlin). The trigger documents_retention_guard
 * repeats this.
 */
export function refuseEarlyDeletion(document: DocumentRow): ActionResult {
  const refusal = earlyDeletionRefusal({
    filedAt: document.filed_at,
    retentionEndsOn: document.retention_ends_on,
  });
  return refusal ? { success: false, error: refusal } : { success: true };
}

/** A new version takes neither a filed document nor a category without versions. */
export function refuseNewVersion(document: DocumentRow): ActionResult {
  const filed = refuseFiledDocument(document);
  if (!filed.success) return filed;

  const category = toDocumentCategory(document.category);
  if (!['contract', 'invoice', 'offer', 'report'].includes(category)) {
    return { success: false, error: 'versioning_not_supported' };
  }

  return { success: true };
}

export async function getVersionableDocument(
  context: AuthorizedDocumentContext,
  documentId: string,
): Promise<ActionResult<{ document: DocumentRow }>> {
  const existing = await getManageableDocument(context, documentId);
  if (!existing.success) return existing;
  const versionable = refuseNewVersion(existing.document);
  return versionable.success ? existing : versionable;
}

export type NormalizedUploadTarget = {
  folderId: string | null;
  jobId: string | null;
  projectId: string | null;
  clientId: string | null;
  employeeId: string | null;
  requestId: string | null;
  equipmentId: string | null;
  serviceCaseId: string | null;
  maintenanceCoverageId: string | null;
};

export function normalizeUploadTarget(input: ParsedDocumentUploadTarget): NormalizedUploadTarget {
  const normalized: NormalizedUploadTarget = {
    folderId: (input.folderId ?? '').trim() || null,
    jobId: null,
    projectId: null,
    clientId: null,
    employeeId: null,
    requestId: null,
    equipmentId: null,
    serviceCaseId: null,
    maintenanceCoverageId: null,
  };

  switch (input.kind) {
    case 'library':
      return normalized;
    case 'job':
      return { ...normalized, jobId: input.jobId.trim() || null };
    case 'project':
      return { ...normalized, projectId: input.projectId.trim() || null };
    case 'client':
      return { ...normalized, clientId: input.clientId.trim() || null };
    case 'employee':
      return { ...normalized, employeeId: input.employeeId.trim() || null };
    case 'request':
      return { ...normalized, requestId: input.requestId.trim() || null };
    case 'equipment':
      return { ...normalized, equipmentId: input.equipmentId.trim() || null };
    case 'service_case':
      return {
        ...normalized,
        serviceCaseId: input.serviceCaseId.trim() || null,
      };
    case 'maintenance_coverage':
      return {
        ...normalized,
        maintenanceCoverageId: input.maintenanceCoverageId.trim() || null,
      };
    default: {
      const exhaustiveTarget: never = input;
      return exhaustiveTarget;
    }
  }
}

// Deny-by-default authorization for both the ticket and finalize steps. The
// same checks run twice on purpose: the signed upload URL and the metadata
// insert are separate requests, and each must independently prove access.
export async function authorizeDocumentUploadTarget(
  context: AuthorizedDocumentContext,
  target: NormalizedUploadTarget,
): Promise<ActionResult> {
  const {
    folderId,
    jobId,
    projectId,
    clientId,
    employeeId,
    requestId,
    equipmentId,
    serviceCaseId,
    maintenanceCoverageId,
  } = target;

  if (
    [
      jobId,
      projectId,
      clientId,
      employeeId,
      requestId,
      equipmentId,
      serviceCaseId,
      maintenanceCoverageId,
    ].filter(Boolean).length > 1
  ) {
    return { success: false, error: 'invalid_target' };
  }

  if (jobId) {
    const access = await ensureJobAccess(context, jobId);
    if (!access.success) return access;
  } else if (projectId) {
    // Field workers read a project's own documents but never write to it.
    const access = await ensureProjectManagerAccess(context, projectId);
    if (!access.success) return access;
  } else if (clientId) {
    const access = await ensureClientManagerAccess(context, clientId);
    if (!access.success) return access;
  } else if (employeeId) {
    const access = await ensureEmployeeManagerAccess(context, employeeId);
    if (!access.success) return access;
  } else if (requestId) {
    const access = await ensureRequestManagerAccess(context, requestId);
    if (!access.success) return access;
  } else if (equipmentId) {
    const access = await ensureEquipmentManagerAccess(context, equipmentId);
    if (!access.success) return access;
  } else if (serviceCaseId) {
    const access = await ensureServiceCaseManagerAccess(context, serviceCaseId);
    if (!access.success) return access;
  } else if (maintenanceCoverageId) {
    const access = await ensureMaintenanceCoverageManagerAccess(context, maintenanceCoverageId);
    if (!access.success) return access;
  } else {
    const manager = requireManager(context);
    if (!manager.success) return manager;
  }

  if (folderId && !context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const folderCheck = await ensureFolder(context.admin, context.orgId, folderId);
  if (!folderCheck.success) return folderCheck;

  return { success: true };
}

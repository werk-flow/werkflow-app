import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure, loggedRead } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import type { ParsedDocumentUploadTarget } from './action-schemas';
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
  canInspectHistory: boolean;
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
  return { success: true, folder: data as DocumentFolderRow };
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
  const { data: job, error: jobError } = await loggedRead(
    'ensureJobAccess: jobs read failed',
    context.admin
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (jobError) return { success: false, error: 'load_failed' };

  if (!job) {
    return { success: false, error: 'job_not_found' };
  }

  if (context.isManagerOrAbove) {
    return { success: true };
  }

  const { data: assignment, error: assignmentError } = await loggedRead(
    'ensureJobAccess: job_assignments read failed',
    context.admin
      .from('job_assignments')
      .select('id')
      .eq('organization_id', context.orgId)
      .eq('job_id', jobId)
      .eq('user_id', context.userId)
      .maybeSingle(),
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

  const row = document as DocumentRow;
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
    if (context.role === 'admin') {
      return {
        success: true,
        document: row,
        protectedAccess: {
          personnelDocumentId: protectedDocument.id,
          releasedVersionNumbers: null,
          canInspectHistory: true,
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
          canInspectHistory: true,
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
    const releases = (protectedDocument.personnel_document_releases ?? []) as Array<{
      document_version_number: number;
      revoked_at: string | null;
    }>;
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
        canInspectHistory: false,
      },
    };
  }
  if (context.isManagerOrAbove) {
    return { success: true, document: row, protectedAccess: null };
  }

  const { data: links, error: linksError } = await context.admin
    .from('document_links')
    .select('job_id, project_id')
    .eq('document_id', row.id)
    .eq('organization_id', context.orgId);

  const linkedRows = (links ?? []) as Pick<DocumentLinkRow, 'job_id' | 'project_id'>[];
  const jobIds = linkedRows.map((link) => link.job_id).filter((jobId): jobId is string => Boolean(jobId));
  const projectIds = linkedRows
    .map((link) => link.project_id)
    .filter((projectId): projectId is string => Boolean(projectId));

  // One matching assignment per batch proves access; a project's job list is never materialized.
  const [jobAssignments, projectAssignments] = await Promise.all([
    readInBatches(jobIds, (batch) =>
      context.admin
        .from('job_assignments')
        .select('id')
        .eq('organization_id', context.orgId)
        .in('job_id', [...batch])
        .eq('user_id', context.userId)
        .limit(1),
    ),
    readInBatches(projectIds, (batch) =>
      context.admin
        .from('job_assignments')
        .select('id, jobs!inner(project_id)')
        .eq('organization_id', context.orgId)
        .eq('jobs.organization_id', context.orgId)
        .in('jobs.project_id', [...batch])
        .eq('user_id', context.userId)
        .limit(1),
    ),
  ]);
  const accessError = linksError ?? jobAssignments.error ?? projectAssignments.error;
  if (accessError) {
    logReadFailure('getAuthorizedDocument: assignment access check failed', accessError);
    return { success: false, error: 'load_failed' };
  }

  if (jobAssignments.data.length + projectAssignments.data.length === 0) {
    return { success: false, error: 'not_authorized' };
  }

  return { success: true, document: row, protectedAccess: null };
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

  return { success: true, document: document as DocumentRow };
}

export async function getVersionableDocument(
  context: AuthorizedDocumentContext,
  documentId: string,
): Promise<ActionResult<{ document: DocumentRow }>> {
  const manager = requireManager(context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(context, documentId);
  if (!existing.success) return existing;

  const category = toDocumentCategory(existing.document.category);
  if (!['contract', 'invoice', 'offer', 'report'].includes(category)) {
    return { success: false, error: 'versioning_not_supported' };
  }

  return existing;
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

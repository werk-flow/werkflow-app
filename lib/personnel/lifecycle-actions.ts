'use server';

import { randomUUID } from 'node:crypto';
import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import { isManagerRole } from '@/lib/roles';
import type { ActionFailure } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { resolveSelfServiceContext } from '@/lib/org/self-service-context';
import { getResponsibilitiesStrandedByMemberRemoval } from '@/lib/responsibilities/server';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { Database, Json } from '@/lib/supabase/database.types';
import { createSignedUploadUrl, discardStorageObjects } from '@/lib/storage/r2';
import { acceptPersonnelUpload, discardPersonnelUpload, readPersonnelUploadOwner } from './upload-storage';
import { DOCUMENT_MAX_FILE_SIZE_BYTES, DOCUMENT_STORAGE_BUCKET } from '@/lib/documents/types';
import { buildDocumentStoragePath } from '@/lib/documents/storage-path';
import {
  accessTransitionInputSchema,
  acknowledgeDocumentInputSchema,
  acknowledgeRequirementInputSchema,
  createOnboardingPlanInputSchema,
  employmentTransitionInputSchema,
  personnelDocumentUploadInputSchema,
  personnelDocumentUploadCleanupInputSchema,
  personnelDocumentUploadTicketInputSchema,
  personnelDocumentReleaseInputSchema,
  type PersonnelDocumentAccessClass,
  type PersonnelDocumentEvidenceState,
} from './lifecycle';
import {
  hashRequest,
  lifecycleFailureCode,
  revalidatePersonnel,
  type LifecycleResult,
} from './lifecycle-results';
import {
  documentFileSchema,
  toAccessView,
  toActiveJobOptions,
  toEmploymentView,
  toManagerDocuments,
  toPlanViews,
  toRequirement,
  toTemplateSummaries,
  type PersonnelLifecycleAccess,
  type PersonnelLifecycleEmployment,
  type PersonnelOnboardingPlanView,
  type PersonnelLifecycleRequirement,
  type PersonnelOnboardingTemplateSummary,
  type ProtectedPersonnelDocument,
} from './lifecycle-rows';
import { createUploadCleanupToken, isValidUploadCleanupToken } from './upload-cleanup-token';

type TransitionInventory = {
  activeJobs: Array<{ id: string; label: string }>;
  strandedResponsibilities: string[];
};

type EmploymentTransitionResult =
  | { success: true; data: { lifecycleId: string } }
  | (ActionFailure & { data?: TransitionInventory });

const ACTIVE_JOB_STATUSES = ['nicht_bearbeitet', 'in_bearbeitung', 'geparkt'] satisfies Array<
  Database['public']['Enums']['job_status']
>;

export type PersonnelLifecycleView = {
  employeeRecordId: string;
  userId: string | null;
  access: PersonnelLifecycleAccess;
  employment: PersonnelLifecycleEmployment;
  plans: PersonnelOnboardingPlanView[];
  templates: PersonnelOnboardingTemplateSummary[];
  documents: ProtectedPersonnelDocument[];
  transitionInventory: {
    activeJobs: Array<{ id: string; label: string }>;
    strandedResponsibilities: string[];
  };
};

function readAccessLifecycle(admin: AdminClient, organizationId: string, employeeRecordId: string) {
  return admin
    .from('personnel_access_lifecycles')
    .select('*')
    .eq('employee_record_id', employeeRecordId)
    .eq('organization_id', organizationId)
    .maybeSingle();
}

function readEmploymentLifecycle(admin: AdminClient, organizationId: string, employeeRecordId: string) {
  return admin
    .from('personnel_employment_lifecycles')
    .select('*')
    .eq('employee_record_id', employeeRecordId)
    .eq('organization_id', organizationId)
    .maybeSingle();
}

function readPublishedTemplates(admin: AdminClient, organizationId: string) {
  return admin
    .from('personnel_onboarding_templates')
    .select(
      'id, name, description, state, current_version_number, version, personnel_onboarding_template_versions!inner(id, version_number)',
    )
    .eq('organization_id', organizationId)
    .eq('state', 'published');
}

async function requireManagerRecord(employeeRecordId: string): Promise<
  | {
      success: true;
      admin: AdminClient;
      organizationId: string;
      actorId: string;
      userId: string | null;
      role: 'admin' | 'buero';
    }
  | ActionFailure
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const role = isManagerRole(auth.context.role) ? auth.context.role : null;
  if (!auth.context.isManagerOrAbove || !role) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: employee, error: employeeError } = await loggedRead(
    'requireManagerRecord: employee_records read failed',
    admin
      .from('employee_records')
      .select('id, user_id')
      .eq('id', employeeRecordId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (employeeError) return { success: false, error: 'load_failed' };
  if (!employee) return { success: false, error: 'record_not_found' };
  return {
    success: true,
    admin,
    organizationId: auth.context.orgId,
    actorId: auth.context.userId,
    userId: employee.user_id,
    role,
  };
}

async function getSelfContext(): Promise<
  | {
      success: true;
      admin: AdminClient;
      organizationId: string;
      actorId: string;
      employeeRecordId: string;
      prestart: boolean;
    }
  | ActionFailure
> {
  const caller = await resolveSelfServiceContext();
  if (!caller.success) return caller;
  const { orgId, userId, prestart } = caller.context;
  const admin = createSupabaseAdminClient();
  const { data: employee, error: employeeError } = await loggedRead(
    'getSelfContext: employee_records read failed',
    admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle(),
  );
  if (employeeError) return { success: false, error: 'load_failed' };
  if (!employee) return { success: false, error: 'record_not_found' };
  return {
    success: true,
    admin,
    organizationId: orgId,
    actorId: userId,
    employeeRecordId: employee.id,
    prestart,
  };
}

export async function getPersonnelLifecycle(
  employeeRecordIdInput: string,
): Promise<LifecycleResult<PersonnelLifecycleView>> {
  const parsedEmployeeRecordId = uuidSchema.safeParse(employeeRecordIdInput);
  if (!parsedEmployeeRecordId.success) return { success: false, error: 'invalid_input' };
  const employeeRecordId = parsedEmployeeRecordId.data;
  const context = await requireManagerRecord(employeeRecordId);
  if (!context.success) return context;
  const { admin, organizationId, userId, role } = context;
  const documentsQuery = admin
    .from('personnel_documents')
    .select(
      '*, documents!inner(id, display_name, current_version_number, deleted_at), personnel_document_releases(document_version_number, revoked_at)',
    )
    .eq('employee_record_id', employeeRecordId)
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false });
  const authorizedDocumentsQuery =
    role === 'admin' ? documentsQuery : documentsQuery.eq('access_class', 'personnel_standard');
  const [access, employment, plans, requirements, documents, jobs, templates] = await Promise.all([
    readAccessLifecycle(admin, organizationId, employeeRecordId),
    readEmploymentLifecycle(admin, organizationId, employeeRecordId),
    admin
      .from('personnel_onboarding_plans')
      .select('*')
      .eq('employee_record_id', employeeRecordId)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false }),
    admin
      .from('personnel_onboarding_requirements')
      .select('*')
      .eq('employee_record_id', employeeRecordId)
      .eq('organization_id', organizationId)
      .order('sort_order'),
    authorizedDocumentsQuery,
    userId
      ? admin
          .from('job_assignments')
          .select('job_id, jobs!inner(id, title, job_number, status)')
          .eq('user_id', userId)
          .eq('organization_id', organizationId)
          .in('jobs.status', ACTIVE_JOB_STATUSES)
      : Promise.resolve({ data: [], error: null }),
    readPublishedTemplates(admin, organizationId),
  ]);
  const failed = [access, employment, plans, requirements, documents, jobs, templates].find(
    (result) => result.error,
  );
  if (failed?.error) {
    logError('Failed to load personnel lifecycle', failed.error);
    return { success: false, error: 'load_failed' };
  }

  const strandedResponsibilities = userId
    ? await getResponsibilitiesStrandedByMemberRemoval({ organizationId, userId })
    : [];
  if (!strandedResponsibilities) return { success: false, error: 'load_failed' };

  return {
    success: true,
    data: {
      employeeRecordId,
      userId,
      access: toAccessView(access.data),
      employment: toEmploymentView(employment.data),
      plans: toPlanViews(plans.data ?? [], (requirements.data ?? []).map(toRequirement)),
      templates: toTemplateSummaries(templates.data ?? []),
      documents: toManagerDocuments(documents.data ?? [], role),
      transitionInventory: { activeJobs: toActiveJobOptions(jobs.data ?? []), strandedResponsibilities },
    },
  };
}

export async function setPersonnelAccessTransition(
  input: unknown,
): Promise<LifecycleResult<{ lifecycleId: string }>> {
  const parsed = accessTransitionInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireManagerRecord(parsed.data.employeeRecordId);
  if (!context.success) return context;
  if (context.role !== 'admin') return { success: false, error: 'not_authorized' };
  const request = parsed.data;
  const { data, error } = await context.admin.rpc('set_personnel_access_transition', {
    p_actor_id: context.actorId,
    p_organization_id: context.organizationId,
    p_employee_record_id: request.employeeRecordId,
    p_expected_version: request.expectedVersion,
    p_transition_kind: request.transitionKind,
    p_effective_at: request.effectiveAt,
    p_reason: request.reason,
    p_operation_id: request.operationId,
    p_request_hash: hashRequest(request),
  });
  if (error || !data) return { success: false, error: lifecycleFailureCode(error) };
  revalidatePersonnel();
  return { success: true, data: { lifecycleId: data } };
}

async function loadTransitionInventory(context: {
  admin: AdminClient;
  organizationId: string;
  userId: string | null;
}): Promise<TransitionInventory | null> {
  if (!context.userId) return { activeJobs: [], strandedResponsibilities: [] };
  const [jobsResult, strandedResponsibilities] = await Promise.all([
    context.admin
      .from('job_assignments')
      .select('jobs!inner(id, title, job_number, status)')
      .eq('organization_id', context.organizationId)
      .eq('user_id', context.userId)
      .in('jobs.status', ACTIVE_JOB_STATUSES),
    getResponsibilitiesStrandedByMemberRemoval({
      organizationId: context.organizationId,
      userId: context.userId,
    }),
  ]);
  if (jobsResult.error) {
    logError('Failed to load active job assignments for the transition', jobsResult.error);
    return null;
  }
  if (!strandedResponsibilities) return null;
  const activeJobs = toActiveJobOptions(jobsResult.data);
  return { activeJobs, strandedResponsibilities };
}

export async function setPersonnelEmploymentTransition(input: unknown): Promise<EmploymentTransitionResult> {
  const parsed = employmentTransitionInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireManagerRecord(parsed.data.employeeRecordId);
  if (!context.success) return context;
  if (context.role !== 'admin') return { success: false, error: 'not_authorized' };
  const inventory = await loadTransitionInventory(context);
  if (!inventory) return { success: false, error: 'load_failed' };
  const needsResolution = ['mark_inactive', 'exit'].includes(parsed.data.transitionKind);
  if (
    needsResolution &&
    !parsed.data.acceptUnresolvedWork &&
    (inventory.activeJobs.length > 0 || inventory.strandedResponsibilities.length > 0)
  ) {
    return { success: false, error: 'unresolved_work', data: inventory };
  }
  const { acceptUnresolvedWork, ...request } = parsed.data;
  void acceptUnresolvedWork;
  const unresolvedWork: Json = [
    ...inventory.activeJobs.map((job) => ({ kind: 'job_assignment', id: job.id, label: job.label })),
    ...inventory.strandedResponsibilities.map((responsibility) => ({
      kind: 'responsibility',
      id: responsibility,
    })),
  ];
  const { data, error } = await context.admin.rpc('set_personnel_employment_transition', {
    p_actor_id: context.actorId,
    p_organization_id: context.organizationId,
    p_employee_record_id: request.employeeRecordId,
    p_expected_version: request.expectedVersion,
    p_transition_kind: request.transitionKind,
    p_effective_on: request.effectiveOn,
    p_reason: request.reason,
    p_unresolved_work: unresolvedWork,
    p_operation_id: request.operationId,
    p_request_hash: hashRequest({ ...request, unresolvedWork }),
  });
  if (error || !data) return { success: false, error: lifecycleFailureCode(error) };
  revalidatePersonnel();
  return { success: true, data: { lifecycleId: data } };
}

export async function createPersonnelOnboardingPlan(
  input: unknown,
): Promise<LifecycleResult<{ planId: string }>> {
  const parsed = createOnboardingPlanInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireManagerRecord(parsed.data.employeeRecordId);
  if (!context.success) return context;
  const request = parsed.data;
  const { data, error } = await context.admin.rpc(
    'create_personnel_onboarding_plan',
    rpcArgs('create_personnel_onboarding_plan', {
      p_actor_id: context.actorId,
      p_organization_id: context.organizationId,
      p_employee_record_id: request.employeeRecordId,
      p_template_version_id: request.templateVersionId,
      p_name: request.name,
      p_target_start_date: request.targetStartDate,
      p_operation_id: request.operationId,
      p_request_hash: hashRequest(request),
    }),
  );
  if (error || !data) return { success: false, error: lifecycleFailureCode(error) };
  revalidatePersonnel();
  return { success: true, data: { planId: data } };
}

export async function setPersonnelDocumentRelease(
  input: unknown,
): Promise<LifecycleResult<{ releaseId: string }>> {
  const parsed = personnelDocumentReleaseInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireManagerRecord(parsed.data.employeeRecordId);
  if (!context.success) return context;
  const request = parsed.data;
  const { data, error } = await context.admin.rpc(
    'set_personnel_document_release',
    rpcArgs('set_personnel_document_release', {
      p_actor_id: context.actorId,
      p_organization_id: context.organizationId,
      p_personnel_document_id: request.personnelDocumentId,
      p_document_version_number: request.documentVersionNumber,
      p_release: request.release,
      p_reason: request.reason,
      p_operation_id: request.operationId,
      p_request_hash: hashRequest(request),
    }),
  );
  if (error || !data) return { success: false, error: lifecycleFailureCode(error) };
  revalidatePersonnel();
  return { success: true, data: { releaseId: data } };
}

type PersonnelUploadActor = {
  success: true;
  admin: AdminClient;
  organizationId: string;
  actorId: string;
  affectedUserId: string | null;
};

/**
 * Who may upload a personnel document: an Admin for any access class, Büro
 * for standard files, and the employee for their own health evidence.
 */
async function requirePersonnelUploadActor(request: {
  employeeRecordId: string;
  accessClass: PersonnelDocumentAccessClass;
}): Promise<PersonnelUploadActor | ActionFailure> {
  const manager = await requireManagerRecord(request.employeeRecordId);
  if (manager.success) {
    if (request.accessClass !== 'personnel_standard' && manager.role !== 'admin') {
      return { success: false, error: 'not_authorized' };
    }
    const { admin, organizationId, actorId, userId } = manager;
    return { success: true, admin, organizationId, actorId, affectedUserId: userId };
  }
  const self = await getSelfContext();
  if (
    !self.success ||
    self.employeeRecordId !== request.employeeRecordId ||
    request.accessClass !== 'health_evidence'
  ) {
    return { success: false, error: 'not_authorized' };
  }
  const { admin, organizationId, actorId } = self;
  return { success: true, admin, organizationId, actorId, affectedUserId: actorId };
}

export type OwnPersonnelActions = {
  organizationId: string;
  employeeRecordId: string;
  prestart: boolean;
  requirements: PersonnelLifecycleRequirement[];
  documents: ProtectedPersonnelDocument[];
};

export async function getOwnPersonnelActions(): Promise<LifecycleResult<OwnPersonnelActions>> {
  const context = await getSelfContext();
  if (!context.success) return context;
  const [requirementsResult, documentsResult] = await Promise.all([
    context.admin
      .from('personnel_onboarding_requirements')
      .select('*')
      .eq('employee_record_id', context.employeeRecordId)
      .eq('organization_id', context.organizationId)
      .in('state', ['missing', 'pending', 'blocked'])
      .order('due_date', { ascending: true, nullsFirst: false }),
    context.admin
      .from('personnel_documents')
      .select(
        '*, documents!inner(id, display_name, current_version_number, deleted_at), personnel_document_releases!inner(document_version_number, revoked_at)',
      )
      .eq('employee_record_id', context.employeeRecordId)
      .eq('organization_id', context.organizationId),
  ]);
  if (requirementsResult.error || documentsResult.error) {
    logError('Failed to load own personnel actions', requirementsResult.error ?? documentsResult.error);
    return { success: false, error: 'load_failed' };
  }
  const documents = (documentsResult.data ?? []).flatMap((document) => {
    const parsedFile = documentFileSchema.safeParse(document.documents);
    if (!parsedFile.success) return [];
    const file = parsedFile.data;
    const releases = document.personnel_document_releases;
    const released = releases.some(
      (release) =>
        release.document_version_number === file.current_version_number && release.revoked_at === null,
    );
    return released && file.deleted_at === null
      ? [
          {
            id: document.id,
            documentId: file.id,
            displayName: file.display_name,
            documentType: document.document_type,
            accessClass: document.access_class,
            evidenceState: document.evidence_state,
            validUntil: document.valid_until,
            currentVersionNumber: file.current_version_number,
            releasedToEmployee: true,
            deletedAt: file.deleted_at,
            version: document.version,
          },
        ]
      : [];
  });
  return {
    success: true,
    data: {
      organizationId: context.organizationId,
      employeeRecordId: context.employeeRecordId,
      prestart: context.prestart,
      requirements: (requirementsResult.data ?? []).map(toRequirement),
      documents,
    },
  };
}

export async function acknowledgePersonnelRequirement(
  input: unknown,
): Promise<LifecycleResult<{ acknowledgementId: string }>> {
  const parsed = acknowledgeRequirementInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await getSelfContext();
  if (!context.success) return context;
  const request = parsed.data;
  const { data, error } = await context.admin.rpc(
    'acknowledge_personnel_item',
    rpcArgs('acknowledge_personnel_item', {
      p_actor_id: context.actorId,
      p_organization_id: context.organizationId,
      p_acknowledgement_kind: 'requirement_completed',
      p_personnel_document_id: null,
      p_document_version_number: null,
      p_requirement_id: request.requirementId,
      p_requirement_version: request.requirementVersion,
      p_statement: request.statement,
      p_operation_id: request.operationId,
      p_request_hash: hashRequest(request),
    }),
  );
  if (error || !data) return { success: false, error: lifecycleFailureCode(error) };
  revalidatePersonnel();
  return { success: true, data: { acknowledgementId: data } };
}

export async function acknowledgePersonnelDocument(
  input: unknown,
): Promise<LifecycleResult<{ acknowledgementId: string }>> {
  const parsed = acknowledgeDocumentInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await getSelfContext();
  if (!context.success) return context;
  const request = parsed.data;
  const { data, error } = await context.admin.rpc(
    'acknowledge_personnel_item',
    rpcArgs('acknowledge_personnel_item', {
      p_actor_id: context.actorId,
      p_organization_id: context.organizationId,
      p_acknowledgement_kind: 'document_received',
      p_personnel_document_id: request.personnelDocumentId,
      p_document_version_number: request.documentVersionNumber,
      p_requirement_id: null,
      p_requirement_version: null,
      p_statement: request.statement,
      p_operation_id: request.operationId,
      p_request_hash: hashRequest(request),
    }),
  );
  if (error || !data) return { success: false, error: lifecycleFailureCode(error) };
  revalidatePersonnel();
  return { success: true, data: { acknowledgementId: data } };
}

export type PersonnelLifecycleManifest = {
  generatedAt: string;
  employeeRecordId: string;
  access: PersonnelLifecycleView['access'];
  employment: PersonnelLifecycleView['employment'];
  onboarding: PersonnelLifecycleView['plans'];
  protectedDocuments: Array<{
    documentType: string;
    accessClass: PersonnelDocumentAccessClass;
    evidenceState: PersonnelDocumentEvidenceState;
    validUntil: string | null;
    currentVersionNumber: number;
    releasedToEmployee: boolean;
  }>;
  transitionInventory: PersonnelLifecycleView['transitionInventory'];
  limitations: string[];
};

export async function exportPersonnelLifecycleManifest(
  employeeRecordIdInput: string,
): Promise<LifecycleResult<PersonnelLifecycleManifest>> {
  const parsedEmployeeRecordId = uuidSchema.safeParse(employeeRecordIdInput);
  if (!parsedEmployeeRecordId.success) return { success: false, error: 'invalid_input' };
  const employeeRecordId = parsedEmployeeRecordId.data;
  const context = await requireManagerRecord(employeeRecordId);
  if (!context.success) return context;
  if (context.role !== 'admin') return { success: false, error: 'not_authorized' };
  const lifecycle = await getPersonnelLifecycle(employeeRecordId);
  if (!lifecycle.success) return { success: false, error: lifecycle.error };
  return {
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      employeeRecordId,
      access: lifecycle.data.access,
      employment: lifecycle.data.employment,
      onboarding: lifecycle.data.plans,
      protectedDocuments: lifecycle.data.documents.map((document) => ({
        documentType: document.documentType,
        accessClass: document.accessClass,
        evidenceState: document.evidenceState,
        validUntil: document.validUntil,
        currentVersionNumber: document.currentVersionNumber,
        releasedToEmployee: document.releasedToEmployee,
      })),
      transitionInventory: lifecycle.data.transitionInventory,
      limitations: [
        'Dieser Arbeitsstand ist keine unveränderliche Aufbewahrungsakte.',
        'Dateiinhalte werden nicht in das Manifest kopiert.',
        'Gesetzliche Aufbewahrungsfristen und Legal Hold sind nicht bewertet.',
      ],
    },
  };
}

export async function createPersonnelDocumentUploadTicket(input: {
  employeeRecordId: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType?: string | null;
  accessClass: PersonnelDocumentAccessClass;
  operationId: string;
}): Promise<
  LifecycleResult<{ documentId: string; storagePath: string; uploadUrl: string; cleanupToken: string }>
> {
  const parsed = personnelDocumentUploadTicketInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const request = parsed.data;
  if (request.fileSizeBytes > DOCUMENT_MAX_FILE_SIZE_BYTES)
    return { success: false, error: 'file_too_large' };
  const actor = await requirePersonnelUploadActor(request);
  if (!actor.success) return actor;
  const { organizationId, actorId } = actor;
  const documentId = randomUUID();
  const storagePath = buildDocumentStoragePath({ organizationId, documentId, fileName: request.fileName });
  try {
    const cleanupToken = createUploadCleanupToken({
      actorId,
      organizationId,
      employeeRecordId: request.employeeRecordId,
      documentId,
      fileName: request.fileName,
      accessClass: request.accessClass,
      operationId: request.operationId,
    });
    const uploadUrl = await createSignedUploadUrl({
      organizationId,
      path: storagePath,
      contentType: request.mimeType || 'application/octet-stream',
    });
    return { success: true, data: { documentId, storagePath, uploadUrl, cleanupToken } };
  } catch (error) {
    logError('Failed to create personnel document upload ticket', error);
    return { success: false, error: 'ticket_failed' };
  }
}

export async function cleanupPersonnelDocumentUpload(input: unknown): Promise<LifecycleResult> {
  const parsed = personnelDocumentUploadCleanupInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const request = parsed.data;
  const context = await requirePersonnelUploadActor(request);
  if (!context.success) return context;
  const storagePath = buildDocumentStoragePath({
    organizationId: context.organizationId,
    documentId: request.documentId,
    fileName: request.fileName,
  });
  if (
    !isValidUploadCleanupToken(request.cleanupToken, {
      actorId: context.actorId,
      organizationId: context.organizationId,
      employeeRecordId: request.employeeRecordId,
      documentId: request.documentId,
      fileName: request.fileName,
      accessClass: request.accessClass,
      operationId: request.operationId,
    })
  )
    return { success: false, error: 'not_authorized' };
  const upload = { admin: context.admin, organizationId: context.organizationId, storagePath };
  const owner = await readPersonnelUploadOwner(
    upload,
    'cleanupPersonnelDocumentUpload: documents read failed',
  );
  if (owner === undefined) return { success: false, error: 'load_failed' };
  if (owner) return { success: true };
  await discardPersonnelUpload(upload);
  const { error: auditError } = await context.admin.from('document_audit_events').insert({
    organization_id: context.organizationId,
    actor_id: context.actorId,
    event_type: 'storage_cleanup',
    event_payload: {
      documentId: request.documentId,
      reason: 'unfinalized_personnel_upload',
    },
  });
  if (auditError) {
    logError('Failed to record personnel upload cleanup event', auditError);
  }
  return { success: true };
}

export async function finalizePersonnelDocumentUpload(
  input: unknown,
): Promise<LifecycleResult<{ documentId: string }>> {
  const parsed = personnelDocumentUploadInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const request = parsed.data;
  const context = await requirePersonnelUploadActor(request);
  if (!context.success) return context;
  const storagePath = buildDocumentStoragePath({
    organizationId: context.organizationId,
    documentId: request.documentId,
    fileName: request.fileName,
  });
  if (
    !isValidUploadCleanupToken(request.cleanupToken, {
      actorId: context.actorId,
      organizationId: context.organizationId,
      employeeRecordId: request.employeeRecordId,
      documentId: request.documentId,
      fileName: request.fileName,
      accessClass: request.accessClass,
      operationId: request.operationId,
    })
  )
    return { success: false, error: 'not_authorized' };
  const upload = { admin: context.admin, organizationId: context.organizationId, storagePath };
  const head = await acceptPersonnelUpload(upload);
  if (!head.success) return head;
  if (head.sizeBytes > DOCUMENT_MAX_FILE_SIZE_BYTES) {
    await discardStorageObjects({ organizationId: context.organizationId, paths: [storagePath] });
    return { success: false, error: 'file_too_large' };
  }
  const { data, error } = await context.admin.rpc(
    'finalize_personnel_document_metadata',
    rpcArgs('finalize_personnel_document_metadata', {
      p_actor_id: context.actorId,
      p_organization_id: context.organizationId,
      p_employee_record_id: request.employeeRecordId,
      p_document_id: request.documentId,
      p_storage_bucket: DOCUMENT_STORAGE_BUCKET,
      p_storage_path: storagePath,
      p_original_file_name: request.fileName,
      p_display_name: request.fileName,
      p_category: 'other',
      p_mime_type: head.contentType || 'application/octet-stream',
      p_size_bytes: head.sizeBytes,
      p_document_type: request.documentType,
      p_access_class: request.accessClass,
      p_evidence_state: request.evidenceState,
      p_valid_until: request.validUntil,
      p_operation_id: request.operationId,
      p_request_hash: hashRequest(request),
    }),
  );
  if (error || !data) {
    const normalized = lifecycleFailureCode(error);
    const owner = await readPersonnelUploadOwner(
      upload,
      'finalizePersonnelDocumentUpload: documents read failed',
    );
    // A failed read keeps the object.
    if (owner === null)
      await discardStorageObjects({ organizationId: context.organizationId, paths: [storagePath] });
    return { success: false, error: normalized };
  }
  revalidatePersonnel();
  return { success: true, data: { documentId: data } };
}

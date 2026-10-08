'use server';

import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { isManagerRole } from '@/lib/roles';

import { getAuthenticatedUser, getCachedMemberships, getCachedPrestartMemberships } from '@/lib/data/cached';
import type { ActionFailure } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies';
import { getResponsibilitiesStrandedByMemberRemoval } from '@/lib/responsibilities/server';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { getSupabaseSecretKey } from '@/lib/env/server';
import type { Database, Json } from '@/lib/supabase/database.types';
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  discardStorageObjects,
  headStorageObject,
} from '@/lib/storage/r2';
import { DOCUMENT_MAX_FILE_SIZE_BYTES, DOCUMENT_STORAGE_BUCKET } from '@/lib/documents/types';
import { buildDocumentStoragePath } from '@/lib/documents/storage-path';
import {
  accessTransitionInputSchema,
  acknowledgeDocumentInputSchema,
  acknowledgeRequirementInputSchema,
  createOnboardingPlanInputSchema,
  employmentTransitionInputSchema,
  getEffectiveAccessState,
  personnelDocumentUploadInputSchema,
  personnelDocumentUploadCleanupInputSchema,
  personnelDocumentUploadTicketInputSchema,
  personnelDocumentReleaseInputSchema,
  publishTemplateInputSchema,
  saveRequirementInputSchema,
  toTemplateRpcItems,
  type PersonnelAccessState,
  type PersonnelDocumentAccessClass,
  type PersonnelDocumentEvidenceState,
  type PersonnelEmploymentState,
  type PersonnelRequirementState,
  type PersonnelRequirementType,
} from './lifecycle';

// A lifecycle success nests its payload under `data`; a rejected transition may return the blocking inventory there.
type LifecycleResult<T = undefined> =
  | ({ success: true } & (T extends undefined ? object : { data: T }))
  | (ActionFailure & { data?: T });

type TransitionInventory = {
  activeJobs: Array<{ id: string; label: string }>;
  strandedResponsibilities: string[];
};

type EmploymentTransitionResult =
  | { success: true; data: { lifecycleId: string } }
  | (ActionFailure & { data?: TransitionInventory });

type AccessLifecycleRow = Database['public']['Tables']['personnel_access_lifecycles']['Row'];
type EmploymentLifecycleRow = Database['public']['Tables']['personnel_employment_lifecycles']['Row'];
type RequirementRow = Database['public']['Tables']['personnel_onboarding_requirements']['Row'];

// The admin client is untyped, so embedded relations are parsed where they cross in.
const documentFileSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  current_version_number: z.number(),
  deleted_at: z.string().nullable(),
});
const signedDocumentFileSchema = documentFileSchema.extend({
  organization_id: z.string(),
  storage_path: z.string(),
});
const templateVersionsSchema = z.array(z.object({ id: z.string(), version_number: z.number() }));
const assignedJobSchema = z.object({ id: z.string(), title: z.string(), job_number: z.string().nullable() });

function toActiveJobOptions(
  assignments: ReadonlyArray<{ jobs: unknown }>,
): Array<{ id: string; label: string }> {
  return assignments.flatMap((assignment) => {
    const job = assignedJobSchema.safeParse(assignment.jobs);
    if (!job.success) return [];
    const { id, title, job_number: jobNumber } = job.data;
    return [{ id, label: jobNumber ? `${jobNumber} · ${title}` : title }];
  });
}

const ACTIVE_JOB_STATUSES = ['nicht_bearbeitet', 'in_bearbeitung', 'geparkt'] satisfies Array<
  Database['public']['Enums']['job_status']
>;
// Covers the 25-minute browser upload timeout plus finalize and cleanup retries.
const UPLOAD_CLEANUP_TOKEN_TTL_MS = 45 * 60 * 1000;

type UploadCleanupTokenPayload = {
  actorId: string;
  organizationId: string;
  employeeRecordId: string;
  documentId: string;
  fileName: string;
  accessClass: PersonnelDocumentAccessClass;
  operationId: string;
  expiresAt: number;
};

function uploadCleanupTokenSecret(): Buffer {
  const secret = getSupabaseSecretKey();
  return createHmac('sha256', secret).update('werkflow:p1-24-upload-cleanup:v1').digest();
}

function createUploadCleanupToken(payload: Omit<UploadCleanupTokenPayload, 'expiresAt'>): string {
  const encoded = Buffer.from(
    JSON.stringify({
      ...payload,
      expiresAt: Date.now() + UPLOAD_CLEANUP_TOKEN_TTL_MS,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', uploadCleanupTokenSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function isValidUploadCleanupToken(
  token: string,
  expected: Omit<UploadCleanupTokenPayload, 'expiresAt'>,
): boolean {
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return false;
  const actualSignature = createHmac('sha256', uploadCleanupTokenSecret()).update(encoded).digest();
  const suppliedSignature = Buffer.from(signature, 'base64url');
  if (
    suppliedSignature.length !== actualSignature.length ||
    !timingSafeEqual(suppliedSignature, actualSignature)
  )
    return false;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as UploadCleanupTokenPayload;
    return (
      payload.expiresAt >= Date.now() &&
      payload.actorId === expected.actorId &&
      payload.organizationId === expected.organizationId &&
      payload.employeeRecordId === expected.employeeRecordId &&
      payload.documentId === expected.documentId &&
      payload.fileName === expected.fileName &&
      payload.accessClass === expected.accessClass &&
      payload.operationId === expected.operationId
    );
  } catch {
    return false;
  }
}

type PersonnelLifecycleRequirement = {
  id: string;
  planId: string;
  requirementType: PersonnelRequirementType;
  title: string;
  description: string | null;
  isRequired: boolean;
  blocksAccess: boolean;
  ownerEmployeeRecordId: string | null;
  dueDate: string | null;
  state: PersonnelRequirementState;
  blockerReason: string | null;
  version: number;
};

type ProtectedPersonnelDocument = {
  id: string;
  documentId: string;
  displayName: string;
  documentType: string;
  accessClass: PersonnelDocumentAccessClass;
  evidenceState: PersonnelDocumentEvidenceState;
  validUntil: string | null;
  currentVersionNumber: number;
  releasedToEmployee: boolean;
  deletedAt: string | null;
  version: number;
};

export type PersonnelLifecycleView = {
  employeeRecordId: string;
  userId: string | null;
  access: {
    id: string | null;
    state: PersonnelAccessState;
    storedState: PersonnelAccessState | null;
    effectiveAt: string | null;
    scheduledState: PersonnelAccessState | null;
    scheduledFor: string | null;
    version: number;
  };
  employment: {
    id: string | null;
    state: PersonnelEmploymentState | null;
    effectiveOn: string | null;
    scheduledState: PersonnelEmploymentState | null;
    scheduledFor: string | null;
    version: number;
  };
  plans: Array<{
    id: string;
    name: string;
    state: Database['public']['Enums']['personnel_onboarding_plan_state'];
    targetStartDate: string | null;
    version: number;
    requirements: PersonnelLifecycleRequirement[];
  }>;
  templates: PersonnelOnboardingTemplateSummary[];
  documents: ProtectedPersonnelDocument[];
  transitionInventory: {
    activeJobs: Array<{ id: string; label: string }>;
    strandedResponsibilities: string[];
  };
};

function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeDatabaseError(error: { code?: string; message?: string } | null): string {
  const message = error?.message ?? 'mutation_failed';
  const known = [
    'forbidden',
    'stale_version',
    'operation_id_conflict',
    'last_admin_protected',
    'organization_owner_protected',
    'last_responsibility_holder',
    'membership_required',
    'future_effective_at_required',
    'immediate_effective_at_required',
    'future_effective_date_required',
    'no_scheduled_transition',
    'access_requirements_incomplete',
    'document_not_released',
    'document_version_not_found',
    'personnel_document_not_found',
    'requirement_not_found',
    'requirement_not_open',
    'employee_record_not_found',
    'template_version_not_found',
    'template_not_found',
    'plan_not_found',
    'owner_not_found',
    'release_not_active',
    'active_access_required',
    'invalid_transition',
    'invalid_template_item',
    'invalid_template',
    'invalid_requirement',
    'invalid_document_type',
    'invalid_document',
    'invalid_reference',
    'invalid_acknowledgement',
    'invalid_plan',
    'reason_required',
    'statement_required',
  ].find((code) => message.includes(code));
  if (known) return known;
  logError('Unexpected personnel lifecycle database error', error);
  return 'mutation_failed';
}

function revalidatePersonnel(): void {
  revalidatePath('/mitarbeiter');
  revalidatePath('/aufgaben');
  revalidatePath('/onboarding/meine-aufgaben');
}

function toRequirement(row: RequirementRow): PersonnelLifecycleRequirement {
  return {
    id: row.id,
    planId: row.plan_id,
    requirementType: row.requirement_type,
    title: row.title,
    description: row.description,
    isRequired: row.is_required,
    blocksAccess: row.blocks_access,
    ownerEmployeeRecordId: row.owner_employee_record_id,
    dueDate: row.due_date,
    state: row.state,
    blockerReason: row.blocker_reason,
    version: row.version,
  };
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
  const [
    accessResult,
    employmentResult,
    plansResult,
    requirementsResult,
    documentsResult,
    jobsResult,
    templatesResult,
  ] = await Promise.all([
    admin
      .from('personnel_access_lifecycles')
      .select('*')
      .eq('employee_record_id', employeeRecordId)
      .eq('organization_id', organizationId)
      .maybeSingle(),
    admin
      .from('personnel_employment_lifecycles')
      .select('*')
      .eq('employee_record_id', employeeRecordId)
      .eq('organization_id', organizationId)
      .maybeSingle(),
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
    admin
      .from('personnel_onboarding_templates')
      .select(
        'id, name, description, state, current_version_number, version, personnel_onboarding_template_versions!inner(id, version_number)',
      )
      .eq('organization_id', organizationId)
      .eq('state', 'published'),
  ]);
  const failed = [
    accessResult,
    employmentResult,
    plansResult,
    requirementsResult,
    documentsResult,
    jobsResult,
    templatesResult,
  ].find((result) => result.error);
  if (failed?.error) {
    logError('Failed to load personnel lifecycle', failed.error);
    return { success: false, error: 'load_failed' };
  }

  const access = accessResult.data as AccessLifecycleRow | null;
  const employment = employmentResult.data as EmploymentLifecycleRow | null;
  const requirements = (requirementsResult.data ?? []).map(toRequirement);
  const strandedResponsibilities = userId
    ? await getResponsibilitiesStrandedByMemberRemoval({ organizationId, userId })
    : [];
  if (!strandedResponsibilities) return { success: false, error: 'load_failed' };
  const documents = (documentsResult.data ?? [])
    .filter((document) => role === 'admin' || document.access_class === 'personnel_standard')
    .flatMap((document) => {
      const parsedFile = documentFileSchema.safeParse(document.documents);
      if (!parsedFile.success) return [];
      const file = parsedFile.data;
      const releases = (document.personnel_document_releases ?? []) as Array<{
        document_version_number: number;
        revoked_at: string | null;
      }>;
      return [
        {
          id: document.id,
          documentId: file.id,
          displayName: file.display_name,
          documentType: document.document_type,
          accessClass: document.access_class,
          evidenceState: document.evidence_state,
          validUntil: document.valid_until,
          currentVersionNumber: file.current_version_number,
          releasedToEmployee: releases.some(
            (release) =>
              release.document_version_number === file.current_version_number && release.revoked_at === null,
          ),
          deletedAt: file.deleted_at,
          version: document.version,
        },
      ];
    });
  const activeJobs = toActiveJobOptions(jobsResult.data ?? []);

  return {
    success: true,
    data: {
      employeeRecordId,
      userId,
      access: {
        id: access?.id ?? null,
        state: getEffectiveAccessState(
          access
            ? {
                state: access.state,
                scheduledState: access.scheduled_state,
                scheduledFor: access.scheduled_for,
              }
            : null,
        ),
        storedState: access?.state ?? null,
        effectiveAt: access?.state_effective_at ?? null,
        scheduledState: access?.scheduled_state ?? null,
        scheduledFor: access?.scheduled_for ?? null,
        version: access?.version ?? 0,
      },
      employment: {
        id: employment?.id ?? null,
        state: employment?.state ?? null,
        effectiveOn: employment?.state_effective_on ?? null,
        scheduledState: employment?.scheduled_state ?? null,
        scheduledFor: employment?.scheduled_for ?? null,
        version: employment?.version ?? 0,
      },
      plans: (plansResult.data ?? []).map((plan) => ({
        id: plan.id,
        name: plan.name,
        state: plan.state,
        targetStartDate: plan.target_start_date,
        version: plan.version,
        requirements: requirements.filter((requirement) => requirement.planId === plan.id),
      })),
      templates: (templatesResult.data ?? []).flatMap((template) => {
        const versions = templateVersionsSchema.safeParse(template.personnel_onboarding_template_versions);
        const current = versions.data?.find(
          (version) => version.version_number === template.current_version_number,
        );
        return current
          ? [
              {
                id: template.id,
                currentVersionId: current.id,
                name: template.name,
                description: template.description,
                state: template.state,
                currentVersionNumber: template.current_version_number,
                version: template.version,
              },
            ]
          : [];
      }),
      documents,
      transitionInventory: { activeJobs, strandedResponsibilities },
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
  if (error || !data) return { success: false, error: normalizeDatabaseError(error) };
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
  if (error || !data) return { success: false, error: normalizeDatabaseError(error) };
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
  const { data, error } = await context.admin.rpc('create_personnel_onboarding_plan', {
    p_actor_id: context.actorId,
    p_organization_id: context.organizationId,
    p_employee_record_id: request.employeeRecordId,
    p_template_version_id: request.templateVersionId as string,
    p_name: request.name,
    p_target_start_date: request.targetStartDate as string,
    p_operation_id: request.operationId,
    p_request_hash: hashRequest(request),
  });
  if (error || !data) return { success: false, error: normalizeDatabaseError(error) };
  revalidatePersonnel();
  return { success: true, data: { planId: data } };
}

export async function savePersonnelOnboardingRequirement(
  input: unknown,
): Promise<LifecycleResult<{ requirementId: string }>> {
  const parsed = saveRequirementInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const admin = createSupabaseAdminClient();
  const { data: plan, error: planError } = await loggedRead(
    'savePersonnelOnboardingRequirement: personnel_onboarding_plans read failed',
    admin
      .from('personnel_onboarding_plans')
      .select('employee_record_id')
      .eq('id', parsed.data.planId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (planError) return { success: false, error: 'load_failed' };
  if (!plan) return { success: false, error: 'plan_not_found' };
  const request = parsed.data;
  const { data, error } = await admin.rpc('save_personnel_onboarding_requirement', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_plan_id: request.planId,
    p_requirement_id: request.requirementId as string,
    p_expected_version: request.expectedVersion,
    p_requirement_type: request.requirementType,
    p_title: request.title,
    p_description: request.description as string,
    p_is_required: request.isRequired,
    p_blocks_access: request.blocksAccess,
    p_owner_employee_record_id: request.ownerEmployeeRecordId as string,
    p_due_date: request.dueDate as string,
    p_state: request.state,
    p_blocker_reason: request.blockerReason as string,
    p_operation_id: request.operationId,
    p_request_hash: hashRequest(request),
  });
  if (error || !data) return { success: false, error: normalizeDatabaseError(error) };
  revalidatePersonnel();
  return { success: true, data: { requirementId: data } };
}

export async function publishPersonnelOnboardingTemplate(
  input: unknown,
): Promise<LifecycleResult<{ versionId: string }>> {
  const parsed = publishTemplateInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (auth.context.role !== 'admin') return { success: false, error: 'not_authorized' };
  const admin = createSupabaseAdminClient();
  const request = parsed.data;
  const items = toTemplateRpcItems(request.items);
  const { data, error } = await admin.rpc('publish_personnel_onboarding_template', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_template_id: request.templateId as string,
    p_expected_version: request.expectedVersion,
    p_name: request.name,
    p_description: request.description as string,
    p_items: items,
    p_operation_id: request.operationId,
    p_request_hash: hashRequest(request),
  });
  if (error || !data) {
    logError('Failed to publish personnel onboarding template', error);
    return { success: false, error: normalizeDatabaseError(error) };
  }
  revalidatePersonnel();
  return { success: true, data: { versionId: data } };
}

export type PersonnelOnboardingTemplateSummary = {
  id: string;
  currentVersionId: string;
  name: string;
  description: string | null;
  state: Database['public']['Enums']['personnel_template_state'];
  currentVersionNumber: number;
  version: number;
};

export async function getPersonnelOnboardingTemplates(): Promise<
  LifecycleResult<PersonnelOnboardingTemplateSummary[]>
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('personnel_onboarding_templates')
    .select(
      'id, name, description, state, current_version_number, version, personnel_onboarding_template_versions!inner(id, version_number)',
    )
    .eq('organization_id', auth.context.orgId)
    .order('name');
  if (error) {
    logError('Failed to load personnel onboarding templates', error);
    return { success: false, error: 'load_failed' };
  }
  return {
    success: true,
    data: (data ?? []).flatMap((template) => {
      const versions = templateVersionsSchema.safeParse(template.personnel_onboarding_template_versions);
      const current = versions.data?.find(
        (version) => version.version_number === template.current_version_number,
      );
      return current
        ? [
            {
              id: template.id,
              currentVersionId: current.id,
              name: template.name,
              description: template.description,
              state: template.state,
              currentVersionNumber: template.current_version_number,
              version: template.version,
            },
          ]
        : [];
    }),
  };
}

export async function setPersonnelDocumentRelease(
  input: unknown,
): Promise<LifecycleResult<{ releaseId: string }>> {
  const parsed = personnelDocumentReleaseInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireManagerRecord(parsed.data.employeeRecordId);
  if (!context.success) return context;
  const request = parsed.data;
  const { data, error } = await context.admin.rpc('set_personnel_document_release', {
    p_actor_id: context.actorId,
    p_organization_id: context.organizationId,
    p_personnel_document_id: request.personnelDocumentId,
    p_document_version_number: request.documentVersionNumber,
    p_release: request.release,
    p_reason: request.reason as string,
    p_operation_id: request.operationId,
    p_request_hash: hashRequest(request),
  });
  if (error || !data) return { success: false, error: normalizeDatabaseError(error) };
  revalidatePersonnel();
  return { success: true, data: { releaseId: data } };
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
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const cookieStore = await cookies();
  const [activeMemberships, prestartMemberships] = await Promise.all([
    getCachedMemberships(user.id),
    getCachedPrestartMemberships(user.id),
  ]);
  const candidates = [
    ...activeMemberships.map((membership) => ({ ...membership, prestart: false })),
    ...prestartMemberships.map((membership) => ({ ...membership, prestart: true })),
  ];
  const stored = cookieStore.get(CURRENT_ORG_COOKIE)?.value;
  const storedMembership = stored ? candidates.find((candidate) => candidate.orgId === stored) : undefined;
  const membership = stored ? storedMembership : candidates.length === 1 ? candidates[0] : undefined;
  if (!membership) return { success: false, error: 'not_a_member' };
  const admin = createSupabaseAdminClient();
  const { data: employee, error: employeeError } = await loggedRead(
    'getSelfContext: employee_records read failed',
    admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', membership.orgId)
      .eq('user_id', user.id)
      .maybeSingle(),
  );
  if (employeeError) return { success: false, error: 'load_failed' };
  if (!employee) return { success: false, error: 'record_not_found' };
  return {
    success: true,
    admin,
    organizationId: membership.orgId,
    actorId: user.id,
    employeeRecordId: employee.id,
    prestart: membership.prestart,
  };
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
    const releases = (document.personnel_document_releases ?? []) as Array<{
      document_version_number: number;
      revoked_at: string | null;
    }>;
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
  if (error || !data) return { success: false, error: normalizeDatabaseError(error) };
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
  if (error || !data) return { success: false, error: normalizeDatabaseError(error) };
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
  const manager = await requireManagerRecord(request.employeeRecordId);
  let organizationId: string;
  let actorId: string;
  if (manager.success) {
    if (request.accessClass !== 'personnel_standard' && manager.role !== 'admin') {
      return { success: false, error: 'not_authorized' };
    }
    organizationId = manager.organizationId;
    actorId = manager.actorId;
  } else {
    const self = await getSelfContext();
    if (
      !self.success ||
      self.employeeRecordId !== request.employeeRecordId ||
      request.accessClass !== 'health_evidence'
    ) {
      return { success: false, error: 'not_authorized' };
    }
    organizationId = self.organizationId;
    actorId = self.actorId;
  }
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
  const manager = await requireManagerRecord(request.employeeRecordId);
  let context: { admin: AdminClient; organizationId: string; actorId: string };
  if (manager.success) {
    if (request.accessClass !== 'personnel_standard' && manager.role !== 'admin') {
      return { success: false, error: 'not_authorized' };
    }
    context = manager;
  } else {
    const self = await getSelfContext();
    if (
      !self.success ||
      self.employeeRecordId !== request.employeeRecordId ||
      request.accessClass !== 'health_evidence'
    ) {
      return { success: false, error: 'not_authorized' };
    }
    context = self;
  }
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
  const { data: owner, error: ownerError } = await loggedRead(
    'cleanupPersonnelDocumentUpload: documents read failed',
    context.admin
      .from('documents')
      .select('id')
      .eq('organization_id', context.organizationId)
      .eq('storage_path', storagePath)
      .maybeSingle(),
  );
  // Only a completed read proves that no document owns the object.
  if (ownerError) return { success: false, error: 'load_failed' };
  if (owner) return { success: true };
  await discardStorageObjects({ organizationId: context.organizationId, paths: [storagePath] });
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
  const manager = await requireManagerRecord(request.employeeRecordId);
  let context: {
    admin: AdminClient;
    organizationId: string;
    actorId: string;
    affectedUserId: string | null;
  };
  if (manager.success) {
    if (request.accessClass !== 'personnel_standard' && manager.role !== 'admin') {
      return { success: false, error: 'not_authorized' };
    }
    context = { ...manager, affectedUserId: manager.userId };
  } else {
    const self = await getSelfContext();
    if (
      !self.success ||
      self.employeeRecordId !== request.employeeRecordId ||
      request.accessClass !== 'health_evidence'
    ) {
      return { success: false, error: 'not_authorized' };
    }
    context = { ...self, affectedUserId: self.actorId };
  }
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
  const head = await headStorageObject({ organizationId: context.organizationId, path: storagePath }).catch(
    () => null,
  );
  if (!head?.exists || !head.sizeBytes || head.sizeBytes <= 0)
    return { success: false, error: 'file_missing' };
  if (head.sizeBytes > DOCUMENT_MAX_FILE_SIZE_BYTES) {
    await discardStorageObjects({ organizationId: context.organizationId, paths: [storagePath] });
    return { success: false, error: 'file_too_large' };
  }
  const { data, error } = await context.admin.rpc('finalize_personnel_document_metadata', {
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
    p_valid_until: request.validUntil as string,
    p_operation_id: request.operationId,
    p_request_hash: hashRequest(request),
  });
  if (error || !data) {
    const normalized = normalizeDatabaseError(error);
    const { data: owner, error: ownerError } = await loggedRead(
      'finalizePersonnelDocumentUpload: documents read failed',
      context.admin
        .from('documents')
        .select('id')
        .eq('organization_id', context.organizationId)
        .eq('storage_path', storagePath)
        .maybeSingle(),
    );
    // Only a completed read proves that no document owns the object; a failed read keeps it.
    if (ownerError) return { success: false, error: normalized };
    if (!owner) await discardStorageObjects({ organizationId: context.organizationId, paths: [storagePath] });
    return { success: false, error: normalized };
  }
  revalidatePersonnel();
  return { success: true, data: { documentId: data } };
}

export async function getPersonnelDocumentSignedUrl(
  documentIdInput: string,
): Promise<LifecycleResult<{ signedUrl: string }>> {
  const parsedDocumentId = uuidSchema.safeParse(documentIdInput);
  if (!parsedDocumentId.success) return { success: false, error: 'invalid_input' };
  const documentId = parsedDocumentId.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const admin = createSupabaseAdminClient();
  const { data: document, error: documentError } = await loggedRead(
    'getPersonnelDocumentSignedUrl: personnel_documents read failed',
    admin
      // tenant-scope: by-id-then-verified — the document's organization must be one of the caller's memberships, checked below before a URL is signed
      .from('personnel_documents')
      .select(
        'access_class, employee_record_id, documents!inner(id, organization_id, storage_path, display_name, current_version_number, deleted_at), personnel_document_releases(document_version_number, revoked_at)',
      )
      .eq('document_id', documentId)
      .maybeSingle(),
  );
  if (documentError) return { success: false, error: 'load_failed' };
  if (!document) return { success: false, error: 'document_not_found' };
  const parsedFile = signedDocumentFileSchema.safeParse(document.documents);
  if (!parsedFile.success || parsedFile.data.deleted_at)
    return { success: false, error: 'document_not_found' };
  const file = parsedFile.data;
  const [memberships, prestartMemberships] = await Promise.all([
    getCachedMemberships(user.id),
    getCachedPrestartMemberships(user.id),
  ]);
  const membership = memberships.find((item) => item.orgId === file.organization_id);
  const hasOwnLifecycleAccess =
    Boolean(membership) || prestartMemberships.some((item) => item.orgId === file.organization_id);
  const { data: employee, error: employeeError } = await loggedRead(
    'getPersonnelDocumentSignedUrl: employee_records read failed',
    admin
      .from('employee_records')
      .select('user_id')
      .eq('organization_id', file.organization_id)
      .eq('id', document.employee_record_id)
      .maybeSingle(),
  );
  if (employeeError) return { success: false, error: 'load_failed' };
  const releases = (document.personnel_document_releases ?? []) as Array<{
    document_version_number: number;
    revoked_at: string | null;
  }>;
  const ownReleased =
    hasOwnLifecycleAccess &&
    employee?.user_id === user.id &&
    releases.some(
      (release) =>
        release.document_version_number === file.current_version_number && release.revoked_at === null,
    );
  const managerAllowed =
    membership?.role === 'admin' ||
    (membership?.role === 'buero' && document.access_class === 'personnel_standard');
  if (!ownReleased && !managerAllowed) return { success: false, error: 'not_authorized' };
  try {
    const signedUrl = await createSignedDownloadUrl({
      organizationId: file.organization_id,
      path: file.storage_path,
      disposition: 'attachment',
      downloadFileName: file.display_name,
    });
    return { success: true, data: { signedUrl } };
  } catch (error) {
    logError('Failed to sign personnel document download', error);
    return { success: false, error: 'download_failed' };
  }
}

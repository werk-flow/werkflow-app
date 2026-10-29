'use server';

import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import type { ActionFailure } from '@/lib/action-result';
import { getResponsibilitiesStrandedByMemberRemoval } from '@/lib/responsibilities/server';
import type { AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { Database, Json } from '@/lib/supabase/database.types';
import {
  accessTransitionInputSchema,
  acknowledgeDocumentInputSchema,
  acknowledgeRequirementInputSchema,
  employmentTransitionInputSchema,
  getEffectiveAccessState,
  type PersonnelAccessState,
  type PersonnelDocumentAccessClass,
  type PersonnelDocumentEvidenceState,
  type PersonnelEmploymentState,
  type PersonnelRequirementState,
  type PersonnelRequirementType,
} from './lifecycle';
import {
  getSelfContext,
  hashRequest,
  lifecycleFailureCode,
  requireManagerRecord,
  revalidatePersonnel,
  type LifecycleResult,
} from './lifecycle-action-context';
import {
  documentFileSchema,
  toTemplateSummaries,
  type PersonnelOnboardingTemplateSummary,
} from './lifecycle-rows';

type TransitionInventory = {
  activeJobs: Array<{ id: string; label: string }>;
  strandedResponsibilities: string[];
};

type EmploymentTransitionResult =
  | { success: true; data: { lifecycleId: string } }
  | (ActionFailure & { data?: TransitionInventory });

type RequirementRow = Database['public']['Tables']['personnel_onboarding_requirements']['Row'];
type AccessLifecycleRow = Database['public']['Tables']['personnel_access_lifecycles']['Row'];
type EmploymentLifecycleRow = Database['public']['Tables']['personnel_employment_lifecycles']['Row'];
type OnboardingPlanRow = Database['public']['Tables']['personnel_onboarding_plans']['Row'];
type PersonnelDocumentWithReleases = Database['public']['Tables']['personnel_documents']['Row'] & {
  documents: unknown;
  personnel_document_releases: ReadonlyArray<{ document_version_number: number; revoked_at: string | null }>;
};

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

function toAccessView(access: AccessLifecycleRow | null): PersonnelLifecycleView['access'] {
  return {
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
  };
}

function toEmploymentView(employment: EmploymentLifecycleRow | null): PersonnelLifecycleView['employment'] {
  return {
    id: employment?.id ?? null,
    state: employment?.state ?? null,
    effectiveOn: employment?.state_effective_on ?? null,
    scheduledState: employment?.scheduled_state ?? null,
    scheduledFor: employment?.scheduled_for ?? null,
    version: employment?.version ?? 0,
  };
}

function toPlanViews(
  plans: readonly OnboardingPlanRow[],
  requirements: readonly PersonnelLifecycleRequirement[],
): PersonnelLifecycleView['plans'] {
  return plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    state: plan.state,
    targetStartDate: plan.target_start_date,
    version: plan.version,
    requirements: requirements.filter((requirement) => requirement.planId === plan.id),
  }));
}

/** The documents a manager of `role` may see, each with whether its current version is released. */
function toManagerDocuments(
  documents: readonly PersonnelDocumentWithReleases[],
  role: 'admin' | 'buero',
): ProtectedPersonnelDocument[] {
  return documents
    .filter((document) => role === 'admin' || document.access_class === 'personnel_standard')
    .flatMap((document) => {
      const parsedFile = documentFileSchema.safeParse(document.documents);
      if (!parsedFile.success) return [];
      const file = parsedFile.data;
      const releases = document.personnel_document_releases;
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

import { z } from '@/lib/zod';
import type { Database } from '@/lib/supabase/database.types';
import {
  getEffectiveAccessState,
  type PersonnelAccessState,
  type PersonnelDocumentAccessClass,
  type PersonnelDocumentEvidenceState,
  type PersonnelEmploymentState,
  type PersonnelRequirementState,
  type PersonnelRequirementType,
} from './lifecycle';

// The views of the personnel lifecycle and the mapping of their rows.

type Tables = Database['public']['Tables'];
type RequirementRow = Tables['personnel_onboarding_requirements']['Row'];
type AccessLifecycleRow = Tables['personnel_access_lifecycles']['Row'];
type EmploymentLifecycleRow = Tables['personnel_employment_lifecycles']['Row'];
type OnboardingPlanRow = Tables['personnel_onboarding_plans']['Row'];
type PersonnelDocumentWithReleases = Tables['personnel_documents']['Row'] & {
  documents: unknown;
  personnel_document_releases: ReadonlyArray<{ document_version_number: number; revoked_at: string | null }>;
};

// The admin client is untyped, so embedded relations are parsed where they cross in.
export const documentFileSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  current_version_number: z.number(),
  deleted_at: z.string().nullable(),
});
const templateVersionsSchema = z.array(z.object({ id: z.string(), version_number: z.number() }));
const assignedJobSchema = z.object({ id: z.string(), title: z.string(), job_number: z.string().nullable() });

export function toActiveJobOptions(
  assignments: ReadonlyArray<{ jobs: unknown }>,
): Array<{ id: string; label: string }> {
  return assignments.flatMap((assignment) => {
    const job = assignedJobSchema.safeParse(assignment.jobs);
    if (!job.success) return [];
    const { id, title, job_number: jobNumber } = job.data;
    return [{ id, label: jobNumber ? `${jobNumber} · ${title}` : title }];
  });
}

export type PersonnelLifecycleRequirement = {
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

export type ProtectedPersonnelDocument = {
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

export type PersonnelLifecycleAccess = {
  id: string | null;
  state: PersonnelAccessState;
  storedState: PersonnelAccessState | null;
  effectiveAt: string | null;
  scheduledState: PersonnelAccessState | null;
  scheduledFor: string | null;
  version: number;
};

export type PersonnelLifecycleEmployment = {
  id: string | null;
  state: PersonnelEmploymentState | null;
  effectiveOn: string | null;
  scheduledState: PersonnelEmploymentState | null;
  scheduledFor: string | null;
  version: number;
};

export type PersonnelOnboardingPlanView = {
  id: string;
  name: string;
  state: Database['public']['Enums']['personnel_onboarding_plan_state'];
  targetStartDate: string | null;
  version: number;
  requirements: PersonnelLifecycleRequirement[];
};

export type PersonnelOnboardingTemplateSummary = {
  id: string;
  currentVersionId: string;
  name: string;
  description: string | null;
  state: Database['public']['Enums']['personnel_template_state'];
  currentVersionNumber: number;
  version: number;
};

type TemplateRow = Pick<
  Tables['personnel_onboarding_templates']['Row'],
  'id' | 'name' | 'description' | 'state' | 'current_version_number' | 'version'
> & { personnel_onboarding_template_versions: unknown };

/** The templates whose current version was read, each with that version's id. */
export function toTemplateSummaries(templates: readonly TemplateRow[]): PersonnelOnboardingTemplateSummary[] {
  return templates.flatMap((template) => {
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
  });
}

export function toRequirement(row: RequirementRow): PersonnelLifecycleRequirement {
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

export function toAccessView(access: AccessLifecycleRow | null): PersonnelLifecycleAccess {
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

export function toEmploymentView(employment: EmploymentLifecycleRow | null): PersonnelLifecycleEmployment {
  return {
    id: employment?.id ?? null,
    state: employment?.state ?? null,
    effectiveOn: employment?.state_effective_on ?? null,
    scheduledState: employment?.scheduled_state ?? null,
    scheduledFor: employment?.scheduled_for ?? null,
    version: employment?.version ?? 0,
  };
}

export function toPlanViews(
  plans: readonly OnboardingPlanRow[],
  requirements: readonly PersonnelLifecycleRequirement[],
): PersonnelOnboardingPlanView[] {
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
export function toManagerDocuments(
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

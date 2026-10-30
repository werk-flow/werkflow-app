'use server';

import { loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import type { CapabilityDefinition, JobQualificationDetail } from './types';
import { loadJobQualificationRows } from './qualification-reads';
import { loadAssignmentEvaluation, toCapabilityDefinition } from './server';
import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

// The capability requirements of a job or a project.

const capabilityRequirementsSchema = z
  .array(z.object({ capabilityId: uuidSchema, requireConfirmation: z.boolean() }))
  .max(200);
const jobRequirementsSchema = z.object({ jobId: uuidSchema, requirements: capabilityRequirementsSchema });
const projectRequirementsSchema = z.object({
  projectId: uuidSchema,
  requirements: capabilityRequirementsSchema,
  expectedRequirements: capabilityRequirementsSchema,
});

export async function setJobCapabilityRequirements(rawInput: {
  jobId: string;
  requirements: Array<{
    capabilityId: string;
    requireConfirmation: boolean;
  }>;
}): Promise<ActionResult> {
  const parsedInput = jobRequirementsSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: job, error: jobError } = await loggedRead(
    'setJobCapabilityRequirements: jobs read failed',
    admin
      .from('jobs')
      .select('id')
      .eq('id', input.jobId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (jobError) return { success: false, error: 'load_failed' };
  if (!job) return { success: false, error: 'job_not_found' };
  const normalized = [
    ...new Map(input.requirements.map((requirement) => [requirement.capabilityId, requirement])).values(),
  ];
  if (normalized.length > 100) {
    return { success: false, error: 'invalid_input' };
  }
  const { error } = await admin.rpc('replace_job_capability_requirements', {
    p_organization_id: auth.context.orgId,
    p_job_id: input.jobId,
    p_capability_ids: normalized.map((requirement) => requirement.capabilityId),
    p_require_confirmations: normalized.map((requirement) => requirement.requireConfirmation),
    p_actor_id: auth.context.userId,
  });
  if (error) {
    logError('Failed to replace job capability requirements:', error);
    return { success: false, error: 'update_failed' };
  }
  return { success: true };
}

// The job's requirements on active definitions, each named by its definition.
function toJobRequirements(
  rows: ReadonlyArray<{ id: string; capability_id: string; require_confirmation: boolean }>,
  definitionById: ReadonlyMap<string, CapabilityDefinition>,
): JobQualificationDetail['requirements'] {
  return rows.flatMap((row) => {
    const definition = definitionById.get(row.capability_id);
    return definition
      ? [
          {
            id: row.id,
            capabilityId: definition.id,
            capabilityName: definition.name,
            capabilityKind: definition.kind,
            requireConfirmation: row.require_confirmation,
          },
        ]
      : [];
  });
}

export async function getJobQualificationDetail(
  jobIdInput: string,
): Promise<{ success: true; data: JobQualificationDetail } | ActionFailure> {
  const parsedJobId = uuidSchema.safeParse(jobIdInput);
  if (!parsedJobId.success) return { success: false, error: 'invalid_input' };
  const jobId = parsedJobId.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();
  if (jobError || !job) {
    logReadErrors('getJobQualificationDetail: read failed', jobError);
    return { success: false, error: 'job_not_found' };
  }
  const rows = await loadJobQualificationRows(admin, auth.context.orgId, jobId);
  if (!rows) return { success: false, error: 'load_failed' };
  const evaluationResult = await loadAssignmentEvaluation({
    admin,
    orgId: auth.context.orgId,
    jobId,
    selectedUserIds: rows.assignedUserIds,
  });
  if (!evaluationResult.success) return evaluationResult;
  const definitions = rows.definitions.map(toCapabilityDefinition);
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  return {
    success: true,
    data: {
      capabilities: definitions,
      requirements: toJobRequirements(rows.requirements, definitionById),
      evaluation: evaluationResult.evaluation,
      latestAssessment: rows.latest
        ? {
            createdAt: rows.latest.created_at,
            overrideReason: rows.latest.override_reason,
            coverageFingerprint: rows.latest.coverage_fingerprint,
          }
        : null,
    },
  };
}

type ProjectCapabilityRequirement = {
  id: string;
  capability_id: string;
  require_confirmation: boolean;
};

type ProjectCapabilityRequirementsResult =
  | {
      success: true;
      data: {
        capabilities: CapabilityDefinition[];
        requirements: ProjectCapabilityRequirement[];
      };
    }
  | ActionFailure;

type SetProjectCapabilityRequirementsResult = ActionResult;

export async function getProjectCapabilityRequirements(
  projectIdInput: string,
): Promise<ProjectCapabilityRequirementsResult> {
  const parsedProjectId = uuidSchema.safeParse(projectIdInput);
  if (!parsedProjectId.success) return { success: false, error: 'invalid_input' };
  const projectId = parsedProjectId.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false as const, error: 'not_authorized' };
  const admin = createSupabaseAdminClient();
  const { data: project, error: projectError } = await loggedRead(
    'getProjectCapabilityRequirements: projects read failed',
    admin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (projectError) return { success: false as const, error: 'load_failed' };
  if (!project) return { success: false as const, error: 'project_not_found' };
  const [definitionsResult, requirementsResult] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_capabilities')
          .select('*')
          .eq('organization_id', auth.context.orgId)
          .is('retired_at', null)
          .order('name')
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    admin
      .from('job_capability_requirements')
      .select('id, capability_id, require_confirmation')
      .eq('organization_id', auth.context.orgId)
      .eq('project_id', projectId)
      .order('created_at')
      .limit(201),
  ]);
  // A project holds at most 200 requirements (the write path refuses more).
  if (definitionsResult.error || requirementsResult.error || (requirementsResult.data?.length ?? 0) > 200) {
    logError(
      'Failed to load project capability requirements:',
      definitionsResult.error ?? requirementsResult.error ?? { code: 'requirement_overflow' },
    );
    return { success: false as const, error: 'load_failed' };
  }
  return {
    success: true as const,
    data: {
      capabilities: definitionsResult.data.map(toCapabilityDefinition),
      requirements: requirementsResult.data ?? [],
    },
  };
}

export async function setProjectCapabilityRequirements(rawInput: {
  projectId: string;
  requirements: Array<{ capabilityId: string; requireConfirmation: boolean }>;
  expectedRequirements: Array<{ capabilityId: string; requireConfirmation: boolean }>;
}): Promise<SetProjectCapabilityRequirementsResult> {
  const parsedInput = projectRequirementsSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false as const, error: 'not_authorized' };
  const normalized = [
    ...new Map(input.requirements.map((requirement) => [requirement.capabilityId, requirement])).values(),
  ].sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  const expected = [
    ...new Map(
      input.expectedRequirements.map((requirement) => [requirement.capabilityId, requirement]),
    ).values(),
  ].sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  if (normalized.length > 200) return { success: false as const, error: 'invalid_input' };
  const { error } = await createSupabaseAdminClient().rpc('replace_project_capability_requirements_checked', {
    p_organization_id: auth.context.orgId,
    p_project_id: input.projectId,
    p_capability_ids: normalized.map((requirement) => requirement.capabilityId),
    p_require_confirmations: normalized.map((requirement) => requirement.requireConfirmation),
    p_expected_capability_ids: expected.map((requirement) => requirement.capabilityId),
    p_expected_require_confirmations: expected.map((requirement) => requirement.requireConfirmation),
    p_actor_id: auth.context.userId,
  });
  if (error) {
    return {
      success: false as const,
      error: error.message.includes('project_capability_requirements_conflict')
        ? 'conflict'
        : 'update_failed',
    };
  }
  return { success: true as const };
}

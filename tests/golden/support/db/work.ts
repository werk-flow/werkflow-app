import { randomUUID } from 'node:crypto';

import { parseWorkLifecycleSnapshot } from '../../../../lib/work-lifecycle/types';
import { createAdminClient } from './shared';

export type SeedWorkTemplateItem = {
  content: string;
  itemKind?: 'task' | 'checklist';
  requirementState?: 'required' | 'optional';
  groupLabel?: string;
  evidenceDescription?: string;
  /** Content of an earlier item in the same list that this item depends on. */
  dependsOn?: string;
};

/**
 * Publishes version 1 of a work template through the same RPCs the manager
 * actions call. Only the uncached pickers (creation and application) see it at
 * once: the cached template list on /arbeitsvorlagen refreshes on the next
 * manager mutation, so a test that needs the list creates its template there.
 */
export async function seedPublishedWorkTemplate(input: {
  orgId: string;
  actorId: string;
  name: string;
  targetType: 'job' | 'project';
  items: readonly SeedWorkTemplateItem[];
  material?: { itemId: string; locationId: string | null; plannedQuantity: number };
  capability?: { capabilityId: string; requireConfirmation: boolean };
}): Promise<{ templateId: string; versionId: string }> {
  const admin = createAdminClient();
  const { data: templateId, error: createError } = await admin.rpc('create_work_template', {
    p_organization_id: input.orgId,
    p_target_type: input.targetType,
    p_name: input.name,
    p_actor_id: input.actorId,
  });
  if (createError || !templateId) throw new Error(`Work template seed failed: ${createError?.message}`);
  const items = input.items.map((item, index) => ({ ...item, id: randomUUID(), sortOrder: index }));
  const itemId = (content: string): string => {
    const match = items.find((item) => item.content === content);
    if (!match) throw new Error(`Work template seed: no item named ${content}.`);
    return match.id;
  };
  const { error: saveError } = await admin.rpc('save_work_template_draft', {
    p_organization_id: input.orgId,
    p_template_id: templateId,
    p_actor_id: input.actorId,
    p_name: input.name,
    p_items: items.map((item) => ({
      id: item.id,
      item_kind: item.itemKind ?? 'task',
      content: item.content,
      requirement_state: item.requirementState ?? 'required',
      group_label: item.groupLabel ?? null,
      notes: null,
      sort_order: item.sortOrder,
    })),
    p_evidence: items.flatMap((item) =>
      item.evidenceDescription
        ? [
            {
              id: randomUUID(),
              template_item_id: item.id,
              description: item.evidenceDescription,
              document_category: 'report',
              sort_order: 0,
            },
          ]
        : [],
    ),
    p_dependencies: items.flatMap((item) =>
      item.dependsOn
        ? [{ id: randomUUID(), predecessor_item_id: itemId(item.dependsOn), dependent_item_id: item.id }]
        : [],
    ),
    p_materials: input.material
      ? [
          {
            id: randomUUID(),
            item_id: input.material.itemId,
            preferred_location_id: input.material.locationId,
            planned_quantity: input.material.plannedQuantity,
            is_billable: false,
            notes: null,
            sort_order: 0,
          },
        ]
      : [],
    p_capabilities: input.capability
      ? [
          {
            id: randomUUID(),
            capability_id: input.capability.capabilityId,
            require_confirmation: input.capability.requireConfirmation,
            sort_order: 0,
          },
        ]
      : [],
  });
  if (saveError) throw new Error(`Work template draft seed failed: ${saveError.message}`);
  const { data: versionId, error: publishError } = await admin.rpc('publish_work_template', {
    p_organization_id: input.orgId,
    p_template_id: templateId,
    p_actor_id: input.actorId,
  });
  if (publishError || !versionId)
    throw new Error(`Work template publish seed failed: ${publishError?.message}`);
  return { templateId, versionId };
}

export async function getWorkTemplateStateByName(orgId: string, name: string) {
  const admin = createAdminClient();
  const { data: matchedVersion, error: matchError } = await admin
    .from('work_template_versions')
    .select('template_id')
    .eq('organization_id', orgId)
    .eq('name', name)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (matchError || !matchedVersion)
    throw new Error(`No work template found for ${name}: ${matchError?.message}`);
  const templateId = matchedVersion.template_id as string;
  const { data: versions, error } = await admin
    .from('work_template_versions')
    .select('id, template_id, version_number, status, name, published_at')
    .eq('organization_id', orgId)
    .eq('template_id', templateId)
    .order('version_number');
  if (error || !versions?.length)
    throw new Error(`No work template versions found for ${name}: ${error?.message}`);
  const versionIds = versions.map((version) => version.id as string);
  const [
    templateResult,
    itemsResult,
    evidenceResult,
    dependenciesResult,
    materialResult,
    capabilityResult,
    eventsResult,
  ] = await Promise.all([
    admin
      .from('work_templates')
      .select('id, target_type, draft_version_id, current_published_version_id, archived_at')
      .eq('organization_id', orgId)
      .eq('id', templateId)
      .single(),
    admin
      .from('work_template_items')
      .select('id, version_id, content, item_kind, requirement_state, group_label, notes, sort_order')
      .eq('organization_id', orgId)
      .in('version_id', versionIds)
      .order('sort_order'),
    admin
      .from('work_template_item_evidence_requirements')
      .select('version_id, template_item_id, description, document_category')
      .eq('organization_id', orgId)
      .in('version_id', versionIds),
    admin
      .from('work_template_item_dependencies')
      .select('version_id, predecessor_item_id, dependent_item_id')
      .eq('organization_id', orgId)
      .in('version_id', versionIds),
    admin
      .from('work_template_material_lines')
      .select('version_id, item_id, preferred_location_id, planned_quantity, is_billable, notes')
      .eq('organization_id', orgId)
      .in('version_id', versionIds),
    admin
      .from('work_template_capability_requirements')
      .select('version_id, capability_id, require_confirmation')
      .eq('organization_id', orgId)
      .in('version_id', versionIds),
    admin
      .from('work_template_events')
      .select('event_type, template_version_id, application_id, event_payload, actor_id, created_at')
      .eq('organization_id', orgId)
      .eq('template_id', templateId)
      .order('created_at'),
  ]);
  const firstError = [
    templateResult,
    itemsResult,
    evidenceResult,
    dependenciesResult,
    materialResult,
    capabilityResult,
    eventsResult,
  ].find((result) => result.error)?.error;
  if (firstError || !templateResult.data)
    throw new Error(`Work template state failed: ${firstError?.message}`);
  return {
    template: templateResult.data,
    versions,
    items: itemsResult.data ?? [],
    evidence: evidenceResult.data ?? [],
    dependencies: dependenciesResult.data ?? [],
    materials: materialResult.data ?? [],
    capabilities: capabilityResult.data ?? [],
    events: eventsResult.data ?? [],
  };
}

export async function getAppliedWorkTemplateState(
  orgId: string,
  input: { jobNumber?: string; projectNumber?: string },
) {
  if (Number(Boolean(input.jobNumber)) + Number(Boolean(input.projectNumber)) !== 1) {
    throw new Error('Applied work-template lookup requires exactly one target number.');
  }
  const admin = createAdminClient();
  const targetTable = input.jobNumber ? 'jobs' : 'projects';
  const numberColumn = input.jobNumber ? 'job_number' : 'project_number';
  const targetNumber = input.jobNumber ?? input.projectNumber;
  if (!targetNumber) throw new Error('Applied work-template target number is missing.');
  const { data: target, error: targetError } = await admin
    .from(targetTable)
    .select('id')
    .eq('organization_id', orgId)
    .eq(numberColumn, targetNumber)
    .single();
  if (targetError || !target) throw new Error(`Applied target lookup failed: ${targetError?.message}`);
  const targetId = target.id as string;
  const isJob = Boolean(input.jobNumber);
  const [
    applications,
    instructions,
    materials,
    capabilities,
    movements,
    occurrences,
    assignments,
    timeEntries,
    timeSegments,
    documentLinks,
    assessments,
    projectJobs,
  ] = await Promise.all([
    admin
      .from('work_template_applications')
      .select('id, template_id, template_version_id, applied_by, applied_at')
      .eq('organization_id', orgId)
      .eq(isJob ? 'job_id' : 'project_id', targetId),
    admin
      .from('job_instruction_items')
      .select(
        'id, content, item_kind, requirement_state, group_label, notes, is_completed, last_status_changed_by, last_status_changed_at, work_template_application_id, source_work_template_item_id',
      )
      .eq('organization_id', orgId)
      .eq(isJob ? 'job_id' : 'project_id', targetId)
      .order('sort_order'),
    admin
      .from('job_material_lines')
      .select(
        'id, item_id, preferred_location_id, planned_quantity, taken_quantity, returned_quantity, is_billable, notes, work_template_application_id, source_work_template_material_line_id',
      )
      .eq('organization_id', orgId)
      .eq(isJob ? 'job_id' : 'project_id', targetId),
    admin
      .from('job_capability_requirements')
      .select('id, capability_id, require_confirmation, job_id, project_id')
      .eq('organization_id', orgId)
      .eq(isJob ? 'job_id' : 'project_id', targetId),
    admin
      .from('inventory_movements')
      .select('id')
      .eq('organization_id', orgId)
      .eq(isJob ? 'job_id' : 'project_id', targetId),
    isJob
      ? admin.from('planning_occurrences').select('id').eq('organization_id', orgId).eq('job_id', targetId)
      : Promise.resolve({ data: [], error: null }),
    isJob
      ? admin.from('job_assignments').select('id, user_id').eq('job_id', targetId)
      : Promise.resolve({ data: [], error: null }),
    isJob
      ? admin.from('time_entries').select('id').eq('organization_id', orgId).eq('job_id', targetId)
      : Promise.resolve({ data: [], error: null }),
    isJob
      ? admin.from('time_segments').select('id').eq('organization_id', orgId).eq('job_id', targetId)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from('document_links')
      .select('id')
      .eq('organization_id', orgId)
      .eq(isJob ? 'job_id' : 'project_id', targetId),
    isJob
      ? admin
          .from('job_qualification_assessments')
          .select('id, coverage_fingerprint, override_reason, created_at')
          .eq('organization_id', orgId)
          .eq('job_id', targetId)
      : Promise.resolve({ data: [], error: null }),
    !isJob
      ? admin.from('jobs').select('id').eq('organization_id', orgId).eq('project_id', targetId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const instructionIds = (instructions.data ?? []).map((item) => item.id as string);
  const requirementIds = (capabilities.data ?? []).map((item) => item.id as string);
  const [evidence, dependencies, capabilityOrigins] = await Promise.all([
    instructionIds.length
      ? admin
          .from('job_instruction_item_evidence_requirements')
          .select('id, instruction_item_id, description, document_category, source_work_template_evidence_id')
          .eq('organization_id', orgId)
          .in('instruction_item_id', instructionIds)
      : Promise.resolve({ data: [], error: null }),
    instructionIds.length
      ? admin
          .from('job_instruction_item_dependencies')
          .select('id, predecessor_item_id, dependent_item_id, source_work_template_dependency_id')
          .eq('organization_id', orgId)
          .in('dependent_item_id', instructionIds)
      : Promise.resolve({ data: [], error: null }),
    requirementIds.length
      ? admin
          .from('job_capability_requirement_origins')
          .select('id, requirement_id, work_template_application_id, source_work_template_requirement_id')
          .eq('organization_id', orgId)
          .in('requirement_id', requirementIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const firstError = [
    applications,
    instructions,
    materials,
    capabilities,
    movements,
    occurrences,
    assignments,
    timeEntries,
    timeSegments,
    documentLinks,
    assessments,
    projectJobs,
    evidence,
    dependencies,
    capabilityOrigins,
  ].find((result) => result.error)?.error;
  if (firstError) throw new Error(`Applied work template state failed: ${firstError.message}`);
  return {
    targetId,
    applications: applications.data ?? [],
    instructions: instructions.data ?? [],
    evidence: evidence.data ?? [],
    dependencies: dependencies.data ?? [],
    materials: materials.data ?? [],
    capabilities: capabilities.data ?? [],
    capabilityOrigins: capabilityOrigins.data ?? [],
    inventoryMovements: movements.data ?? [],
    planningOccurrences: occurrences.data ?? [],
    assignments: assignments.data ?? [],
    timeEntries: timeEntries.data ?? [],
    timeSegments: timeSegments.data ?? [],
    documentLinks: documentLinks.data ?? [],
    qualificationAssessments: assessments.data ?? [],
    projectJobs: projectJobs.data ?? [],
  };
}

export async function getWorkTemplateApplicationCountForTarget(
  orgId: string,
  input: { jobId?: string; projectId?: string },
): Promise<number> {
  if (Number(Boolean(input.jobId)) + Number(Boolean(input.projectId)) !== 1)
    throw new Error('Work template application count requires exactly one target id.');
  const targetId = input.jobId ?? input.projectId;
  if (!targetId) throw new Error('Work template application count target is missing.');
  const { count, error } = await createAdminClient()
    .from('work_template_applications')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq(input.jobId ? 'job_id' : 'project_id', targetId);
  if (error) throw new Error(`Work template application count failed: ${error.message}`);
  return count ?? 0;
}

export async function getJobCountByNumber(orgId: string, jobNumber: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('job_number', jobNumber);
  if (error) throw new Error(`Job count failed: ${error.message}`);
  return count ?? 0;
}

export async function getJobProjectNumber(orgId: string, jobNumber: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('project_id')
    .eq('organization_id', orgId)
    .eq('job_number', jobNumber)
    .single();
  if (jobError || !job) {
    throw new Error(`Job ${jobNumber} missing: ${jobError?.message}`);
  }
  if (!job.project_id) return null;

  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('project_number')
    .eq('organization_id', orgId)
    .eq('id', job.project_id)
    .single();
  if (projectError || !project) {
    throw new Error(`Project for ${jobNumber} missing: ${projectError?.message}`);
  }
  return project.project_number as string;
}

export async function getProjectJobRelationState(
  orgId: string,
  projectNumber: string,
  jobNumbers: string[],
): Promise<{
  projectId: string;
  clientId: string | null;
  siteId: string | null;
  contactId: string | null;
  jobs: Array<{
    jobNumber: string;
    projectId: string | null;
    clientId: string | null;
    siteId: string | null;
    contactId: string | null;
  }>;
}> {
  const admin = createAdminClient();
  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('id,client_id,site_id,contact_id')
    .eq('organization_id', orgId)
    .eq('project_number', projectNumber)
    .single();
  if (projectError || !project) {
    throw new Error(`Project ${projectNumber} not found: ${projectError?.message}`);
  }
  const { data: jobs, error: jobsError } = await admin
    .from('jobs')
    .select('job_number,project_id,client_id,site_id,contact_id')
    .eq('organization_id', orgId)
    .in('job_number', jobNumbers)
    .order('job_number');
  if (jobsError) throw new Error(`Project jobs could not be read: ${jobsError.message}`);
  return {
    projectId: project.id as string,
    clientId: (project.client_id as string | null) ?? null,
    siteId: (project.site_id as string | null) ?? null,
    contactId: (project.contact_id as string | null) ?? null,
    jobs: (jobs ?? []).map((job) => ({
      jobNumber: job.job_number as string,
      projectId: (job.project_id as string | null) ?? null,
      clientId: (job.client_id as string | null) ?? null,
      siteId: (job.site_id as string | null) ?? null,
      contactId: (job.contact_id as string | null) ?? null,
    })),
  };
}

export async function getJobSiteContactState(
  orgId: string,
  jobNumber: string,
): Promise<{ siteId: string | null; contactId: string | null }> {
  const { data, error } = await createAdminClient()
    .from('jobs')
    .select('site_id,contact_id')
    .eq('organization_id', orgId)
    .eq('job_number', jobNumber)
    .single();
  if (error || !data) {
    throw new Error(`Job ${jobNumber} not found: ${error?.message}`);
  }
  return {
    siteId: (data.site_id as string | null) ?? null,
    contactId: (data.contact_id as string | null) ?? null,
  };
}

export async function getWorkLifecycleState(
  orgId: string,
  target: { jobNumber: string } | { projectNumber: string },
) {
  const admin = createAdminClient();
  const isJob = 'jobNumber' in target;
  const entityResult = isJob
    ? await admin
        .from('jobs')
        .select('id, execution_state, execution_version, status')
        .eq('organization_id', orgId)
        .eq('job_number', target.jobNumber)
        .single()
    : await admin
        .from('projects')
        .select('id, execution_state_override, execution_version, status_override')
        .eq('organization_id', orgId)
        .eq('project_number', target.projectNumber)
        .single();
  if (entityResult.error) {
    throw new Error(`Lifecycle target lookup failed: ${entityResult.error.message}`);
  }
  const targetId = entityResult.data.id;
  const targetColumn = isJob ? 'job_id' : 'project_id';
  const dependentColumn = isJob ? 'dependent_job_id' : 'dependent_project_id';
  const { data: actor, error: actorError } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('role', 'admin')
    .limit(1)
    .single();
  if (actorError || !actor) {
    throw new Error(`Lifecycle actor lookup failed: ${actorError?.message}`);
  }
  const [blockers, dependencies, executionEvents, snapshotResult] = await Promise.all([
    admin
      .from('work_blockers')
      .select(
        'id, kind, reason, details, responsible_employee_record_id, next_review_date, state, version, resolution_note, parent_project_parking_blocker_id',
      )
      .eq('organization_id', orgId)
      .eq(targetColumn, targetId)
      .order('created_at')
      .order('id'),
    admin
      .from('work_dependencies')
      .select(
        'id, effect, declared_kind, description, manual_state, removed_at, version, predecessor_job_id, predecessor_project_id, predecessor_instruction_item_id, artifact_approval_action_id',
      )
      .eq('organization_id', orgId)
      .eq(dependentColumn, targetId)
      .order('created_at')
      .order('id'),
    admin
      .from('work_execution_events')
      .select(
        'event_type, from_state, to_state, reason, gate_snapshot, gate_fingerprint, previous_version, resulting_version, created_by',
      )
      .eq('organization_id', orgId)
      .eq(targetColumn, targetId)
      .order('created_at')
      .order('id'),
    admin.rpc('get_work_lifecycle_snapshot', {
      p_organization_id: orgId,
      p_actor_id: actor.user_id,
      p_target_type: isJob ? 'job' : 'project',
      p_target_id: targetId,
    }),
  ]);
  const error = blockers.error ?? dependencies.error ?? executionEvents.error ?? snapshotResult.error;
  if (error) throw new Error(`Lifecycle state lookup failed: ${error.message}`);
  const snapshot = parseWorkLifecycleSnapshot(snapshotResult.data);
  if (!snapshot.success) {
    throw new Error(`Lifecycle snapshot parsing failed: ${snapshot.error}`);
  }
  const satisfactionByDependencyId = new Map(
    snapshot.snapshot.dependencies.map((dependency) => [dependency.id, dependency.is_satisfied]),
  );
  return {
    entity: entityResult.data,
    snapshot: snapshot.snapshot,
    blockers: blockers.data ?? [],
    dependencies: (dependencies.data ?? []).map((dependency) => ({
      ...dependency,
      state: dependency.removed_at ? 'removed' : (dependency.manual_state ?? 'open'),
      isSatisfied: satisfactionByDependencyId.get(dependency.id) ?? null,
    })),
    executionEvents: executionEvents.data ?? [],
  };
}

export async function getWorkArtifactState(
  orgId: string,
  target: { jobNumber: string } | { projectNumber: string },
) {
  const admin = createAdminClient();
  const isJob = 'jobNumber' in target;
  const targetResult = isJob
    ? await admin
        .from('jobs')
        .select('id')
        .eq('organization_id', orgId)
        .eq('job_number', target.jobNumber)
        .single()
    : await admin
        .from('projects')
        .select('id')
        .eq('organization_id', orgId)
        .eq('project_number', target.projectNumber)
        .single();
  if (targetResult.error) throw new Error(`Artifact target lookup failed: ${targetResult.error.message}`);
  const targetColumn = isJob ? 'job_id' : 'project_id';
  const { data: artifacts, error: artifactError } = await admin
    .from('work_artifacts')
    .select('*')
    .eq('organization_id', orgId)
    .eq(targetColumn, targetResult.data.id)
    .order('created_at')
    .limit(101);
  if (artifactError || (artifacts?.length ?? 0) > 100)
    throw new Error(`Artifact lookup failed: ${artifactError?.message ?? 'overflow'}`);
  const artifactIds = (artifacts ?? []).map((artifact) => artifact.id);
  if (!artifactIds.length)
    return {
      artifacts: [],
      revisions: [],
      actions: [],
      measurements: [],
      defects: [],
      changes: [],
      documents: [],
      sources: [],
      fulfillments: [],
    };
  const [revisions, actions] = await Promise.all([
    admin
      .from('work_artifact_revisions')
      .select('*')
      .in('artifact_id', artifactIds)
      .order('revision_number')
      .limit(101),
    admin
      .from('work_artifact_actions')
      .select('*')
      .in('artifact_id', artifactIds)
      .order('created_at')
      .order('id')
      .limit(101),
  ]);
  if (
    revisions.error ||
    actions.error ||
    (revisions.data?.length ?? 0) > 100 ||
    (actions.data?.length ?? 0) > 100
  ) {
    throw new Error(
      `Artifact ledger lookup failed: ${(revisions.error ?? actions.error)?.message ?? 'overflow'}`,
    );
  }
  const revisionIds = (revisions.data ?? []).map((revision) => revision.id);
  const [measurements, defects, changes, documents, sources, fulfillments] = await Promise.all([
    admin
      .from('work_artifact_measurement_lines')
      .select('*')
      .in('revision_id', revisionIds)
      .order('line_number'),
    admin.from('work_artifact_defect_details').select('*').in('revision_id', revisionIds),
    admin.from('work_artifact_change_details').select('*').in('revision_id', revisionIds),
    admin
      .from('work_artifact_revision_documents')
      .select('*')
      .in('revision_id', revisionIds)
      .order('created_at'),
    admin
      .from('work_artifact_revision_sources')
      .select('*')
      .in('revision_id', revisionIds)
      .order('created_at'),
    admin
      .from('job_instruction_item_evidence_fulfillments')
      .select('*')
      .in('artifact_revision_id', revisionIds),
  ]);
  const error =
    measurements.error ??
    defects.error ??
    changes.error ??
    documents.error ??
    sources.error ??
    fulfillments.error;
  if (error) throw new Error(`Artifact detail lookup failed: ${error.message}`);
  return {
    artifacts: artifacts ?? [],
    revisions: revisions.data ?? [],
    actions: actions.data ?? [],
    measurements: measurements.data ?? [],
    defects: defects.data ?? [],
    changes: changes.data ?? [],
    documents: documents.data ?? [],
    sources: sources.data ?? [],
    fulfillments: fulfillments.data ?? [],
  };
}

export async function getWorkHandoverState(
  orgId: string,
  target: { jobNumber: string } | { projectNumber: string },
) {
  const admin = createAdminClient();
  const isJob = 'jobNumber' in target;
  const targetResult = isJob
    ? await admin
        .from('jobs')
        .select('id, execution_state, execution_version')
        .eq('organization_id', orgId)
        .eq('job_number', target.jobNumber)
        .single()
    : await admin
        .from('projects')
        .select('id, execution_state_override, execution_version')
        .eq('organization_id', orgId)
        .eq('project_number', target.projectNumber)
        .single();
  if (targetResult.error) {
    throw new Error(`Handover target lookup failed: ${targetResult.error.message}`);
  }
  const targetColumn = isJob ? 'job_id' : 'project_id';
  const packageResult = await admin
    .from('work_handover_packages')
    .select('*')
    .eq('organization_id', orgId)
    .eq(targetColumn, targetResult.data.id)
    .maybeSingle();
  if (packageResult.error) {
    throw new Error(`Handover package lookup failed: ${packageResult.error.message}`);
  }
  if (!packageResult.data) {
    return {
      target: targetResult.data,
      package: null,
      draftItems: [],
      releases: [],
      releaseItems: [],
      events: [],
      documents: [],
    };
  }
  const packageId = packageResult.data.id;
  const [draftResult, releaseResult, eventResult] = await Promise.all([
    admin
      .from('work_handover_draft_items')
      .select('*')
      .eq('organization_id', orgId)
      .eq('package_id', packageId)
      .order('sort_order'),
    admin
      .from('work_handover_releases')
      .select('*')
      .eq('organization_id', orgId)
      .eq('package_id', packageId)
      .order('release_number'),
    admin
      .from('work_handover_events')
      .select('*')
      .eq('organization_id', orgId)
      .eq('package_id', packageId)
      .order('created_at')
      .order('id'),
  ]);
  const firstError = draftResult.error ?? releaseResult.error ?? eventResult.error;
  if (firstError) throw new Error(`Handover ledger lookup failed: ${firstError.message}`);
  const releaseIds = (releaseResult.data ?? []).map((release) => release.id);
  const documentIds = (releaseResult.data ?? [])
    .map((release) => release.package_document_id)
    .filter((documentId): documentId is string => Boolean(documentId));
  const [itemResult, documentResult] = await Promise.all([
    releaseIds.length
      ? admin
          .from('work_handover_release_items')
          .select('*')
          .eq('organization_id', orgId)
          .in('release_id', releaseIds)
          .order('release_id')
          .order('sort_order')
      : Promise.resolve({ data: [], error: null }),
    documentIds.length
      ? admin
          .from('documents')
          .select('id, storage_path, display_name, current_version_number, size_bytes')
          .eq('organization_id', orgId)
          .in('id', documentIds)
          .order('id')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (itemResult.error || documentResult.error) {
    throw new Error(`Handover release lookup failed: ${(itemResult.error ?? documentResult.error)?.message}`);
  }
  return {
    target: targetResult.data,
    package: packageResult.data,
    draftItems: draftResult.data ?? [],
    releases: releaseResult.data ?? [],
    releaseItems: itemResult.data ?? [],
    events: eventResult.data ?? [],
    documents: documentResult.data ?? [],
  };
}

export async function getJobNumberById(orgId: string, jobId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('jobs')
    .select('job_number')
    .eq('organization_id', orgId)
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(`Job number lookup failed: ${error.message}`);
  return data?.job_number ?? null;
}

/** Inserts a project for a customer as the actor; a test that claims a later work flow starts here. */
export async function seedProject(input: {
  orgId: string;
  actorId: string;
  projectNumber: string;
  name: string;
  clientId?: string;
  siteId?: string;
  contactId?: string;
}): Promise<string> {
  const { data } = await createAdminClient()
    .from('projects')
    .insert({
      organization_id: input.orgId,
      created_by: input.actorId,
      project_number: input.projectNumber,
      name: input.name,
      client_id: input.clientId ?? null,
      site_id: input.siteId ?? null,
      contact_id: input.contactId ?? null,
    })
    .select('id')
    .single()
    .throwOnError();
  return data.id;
}

/** Inserts an unplanned, unassigned job as the actor. */
export async function seedJob(input: {
  orgId: string;
  actorId: string;
  jobNumber: string;
  title: string;
  clientId?: string;
  siteId?: string;
  contactId?: string;
  projectId?: string;
}): Promise<string> {
  const { data } = await createAdminClient()
    .from('jobs')
    .insert({
      organization_id: input.orgId,
      created_by: input.actorId,
      job_number: input.jobNumber,
      title: input.title,
      client_id: input.clientId ?? null,
      site_id: input.siteId ?? null,
      contact_id: input.contactId ?? null,
      project_id: input.projectId ?? null,
    })
    .select('id')
    .single()
    .throwOnError();
  return data.id;
}

/** Assigns a user to a seeded job as the actor, the row the field work pack and job visibility read. */
export async function seedJobAssignment(input: {
  orgId: string;
  actorId: string;
  jobId: string;
  userId: string;
}): Promise<void> {
  await createAdminClient()
    .from('job_assignments')
    .insert({
      job_id: input.jobId,
      organization_id: input.orgId,
      assigned_by: input.actorId,
      user_id: input.userId,
    })
    .throwOnError();
}

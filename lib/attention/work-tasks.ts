import 'server-only';

// The work-artifact and work-handover task derivations behind the attention
// Server Actions in `./actions`. Like every derivation there, they read the
// owning domains through the caller's organization and never mutate state.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ActionContext } from '@/lib/org/action-context';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { getEffectiveResponsibilityHolderForActor } from '@/lib/responsibilities/server';
import { resolveProjectHandoverExecutionState } from '@/lib/work-handover/project-state';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { Tables } from '@/lib/supabase/database.types';
import { logError } from '@/lib/logging';
import type { AttentionTask } from './types';

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
type DerivedTasks = { tasks: AttentionTask[]; failed: boolean };

type WorkArtifactAttentionRow = Pick<
  Tables<'work_artifacts'>,
  'id' | 'job_id' | 'project_id' | 'status' | 'kind' | 'current_revision_id' | 'version'
>;
type WorkArtifactRevisionAttentionRow = Pick<
  Tables<'work_artifact_revisions'>,
  'id' | 'title' | 'kind' | 'revision_number' | 'created_by'
>;
type WorkDefectAttentionRow = Pick<
  Tables<'work_artifact_defect_details'>,
  'revision_id' | 'due_date' | 'severity' | 'state' | 'responsible_employee_record_id'
>;
type HandoverJobRow = Pick<
  Tables<'jobs'>,
  'id' | 'job_number' | 'title' | 'execution_version' | 'project_id'
>;
type HandoverProjectRow = Pick<
  Tables<'projects'>,
  'id' | 'project_number' | 'name' | 'execution_version' | 'execution_state_override' | 'status_override'
>;

/** The jobs, projects, own employee record, and assignments that decide who may see an artifact task. */
async function readWorkArtifactAttentionTargets(
  admin: SupabaseAdminClient,
  context: ActionContext,
  isManager: boolean,
  artifacts: WorkArtifactAttentionRow[],
) {
  const jobIds = [...new Set(artifacts.flatMap((artifact) => (artifact.job_id ? [artifact.job_id] : [])))];
  const projectIds = [
    ...new Set(artifacts.flatMap((artifact) => (artifact.project_id ? [artifact.project_id] : []))),
  ];
  // Managers see every target; others need an assignment on the artifacts' jobs or projects only.
  const noAssignments = { data: [], error: null };
  const [jobsResult, projectsResult, ownRecordResult, jobAssignmentsResult, projectAssignmentsResult] =
    await Promise.all([
      readInBatches(jobIds, (batch) =>
        admin
          .from('jobs')
          .select('id, project_id, title, description, job_number')
          .eq('organization_id', context.orgId)
          .in('id', [...batch]),
      ),
      readInBatches(projectIds, (batch) =>
        admin
          .from('projects')
          .select('id, name, description, project_number')
          .eq('organization_id', context.orgId)
          .in('id', [...batch]),
      ),
      admin
        .from('employee_records')
        .select('id')
        .eq('organization_id', context.orgId)
        .eq('user_id', context.userId)
        .maybeSingle(),
      isManager
        ? noAssignments
        : readInBatches(jobIds, (batch) =>
            admin
              .from('job_assignments')
              .select('job_id')
              .eq('organization_id', context.orgId)
              .eq('user_id', context.userId)
              .in('job_id', [...batch]),
          ),
      isManager
        ? noAssignments
        : readInBatches(projectIds, (batch) =>
            admin
              .from('job_assignments')
              .select('job_id, jobs!inner(project_id, organization_id)')
              .eq('organization_id', context.orgId)
              .eq('user_id', context.userId)
              .eq('jobs.organization_id', context.orgId)
              .in('jobs.project_id', [...batch]),
          ),
    ]);
  const failure =
    jobsResult.error ??
    projectsResult.error ??
    ownRecordResult.error ??
    jobAssignmentsResult.error ??
    projectAssignmentsResult.error;
  if (failure) {
    logError('Failed to load work artifact attention targets', failure);
    return null;
  }

  return {
    jobs: new Map((jobsResult.data ?? []).map((job) => [job.id, job])),
    projects: new Map((projectsResult.data ?? []).map((project) => [project.id, project])),
    ownRecord: ownRecordResult.data,
    assignedJobIds: new Set((jobAssignmentsResult.data ?? []).map((assignment) => assignment.job_id)),
    assignedProjectIds: new Set(
      (projectAssignmentsResult.data ?? []).flatMap((assignment) => {
        const joined = Array.isArray(assignment.jobs) ? assignment.jobs[0] : assignment.jobs;
        return joined?.project_id ? [joined.project_id] : [];
      }),
    ),
  };
}

function toWorkArtifactTasks(
  context: ActionContext,
  isManager: boolean,
  isApprovalHolder: boolean,
  artifacts: WorkArtifactAttentionRow[],
  revisionRows: WorkArtifactRevisionAttentionRow[],
  defectRows: WorkDefectAttentionRow[],
  targets: NonNullable<Awaited<ReturnType<typeof readWorkArtifactAttentionTargets>>>,
): AttentionTask[] {
  const revisions = new Map(revisionRows.map((revision) => [revision.id, revision]));
  const defects = new Map(defectRows.map((defect) => [defect.revision_id, defect]));
  const { jobs, projects, ownRecord, assignedJobIds, assignedProjectIds } = targets;
  const tasks: AttentionTask[] = [];

  for (const artifact of artifacts) {
    if (!artifact.current_revision_id) continue;
    const revision = revisions.get(artifact.current_revision_id);
    if (!revision) continue;
    const job = artifact.job_id ? jobs.get(artifact.job_id) : undefined;
    const project = artifact.project_id ? projects.get(artifact.project_id) : undefined;
    const targetHref = job?.job_number
      ? `/auftraege/${encodeURIComponent(job.job_number)}`
      : project?.project_number
        ? `/auftraege/projekt/${encodeURIComponent(project.project_number)}`
        : '/auftraege';
    const targetLabel =
      job?.title.trim() ||
      job?.description?.trim() ||
      project?.name.trim() ||
      project?.description?.trim() ||
      'Arbeit';
    const canAccessTarget =
      isManager ||
      (artifact.job_id
        ? assignedJobIds.has(artifact.job_id)
        : artifact.project_id !== null && assignedProjectIds.has(artifact.project_id));

    if (
      artifact.status === 'submitted' &&
      isApprovalHolder &&
      canAccessTarget &&
      revision.created_by !== context.userId
    ) {
      tasks.push({
        sourceType: 'work_artifact_review',
        sourceId: artifact.id,
        artifactTitle: revision.title,
        artifactKind: revision.kind,
        revisionNumber: revision.revision_number,
        targetLabel,
        targetHref,
        stateVersion: `review:${artifact.version}:${revision.id}`,
      });
    }
    if (artifact.status === 'correction_requested' && revision.created_by === context.userId) {
      tasks.push({
        sourceType: 'work_artifact_correction',
        sourceId: artifact.id,
        artifactTitle: revision.title,
        artifactKind: revision.kind,
        revisionNumber: revision.revision_number,
        targetLabel,
        targetHref,
        stateVersion: `correction:${artifact.version}:${revision.id}`,
      });
    }

    const defect = defects.get(revision.id);
    const canSeeDefect =
      canAccessTarget || (ownRecord?.id != null && defect?.responsible_employee_record_id === ownRecord.id);
    if (defect?.due_date && canSeeDefect) {
      tasks.push({
        sourceType: 'work_defect_due',
        sourceId: artifact.id,
        artifactTitle: revision.title,
        targetLabel,
        targetHref,
        dueDate: defect.due_date,
        severity: defect.severity,
        stateVersion: `defect:${artifact.version}:${revision.id}:${defect.state}:${defect.due_date}`,
      });
    }
  }
  return tasks;
}

export async function deriveWorkArtifactTasks(context: ActionContext): Promise<DerivedTasks> {
  const admin = createSupabaseAdminClient();
  const isManager = context.role === 'admin' || context.role === 'buero';
  const artifactReader = isManager ? admin : await createSupabaseServerClient();
  const businessToday = getBusinessTodayIso();
  const [reviewArtifactsResult, dueDefectsResult, holder] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        artifactReader
          .from('work_artifacts')
          .select('id, job_id, project_id, status, kind, current_revision_id, version')
          .eq('organization_id', context.orgId)
          .in('status', ['submitted', 'correction_requested'])
          .order('updated_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        artifactReader
          .from('work_artifact_defect_details')
          .select('revision_id, due_date, severity, state, responsible_employee_record_id')
          .eq('organization_id', context.orgId)
          .neq('state', 'resolved')
          .lte('due_date', businessToday)
          .order('revision_id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    getEffectiveResponsibilityHolderForActor({
      organizationId: context.orgId,
      responsibility: 'work_artifact_approval',
      actorUserId: context.userId,
    }),
  ]);
  if (reviewArtifactsResult.error || dueDefectsResult.error) {
    logError(
      'Failed to load work artifact attention contexts',
      reviewArtifactsResult.error ?? dueDefectsResult.error,
    );
    return { tasks: [], failed: true };
  }

  const dueRevisionIds = (dueDefectsResult.data ?? []).map((defect) => defect.revision_id);
  const dueArtifactsResult = await readInBatches(dueRevisionIds, (batch) =>
    artifactReader
      .from('work_artifacts')
      .select('id, job_id, project_id, status, kind, current_revision_id, version')
      .eq('organization_id', context.orgId)
      .neq('status', 'voided')
      .in('current_revision_id', [...batch]),
  );
  if (dueArtifactsResult.error) {
    logError('Failed to load due-defect artifact contexts', dueArtifactsResult.error);
    return { tasks: [], failed: true };
  }
  const artifacts = [
    ...new Map(
      [...(reviewArtifactsResult.data ?? []), ...(dueArtifactsResult.data ?? [])].map((artifact) => [
        artifact.id,
        artifact,
      ]),
    ).values(),
  ];
  if (!artifacts.length) return { tasks: [], failed: false };
  const revisionIds = artifacts.flatMap((artifact) =>
    artifact.current_revision_id ? [artifact.current_revision_id] : [],
  );
  const revisionsResult = await readInBatches(revisionIds, (batch) =>
    admin
      .from('work_artifact_revisions')
      .select('id, title, kind, revision_number, created_by')
      .eq('organization_id', context.orgId)
      .in('id', [...batch]),
  );
  if (revisionsResult.error) {
    logError('Failed to load work artifact attention facts', revisionsResult.error);
    return { tasks: [], failed: true };
  }
  const targets = await readWorkArtifactAttentionTargets(admin, context, isManager, artifacts);
  if (!targets) return { tasks: [], failed: true };
  const tasks = toWorkArtifactTasks(
    context,
    isManager,
    Boolean(holder),
    artifacts,
    revisionsResult.data ?? [],
    dueDefectsResult.data ?? [],
    targets,
  );
  return { tasks, failed: false };
}

/**
 * The projects whose handover is due: the explicitly completed ones plus the
 * derived ones whose child jobs all reached a terminal state. Null when a read fails.
 */
async function resolveCompleteHandoverProjects(
  admin: SupabaseAdminClient,
  context: ActionContext,
  explicitProjects: HandoverProjectRow[],
  terminalChildSignals: Array<{ project_id: string | null }>,
): Promise<HandoverProjectRow[] | null> {
  const childProjectIds = [
    ...new Set(terminalChildSignals.flatMap((job) => (job.project_id ? [job.project_id] : []))),
  ];
  const derivedProjectsResult = await readInBatches(childProjectIds, (batch) =>
    admin
      .from('projects')
      .select(
        'id, project_number, name, execution_version, execution_state_override, status_override, updated_at',
      )
      .eq('organization_id', context.orgId)
      .in('id', [...batch])
      .is('execution_state_override', null),
  );
  if (derivedProjectsResult.error) {
    logError('Failed to load derived project handover attention contexts', derivedProjectsResult.error);
    return null;
  }
  const possibleProjects = [
    ...new Map(
      [
        ...explicitProjects,
        ...derivedProjectsResult.data.toSorted(
          (left, right) => Date.parse(left.updated_at) - Date.parse(right.updated_at),
        ),
      ].map((project) => [project.id, project]),
    ).values(),
  ];
  const possibleProjectIds = possibleProjects.map((project) => project.id);
  const projectJobsResult = await readInBatches(possibleProjectIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select('project_id, execution_state, status')
          .eq('organization_id', context.orgId)
          .in('project_id', [...batch])
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );
  if (projectJobsResult.error) {
    logError('Failed to load project handover states', projectJobsResult.error);
    return null;
  }
  const childJobsByProject = new Map<
    string,
    Array<{
      executionState: NonNullable<typeof projectJobsResult.data>[number]['execution_state'];
      status: NonNullable<typeof projectJobsResult.data>[number]['status'];
    }>
  >();
  for (const childJob of projectJobsResult.data ?? []) {
    if (!childJob.project_id) continue;
    const projectJobs = childJobsByProject.get(childJob.project_id) ?? [];
    projectJobs.push({ executionState: childJob.execution_state, status: childJob.status });
    childJobsByProject.set(childJob.project_id, projectJobs);
  }
  return possibleProjects.filter(
    (project) =>
      resolveProjectHandoverExecutionState(
        project.execution_state_override,
        project.status_override,
        childJobsByProject.get(project.id) ?? [],
      ) === 'execution_complete',
  );
}
function toWorkHandoverTasks(
  jobs: HandoverJobRow[],
  projects: HandoverProjectRow[],
  jobPackageRows: Array<Pick<Tables<'work_handover_packages'>, 'job_id' | 'state' | 'version'>>,
  projectPackageRows: Array<Pick<Tables<'work_handover_packages'>, 'project_id' | 'state' | 'version'>>,
  parentProjectRows: Array<{ id: string; project_number: string | null }>,
): AttentionTask[] {
  const jobPackages = new Map(jobPackageRows.map((entry) => [entry.job_id, entry]));
  const projectPackages = new Map(projectPackageRows.map((entry) => [entry.project_id, entry]));
  const projectNumbers = new Map(parentProjectRows.map((project) => [project.id, project.project_number]));
  const tasks: AttentionTask[] = [];
  for (const job of jobs) {
    const handoverPackage = jobPackages.get(job.id);
    if (handoverPackage?.state === 'released') continue;
    const projectNumber = job.project_id ? projectNumbers.get(job.project_id) : null;
    tasks.push({
      sourceType: 'work_handover_review',
      sourceId: job.id,
      targetType: 'job',
      targetLabel: job.job_number ? `${job.job_number} · ${job.title}` : job.title,
      targetHref:
        job.job_number && projectNumber
          ? `/auftraege/projekt/${encodeURIComponent(projectNumber)}/${encodeURIComponent(job.job_number)}/uebergabe`
          : job.job_number && !job.project_id
            ? `/auftraege/${encodeURIComponent(job.job_number)}/uebergabe`
            : `/auftraege/uebergaben/auftrag/${job.id}`,
      packageState: handoverPackage?.state ?? 'missing',
      stateVersion: `job:${job.execution_version}:${handoverPackage?.version ?? 0}`,
    });
  }
  for (const project of projects) {
    const handoverPackage = projectPackages.get(project.id);
    if (handoverPackage?.state === 'released') continue;
    tasks.push({
      sourceType: 'work_handover_review',
      sourceId: project.id,
      targetType: 'project',
      targetLabel: project.project_number ? `${project.project_number} · ${project.name}` : project.name,
      targetHref: project.project_number
        ? `/auftraege/projekt/${encodeURIComponent(project.project_number)}/uebergabe`
        : `/auftraege/uebergaben/projekt/${project.id}`,
      packageState: handoverPackage?.state ?? 'missing',
      stateVersion: `project:${project.execution_version}:${handoverPackage?.version ?? 0}`,
    });
  }
  return tasks;
}
export async function deriveWorkHandoverTasks(context: ActionContext): Promise<DerivedTasks> {
  const holder = await getEffectiveResponsibilityHolderForActor({
    organizationId: context.orgId,
    responsibility: 'work_handover_review',
    actorUserId: context.userId,
  });
  if (!holder) return { tasks: [], failed: false };
  const admin = createSupabaseAdminClient();
  const [jobsResult, terminalChildSignalsResult, explicitProjectsResult] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select('id, job_number, title, execution_version, project_id')
          .eq('organization_id', context.orgId)
          .or('execution_state.eq.execution_complete,and(execution_state.is.null,status.eq.fertig)')
          .order('updated_at', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select('project_id')
          .eq('organization_id', context.orgId)
          .not('project_id', 'is', null)
          .or(
            'execution_state.in.(execution_complete,handed_over,cancelled),and(execution_state.is.null,status.eq.fertig)',
          )
          .order('updated_at', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('projects')
          .select('id, project_number, name, execution_version, execution_state_override, status_override')
          .eq('organization_id', context.orgId)
          .or(
            'execution_state_override.eq.execution_complete,and(execution_state_override.is.null,status_override.eq.abgeschlossen)',
          )
          .order('updated_at', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);
  if (jobsResult.error || terminalChildSignalsResult.error || explicitProjectsResult.error) {
    logError(
      'Failed to load work handover attention contexts',
      jobsResult.error ?? terminalChildSignalsResult.error ?? explicitProjectsResult.error,
    );
    return { tasks: [], failed: true };
  }

  const projects = await resolveCompleteHandoverProjects(
    admin,
    context,
    explicitProjectsResult.data ?? [],
    terminalChildSignalsResult.data ?? [],
  );
  if (!projects) return { tasks: [], failed: true };
  const jobIds = (jobsResult.data ?? []).map((job) => job.id);
  const projectIds = projects.map((project) => project.id);
  const parentProjectIds = [
    ...new Set((jobsResult.data ?? []).flatMap((job) => (job.project_id ? [job.project_id] : []))),
  ];
  const [jobPackagesResult, projectPackagesResult, parentProjectsResult] = await Promise.all([
    readInBatches(jobIds, (batch) =>
      admin
        .from('work_handover_packages')
        .select('id, job_id, state, version')
        .eq('organization_id', context.orgId)
        .in('job_id', [...batch]),
    ),
    readInBatches(projectIds, (batch) =>
      admin
        .from('work_handover_packages')
        .select('id, project_id, state, version')
        .eq('organization_id', context.orgId)
        .in('project_id', [...batch]),
    ),
    readInBatches(parentProjectIds, (batch) =>
      admin
        .from('projects')
        .select('id, project_number')
        .eq('organization_id', context.orgId)
        .in('id', [...batch]),
    ),
  ]);
  if (jobPackagesResult.error || projectPackagesResult.error || parentProjectsResult.error) {
    logError(
      'Failed to load work handover attention package states',
      jobPackagesResult.error ?? projectPackagesResult.error ?? parentProjectsResult.error,
    );
    return { tasks: [], failed: true };
  }
  const tasks = toWorkHandoverTasks(
    jobsResult.data ?? [],
    projects,
    jobPackagesResult.data ?? [],
    projectPackagesResult.data ?? [],
    parentProjectsResult.data ?? [],
  );
  return { tasks, failed: false };
}

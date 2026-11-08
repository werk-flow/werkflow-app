import type { Tables } from '@/lib/supabase/database.types';
import type { AttentionTask } from './types';

export type HandoverJobRow = Pick<
  Tables<'jobs'>,
  'id' | 'job_number' | 'title' | 'execution_version' | 'project_id' | 'updated_at'
>;
export type HandoverProjectRow = Pick<
  Tables<'projects'>,
  | 'id'
  | 'project_number'
  | 'name'
  | 'execution_version'
  | 'execution_state_override'
  | 'status_override'
  | 'updated_at'
>;

/**
 * The handover review tasks of finished jobs and projects whose package is not
 * released, oldest first across both target types.
 */
export function toWorkHandoverTasks(
  jobs: HandoverJobRow[],
  projects: HandoverProjectRow[],
  jobPackageRows: Array<Pick<Tables<'work_handover_packages'>, 'job_id' | 'state' | 'version'>>,
  projectPackageRows: Array<Pick<Tables<'work_handover_packages'>, 'project_id' | 'state' | 'version'>>,
  parentProjectRows: Array<{ id: string; project_number: string | null }>,
): AttentionTask[] {
  const jobPackages = new Map(jobPackageRows.map((entry) => [entry.job_id, entry]));
  const projectPackages = new Map(projectPackageRows.map((entry) => [entry.project_id, entry]));
  const projectNumbers = new Map(parentProjectRows.map((project) => [project.id, project.project_number]));
  const tasks: Array<{ task: AttentionTask; updatedAt: string }> = [];
  for (const job of jobs) {
    const handoverPackage = jobPackages.get(job.id);
    if (handoverPackage?.state === 'released') continue;
    const projectNumber = job.project_id ? projectNumbers.get(job.project_id) : null;
    tasks.push({
      updatedAt: job.updated_at,
      task: {
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
      },
    });
  }
  for (const project of projects) {
    const handoverPackage = projectPackages.get(project.id);
    if (handoverPackage?.state === 'released') continue;
    tasks.push({
      updatedAt: project.updated_at,
      task: {
        sourceType: 'work_handover_review',
        sourceId: project.id,
        targetType: 'project',
        targetLabel: project.project_number ? `${project.project_number} · ${project.name}` : project.name,
        targetHref: project.project_number
          ? `/auftraege/projekt/${encodeURIComponent(project.project_number)}/uebergabe`
          : `/auftraege/uebergaben/projekt/${project.id}`,
        packageState: handoverPackage?.state ?? 'missing',
        stateVersion: `project:${project.execution_version}:${handoverPackage?.version ?? 0}`,
      },
    });
  }
  // Oldest first across jobs and projects: Aufgaben shows the oldest handovers before „Alle anzeigen“.
  return tasks
    .toSorted((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
    .map((entry) => entry.task);
}

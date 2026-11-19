import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import type { Database, Tables } from '@/lib/supabase/database.types';
import { resolveChildState } from '@/lib/work-handover/project-state';
import type { WorkExecutionState } from '@/lib/work-lifecycle/types';
import type { AttentionTask } from './types';

export type HandoverJobRow = Pick<
  Tables<'jobs'>,
  'id' | 'job_number' | 'title' | 'execution_version' | 'project_id' | 'updated_at' | 'actual_completion_date'
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
> & {
  /** The Berlin day its execution completed (`projectCompletedOn`); null when unknown. */
  completedOn: string | null;
};

type ProjectChild = {
  executionState: WorkExecutionState | null;
  status: Database['public']['Enums']['job_status'];
  actualCompletionDate: string | null;
};

/**
 * The Berlin day a project's execution completed: its latest completion by
 * hand, else the latest completion of its finished child jobs, else, with
 * neither recorded, the Berlin day of its last change. Null while a finished
 * child carries no completion date: that child may have finished later, so
 * the day is unknown.
 */
export function projectCompletedOn(
  project: { updated_at: string },
  handCompletion: string | undefined,
  children: readonly ProjectChild[],
): string | null {
  if (handCompletion !== undefined) return handCompletion;
  const finished = children.filter((child) => {
    const state = resolveChildState(child);
    return state === 'execution_complete' || state === 'handed_over';
  });
  const days = finished.map((child) => child.actualCompletionDate);
  if (days.some((day) => day === null)) return null;
  const recorded = days.filter((day): day is string => day !== null);
  return recorded.length > 0
    ? recorded.reduce((latest, day) => (day > latest ? day : latest))
    : formatBerlinLocalDate(project.updated_at);
}

/**
 * The Berlin day of a project's latest completion by hand, from its recorded
 * transitions to `execution_complete`; null without one. A withdrawn release
 * also records that transition, but reopens work that was already complete.
 */
export function latestHandCompletion(
  completions: ReadonlyArray<{ event_type: string; created_at: string }>,
): string | null {
  const days = completions
    .filter((event) => event.event_type !== 'handover_withdrawn')
    .map((event) => formatBerlinLocalDate(event.created_at));
  return days.length > 0 ? days.reduce((latest, day) => (day > latest ? day : latest)) : null;
}

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
        // A job finished before completion dates were recorded waits since its last change.
        completedOn: job.actual_completion_date ?? formatBerlinLocalDate(job.updated_at),
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
        completedOn: project.completedOn,
        stateVersion: `project:${project.execution_version}:${handoverPackage?.version ?? 0}`,
      },
    });
  }
  // Oldest first across jobs and projects: Aufgaben shows the oldest handovers before „Alle anzeigen“.
  return tasks
    .toSorted((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
    .map((entry) => entry.task);
}

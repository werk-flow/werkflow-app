import {
  JOB_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  getEffectiveProjectStatusFromCounts,
  type Job,
  type JobStatus,
  type ProjectStatus,
  type ProjectWithDetails,
} from '@/lib/jobs/types';
import { WORK_EXECUTION_LABELS, type WorkExecutionState } from '@/lib/work-lifecycle/types';

// The one owner of the colors and labels of job, project and work states:
// every badge that shows such a state reads them here, so a state has one
// color and one label on every screen. The work state wins over the legacy
// status wherever both exist. Yellow `warning` means waiting; work that is being done has
// its own `ongoing` family (owner decision 2026-10-03). Purple marks parked work.
const NOT_STARTED = 'bg-secondary text-secondary-foreground';
const ONGOING = 'bg-ongoing-soft text-ongoing-soft-foreground';
const WAITING = 'bg-warning-soft text-warning-soft-foreground';
const DONE = 'bg-success-soft text-success-soft-foreground';
const PARKED = 'bg-brand-purple/15 text-brand-purple-dark dark:text-brand-purple-light';
const CANCELLED = 'bg-destructive-soft text-destructive-soft-foreground';

const JOB_STATUS_CLASSES: Record<JobStatus, string> = {
  nicht_bearbeitet: NOT_STARTED,
  in_bearbeitung: ONGOING,
  fertig: DONE,
  geparkt: PARKED,
};

export const PROJECT_STATUS_CLASSES: Record<ProjectStatus, string> = {
  nicht_begonnen: NOT_STARTED,
  in_bearbeitung: ONGOING,
  abgeschlossen: DONE,
  geparkt: PARKED,
};

export const WORK_EXECUTION_CLASSES: Record<WorkExecutionState, string> = {
  not_started: NOT_STARTED,
  in_progress: ONGOING,
  interrupted: WAITING,
  execution_complete: DONE,
  handed_over: DONE,
  cancelled: CANCELLED,
};

type JobState = Pick<Job, 'status' | 'executionState'>;

export function getJobStatusClass(job: JobState): string {
  return job.executionState ? WORK_EXECUTION_CLASSES[job.executionState] : JOB_STATUS_CLASSES[job.status];
}

export function getJobStatusLabel(job: JobState): string {
  return job.executionState
    ? WORK_EXECUTION_LABELS[job.executionState]
    : `${JOB_STATUS_LABELS[job.status]} · Altbestand`;
}

export function getProjectStatusLabel(project: ProjectWithDetails): string {
  if (project.executionStateOverride) {
    return WORK_EXECUTION_LABELS[project.executionStateOverride];
  }
  if (project.statusOverride) {
    return `${PROJECT_STATUS_LABELS[project.statusOverride]} · Altbestand`;
  }
  return `${PROJECT_STATUS_LABELS[getEffectiveProjectStatusFromCounts(project)]} · automatisch`;
}

export function getProjectStatusClass(project: ProjectWithDetails, effectiveStatus: ProjectStatus): string {
  return project.executionStateOverride
    ? WORK_EXECUTION_CLASSES[project.executionStateOverride]
    : PROJECT_STATUS_CLASSES[effectiveStatus];
}

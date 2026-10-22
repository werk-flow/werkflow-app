import type { AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';
import { sameFields, sameItems, sameRecords, type MemoContentChecks } from '@/lib/ui/memo-equality';

/** What every job row and card shows from values its owner rebuilds on each change. */
type JobRowContent = {
  job: Job;
  assignedUserIds: readonly string[];
  /** The parent project of a child job: its route nests the job's, and the edit dialog shows it. */
  project?: ProjectWithDetails | undefined;
};

/** The content checks of a job's table row and of its card (lib/ui/memo-equality.ts). */
export const JOB_ROW_CONTENT_CHECKS = {
  // The route render after every save rebuilds each job object; an equal job shows the same row.
  job: (previous, next) => sameFields(previous.job, next.job),
  // The assignment map is rebuilt with every refresh; the row shows these ids in this order.
  assignedUserIds: (previous, next) => sameItems(previous.assignedUserIds, next.assignedUserIds),
  // The parent project is rebuilt whenever any job changes its counts; the row shows its fields only.
  project: (previous, next) => sameFields(previous.project, next.project),
} satisfies MemoContentChecks<JobRowContent>;

/** The content check every table row adds to its own. */
export const TABLE_ROW_CONTENT_CHECKS = {
  // The visible columns come from the page props, which every route render rebuilds; the cells follow their order.
  visibleColumns: (previous, next) => sameItems(previous.visibleColumns, next.visibleColumns),
} satisfies MemoContentChecks<{ visibleColumns: readonly AuftraegeColumnId[] }>;

/** What every project row and card shows, or seeds its child list with, from values rebuilt on each change. */
type ProjectRowContent = {
  project: ProjectWithDetails;
  childJobs: readonly Job[];
  projectAssignedUserIds?: readonly string[] | undefined;
  clientMap: Readonly<Record<string, string>>;
  jobAssignmentMap: Readonly<Record<string, readonly string[]>>;
  /** Every job of the list, for the edit dialog's job picker. */
  jobs: readonly Job[];
};

/** The content checks of a project's table row and of its card. */
export const PROJECT_ROW_CONTENT_CHECKS = {
  // Every value below is rebuilt for every row by the route render after a save or by the
  // section's derivation; each check compares all of it, so a changed project renders again.
  project: (previous, next) => sameFields(previous.project, next.project),
  childJobs: (previous, next) => sameRecords(previous.childJobs, next.childJobs),
  projectAssignedUserIds: (previous, next) =>
    previous.projectAssignedUserIds === next.projectAssignedUserIds ||
    (previous.projectAssignedUserIds !== undefined &&
      next.projectAssignedUserIds !== undefined &&
      sameItems(previous.projectAssignedUserIds, next.projectAssignedUserIds)),
  clientMap: (previous, next) => sameFields(previous.clientMap, next.clientMap),
  jobAssignmentMap: (previous, next) => sameFields(previous.jobAssignmentMap, next.jobAssignmentMap),
  jobs: (previous, next) => sameRecords(previous.jobs, next.jobs),
} satisfies MemoContentChecks<ProjectRowContent>;

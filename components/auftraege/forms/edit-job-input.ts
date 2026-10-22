import type { UpdateJobInput } from '@/lib/jobs/actions';
import type { AssignmentApproval } from '@/lib/qualifications/types';
import type { Job, JobPriority } from '@/lib/jobs/types';
import { parseHoursInputToMinutes } from '@/lib/jobs/planned-working';
import { jobFormEditsSchedule, type JobVisitPlan } from '@/lib/jobs/visit-schedule';
import { toLocalDateString } from '@/lib/utils';

export type EditJobDraft = {
  jobNumber: string;
  title: string;
  description: string;
  clientId: string;
  projectId: string;
  siteId: string;
  contactId: string;
  priority: JobPriority;
  plannedDate: Date | undefined;
  plannedTime: string;
  estimatedHours: string;
  plannedWorkingHours: string;
  plannedWorkingTouched: boolean;
  autoSyncPlannedWorking: boolean;
  location: string;
  selectedEmployees: string[];
  assignmentTeamSourceId: string | null;
  /** The job's visits; with several, the form shows them read-only and sends no schedule. */
  visitPlan: JobVisitPlan | null;
};

/**
 * The update a saved edit sends. A cleared field is sent as null only when the
 * job had a value, and left out otherwise, so an untouched empty field is not
 * a change.
 */
export function buildEditJobInput(
  job: Job,
  draft: EditJobDraft,
  approval: AssignmentApproval | undefined,
): UpdateJobInput {
  const {
    jobNumber,
    title,
    description,
    clientId,
    projectId,
    siteId,
    contactId,
    priority,
    plannedDate,
    plannedTime,
    estimatedHours,
    plannedWorkingHours,
    plannedWorkingTouched,
    autoSyncPlannedWorking,
    location,
    selectedEmployees,
    assignmentTeamSourceId,
    visitPlan,
  } = draft;

  const parsedEstimatedDuration = parseHoursInputToMinutes(estimatedHours);
  const estimatedDurationMinutes = estimatedHours.trim()
    ? parsedEstimatedDuration
    : job.estimatedDurationMinutes !== null
      ? null
      : undefined;

  let plannedWorkingMinutes: number | null | undefined;
  if (plannedWorkingTouched) {
    plannedWorkingMinutes = plannedWorkingHours.trim()
      ? parseHoursInputToMinutes(plannedWorkingHours)
      : job.plannedWorkingMinutes !== null
        ? null
        : undefined;
  } else if (autoSyncPlannedWorking) {
    plannedWorkingMinutes = plannedWorkingHours.trim()
      ? parseHoursInputToMinutes(plannedWorkingHours)
      : job.plannedWorkingMinutes !== null
        ? null
        : undefined;
  }

  // A job with several visits is planned on the Plantafel: the form sends no schedule then.
  const schedule: Pick<UpdateJobInput, 'plannedDate' | 'plannedTime' | 'estimatedDurationMinutes'> =
    visitPlan && !jobFormEditsSchedule(visitPlan.total)
      ? {}
      : {
          ...(plannedDate
            ? { plannedDate: toLocalDateString(plannedDate) }
            : job.plannedDate !== null
              ? { plannedDate: null }
              : {}),
          ...(plannedTime ? { plannedTime } : job.plannedTime !== null ? { plannedTime: null } : {}),
          ...(estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes } : {}),
        };

  const input: UpdateJobInput = {
    title: title.trim(),
    ...(description.trim() || job.description !== null ? { description: description.trim() } : {}),
    clientId: clientId && clientId !== 'none' ? clientId : '',
    projectId: projectId && projectId !== 'none' ? projectId : '',
    ...(jobNumber.trim() ? { jobNumber: jobNumber.trim() } : {}),
    priority,
    ...schedule,
    ...(plannedWorkingMinutes !== undefined ? { plannedWorkingMinutes } : {}),
    ...(location.trim() || job.location !== null ? { location: location.trim() } : {}),
    siteId,
    contactId,
    selectedUserIds: selectedEmployees,
    assignmentApproval: approval ?? null,
    assignmentTeamSourceId,
  };

  return input;
}

import { formatGermanDate } from '@/lib/utils';
import { PICKER_GROUP_LABELS, PICKER_GROUPS, type PickerJob } from './picker-types';

/**
 * The heading above the job at `index`: its group's label where the group
 * starts, and none while the whole list is one group.
 */
export function pickerGroupHeading(jobs: readonly Pick<PickerJob, 'group'>[], index: number): string | null {
  const job = jobs[index];
  if (!job || (index > 0 && jobs[index - 1]?.group === job.group)) return null;
  return jobs.some((other) => other.group !== job.group) ? PICKER_GROUP_LABELS[job.group] : null;
}

/** The line under a job's title: the next visit's date where it ranked the job, then number, customer and project. */
export function pickerJobDetails(
  job: Pick<PickerJob, 'group' | 'nextVisitDate' | 'jobNumber' | 'clientName' | 'projectName'>,
): string {
  const visit = job.group === 'upcoming' && job.nextVisitDate ? formatGermanDate(job.nextVisitDate) : null;
  return [visit, job.jobNumber, job.clientName, job.projectName].filter(Boolean).join(' · ');
}

/**
 * The page with the running job of a switch, which the page may not hold (a
 * later page, or a parked or finished job): it joins the end of its own group,
 * so every group keeps one heading in the database's order.
 */
export function withRunningJob<Job extends Pick<PickerJob, 'id' | 'group'>>(
  jobs: readonly Job[],
  running: Job,
): readonly Job[] {
  if (jobs.some((job) => job.id === running.id)) return jobs;
  const rank = PICKER_GROUPS.indexOf(running.group);
  const at = jobs.findIndex((job) => PICKER_GROUPS.indexOf(job.group) > rank);
  return at === -1 ? [...jobs, running] : [...jobs.slice(0, at), running, ...jobs.slice(at)];
}

/**
 * The job form and the job's visits. The job's schedule columns (date, time,
 * duration) project its first scheduled visit, and a schedule edit in the job
 * form moves the job's legacy visit (docs/technical/data-model.md, "Job team
 * and visit plan"). That is the job's whole schedule only while the job has at
 * most one visit; a job with several visits is planned on the Plantafel.
 */

/** One scheduled visit as the job form lists it. */
export type JobVisit = {
  id: string;
  /** The Berlin calendar day the visit starts on, `YYYY-MM-DD`. */
  date: string;
  /** Start and end of a timed visit; null for an all-day visit. */
  startAt: string | null;
  endAt: string | null;
  people: string[];
};

/** The job's scheduled visits: how many there are, and the next ones from today. */
export type JobVisitPlan = {
  total: number;
  upcomingTotal: number;
  /** The first upcoming visits in start order, at most `JOB_FORM_VISIT_LIMIT`. */
  upcoming: JobVisit[];
};

/** How many upcoming visits the job form lists before „und n weitere“. */
export const JOB_FORM_VISIT_LIMIT = 5;

/** The job form edits date, time and duration only while the job has at most one scheduled visit. */
export function jobFormEditsSchedule(scheduledVisitCount: number): boolean {
  return scheduledVisitCount <= 1;
}

/** True when a job edit sets one of the schedule columns. */
export function namesJobSchedule(input: {
  plannedDate?: string | null | undefined;
  plannedTime?: string | null | undefined;
  estimatedDurationMinutes?: number | null | undefined;
}): boolean {
  return (
    input.plannedDate !== undefined ||
    input.plannedTime !== undefined ||
    input.estimatedDurationMinutes !== undefined
  );
}

/** The calendar on the day of the job's first upcoming visit, or on today without one. */
export function jobPlanningHref(plan: JobVisitPlan): string {
  const first = plan.upcoming[0];
  return first ? `/kalender?date=${first.date}` : '/kalender';
}

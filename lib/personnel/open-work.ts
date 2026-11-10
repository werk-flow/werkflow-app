import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { addLocalDays } from '@/lib/date-time/berlin';

// A person's open work: the open jobs they hold, on the job's team or on one
// of its visits that has not started. The personnel process counts it, the
// handover lists it, and the employment transition records what stays open,
// so all three read this one definition.

/** The job statuses whose work is still open; a finished job is history. */
export const OPEN_JOB_STATUSES = ['nicht_bearbeitet', 'in_bearbeitung', 'geparkt'] as const;

/** One scheduled visit of the person that has not started, at its Berlin date and time. */
export type OpenWorkVisit = {
  occurrenceId: string;
  /** Berlin date the visit starts on. */
  date: string;
  /** Berlin start time HH:MM; null for an all-day visit. */
  time: string | null;
};

/** One open job the person holds, with their upcoming visits in time order. */
export type OpenWorkJob = {
  jobId: string;
  label: string;
  parked: boolean;
  visits: OpenWorkVisit[];
};

const visitKey = (visit: OpenWorkVisit): string => `${visit.date} ${visit.time ?? ''}`;

/** Jobs with an upcoming visit first, by their next visit; then the jobs without one, by name. */
export function orderOpenWork(jobs: readonly OpenWorkJob[]): OpenWorkJob[] {
  return jobs
    .map((job) => ({ ...job, visits: job.visits.toSorted((a, b) => visitKey(a).localeCompare(visitKey(b))) }))
    .toSorted((left, right) => {
      const leftVisit = left.visits[0];
      const rightVisit = right.visits[0];
      if (leftVisit && rightVisit) return visitKey(leftVisit).localeCompare(visitKey(rightVisit));
      if (leftVisit) return -1;
      if (rightVisit) return 1;
      return left.label.localeCompare(right.label, 'de');
    });
}

/** The visits a handover from the Berlin date moves: those that start on or after it. */
export function visitsFrom(job: OpenWorkJob, handoverFrom: string): OpenWorkVisit[] {
  return job.visits.filter((visit) => visit.date >= handoverFrom);
}

/** The open jobs counted as the member page's job list splits them: active ones and parked ones. */
export function openWorkCounts(jobs: readonly OpenWorkJob[]): { total: number; parked: number } {
  return { total: jobs.length, parked: jobs.filter((job) => job.parked).length };
}

/**
 * The first Berlin date a handover moves work from: the day after the exit
 * date or the day app access ends, whichever comes first, and never before
 * today.
 */
export function defaultHandoverFrom(input: {
  exitDate: string | null;
  accessEndDate: string | null;
  today: string;
}): string {
  const candidates = [input.exitDate ? addLocalDays(input.exitDate, 1) : null, input.accessEndDate].filter(
    (date): date is string => date !== null,
  );
  const earliest = candidates.toSorted()[0];
  return earliest && earliest > input.today ? earliest : input.today;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const handOverWorkInputSchema = z.object({
  employeeRecordId: uuidSchema,
  handoverFrom: isoDate,
  rows: z
    .array(z.object({ jobId: uuidSchema, targetEmployeeRecordId: uuidSchema }))
    .min(1)
    .max(500)
    .refine((rows) => new Set(rows.map((row) => row.jobId)).size === rows.length, 'Each job once'),
  planningApproval: z
    .object({ fingerprint: z.string().min(1).max(200), reason: z.string().trim().min(8).max(500) })
    .nullable()
    .default(null),
});

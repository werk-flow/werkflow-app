import type { FieldSyncTodayAssignment } from '@/lib/field-sync/today-snapshot';
import { jobDetailHref } from '@/lib/jobs/routes';
import { formatBerlinTime } from '@/lib/utils';

// What the field worker's start page shows of one Einsatz of the phone's today
// snapshot (lib/field-sync/today-snapshot.ts): when, for whom, where, and what
// comes next. It reads the snapshot's fields only; the snapshot is E7's.

export type WorkerStartRow = {
  jobId: string;
  /** The field work pack of the job. */
  href: string;
  title: string;
  /** When each visit starts, „08:00 Uhr“, or „Ganztägig“ without times; the work pack shows the window. */
  time: string;
  customer: string | null;
  /** The site's address, else its name. */
  place: string | null;
  /** The first open instruction in the office's order; null without one. */
  nextStep: string | null;
  /** Every instruction is done; false for a job without instructions. */
  instructionsDone: boolean;
};

function visitStart(visit: FieldSyncTodayAssignment['visits'][number]): string {
  return visit.startAt ? `${formatBerlinTime(visit.startAt)} Uhr` : 'Ganztägig';
}

export function workerStartRow(assignment: FieldSyncTodayAssignment): WorkerStartRow {
  const { instructions, project } = assignment;
  return {
    jobId: assignment.jobId,
    href: jobDetailHref(
      { id: assignment.jobId, jobNumber: assignment.jobNumber },
      project ? { id: project.projectNumber, projectNumber: project.projectNumber } : null,
    ),
    title: assignment.title,
    time: assignment.visits.map(visitStart).join(', '),
    customer: assignment.customerName,
    place: assignment.siteAddress ?? assignment.siteName,
    nextStep: instructions.find((instruction) => !instruction.done)?.content ?? null,
    instructionsDone: instructions.length > 0 && instructions.every((instruction) => instruction.done),
  };
}

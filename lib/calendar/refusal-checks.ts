import { boardDayKey, type CalendarBoardDay, type CalendarBoardRow } from './board';
import { calendarRefusalMessage, formatRefusalDate, type CalendarClientRefusalCode } from './messages';
import type { CalendarJob } from '@/lib/jobs/types';

/**
 * The client pre-checks a drop runs before it lands (P1-24a, criterion 27).
 * Each mirrors a rule the server enforces or a fact the board already holds,
 * so a refusal appears at the pointer with the same sentence the action
 * would return. A drop the check allows can still be refused by the server;
 * the settle read is the truth.
 */
export type RefusalCheckResult =
  | { ok: true }
  | { ok: false; code: CalendarClientRefusalCode; message: string };

function refuse(code: CalendarClientRefusalCode, context: { name?: string; date?: string } = {}): RefusalCheckResult {
  return { ok: false, code, message: calendarRefusalMessage(code, context) ?? '' };
}

export function checkReadOnly(readOnly: boolean): RefusalCheckResult {
  return readOnly ? refuse('read_only_mode') : { ok: true };
}

export function checkOccurrenceMovable(job: Pick<CalendarJob, 'occurrenceStatus'>): RefusalCheckResult {
  return job.occurrenceStatus === 'skipped' || job.occurrenceStatus === 'cancelled' ? refuse('inactive_occurrence') : { ok: true };
}

/** A parked job plans only with its Parkplatz context (P1-12); a job parked before that context existed is a labelled exception until a manager adds one. */
export function checkParkedContext(contexts: ReadonlyMap<string, unknown> | null, job: Pick<CalendarJob, 'jobId' | 'id'>): RefusalCheckResult {
  return contexts && !contexts.has(job.jobId ?? job.id) ? refuse('parked_without_context') : { ok: true };
}

export function checkParkable(job: Pick<CalendarJob, 'entryKind' | 'jobId' | 'occurrenceId' | 'id'>): RefusalCheckResult {
  const jobId = job.jobId ?? (job.occurrenceId ? null : job.id);
  return job.entryKind === 'internal' || !jobId ? refuse('internal_not_parkable') : { ok: true };
}

/**
 * A person and a date: not employed on the date refuses; an absence or a
 * non-working day refuses too, because the planning assessment would warn
 * and the drop would only open the override dialog. Holding Shift lets a
 * planner drop anyway and take the dialog (the board's escape hatch).
 */
export function checkPersonDay(input: {
  row: CalendarBoardRow | null;
  day: CalendarBoardDay | undefined;
  date: string;
  allowWarnings: boolean;
}): RefusalCheckResult {
  const { row, day, date, allowWarnings } = input;
  if (!row) return { ok: true };
  const context = { name: row.displayName, date: formatRefusalDate(date) };
  if ((row.entryDate && date < row.entryDate) || (row.exitDate && date > row.exitDate)) return refuse('person_not_employed', context);
  if (allowWarnings || !day) return { ok: true };
  if (day.absence?.portion === 'full') return refuse('person_absent', context);
  if (day.reason === 'no_work_day' || (day.targetMinutes === 0 && day.reason === 'working')) return refuse('person_off_day', context);
  return { ok: true };
}

export function checkNotAlreadyAssigned(job: Pick<CalendarJob, 'assignedEmployeeRecordIds'>, employeeRecordId: string | null, sourceEmployeeRecordId: string | null, name: string | null): RefusalCheckResult {
  if (!employeeRecordId || employeeRecordId === sourceEmployeeRecordId) return { ok: true };
  return (job.assignedEmployeeRecordIds ?? []).includes(employeeRecordId) ? refuse('target_already_assigned', name ? { name } : {}) : { ok: true };
}

/** Time blocks: never into the future, never over another block of the target person. */
export function checkTimeBlockTarget(input: {
  startMs: number;
  endMs: number;
  nowMs: number;
  targetName: string | null;
  otherBlocks: ReadonlyArray<{ startMs: number; endMs: number }>;
}): RefusalCheckResult {
  if (input.endMs > input.nowMs) return refuse('future_timestamp');
  const overlaps = input.otherBlocks.some((block) => block.startMs < input.endMs && input.startMs < block.endMs);
  return overlaps ? refuse('overlapping_time_block', input.targetName ? { name: input.targetName } : {}) : { ok: true };
}

export function dayFor(days: ReadonlyMap<string, CalendarBoardDay>, employeeRecordId: string | null, date: string): CalendarBoardDay | undefined {
  return employeeRecordId ? days.get(boardDayKey(employeeRecordId, date)) : undefined;
}

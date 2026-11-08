import { addLocalDays } from '@/lib/date-time/berlin';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { CalendarDispatchState } from './board';

// The planned visits an absence takes a person away from, as the office sees
// them right after it records a sickness or approves a vacation.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const absenceAffectedVisitsInputSchema = z.object({
  employeeRecordId: uuidSchema,
  startDate: isoDate,
  /** Null for an absence „bis auf Weiteres“. */
  endDate: isoDate.nullable(),
});

export type AbsenceAffectedVisitsInput = z.infer<typeof absenceAffectedVisitsInputSchema>;

/** One scheduled visit of the absent person, with that person's dispatch state. */
export type AbsenceAffectedVisit = {
  occurrenceId: string;
  /** Berlin date the visit starts on. */
  date: string;
  /** Berlin start time HH:MM; null for an all-day visit. */
  time: string | null;
  title: string;
  jobNumber: string | null;
  dispatchState: CalendarDispatchState;
};

export type AbsenceAffectedVisits = {
  visits: AbsenceAffectedVisit[];
  /** The last Berlin date the list covers. */
  through: string;
};

/** How far the list looks ahead for an open-ended absence: two working weeks. */
const OPEN_ABSENCE_LOOKAHEAD_DAYS = 14;

/**
 * The Berlin dates the list covers: the absence itself, or for an open-ended
 * one the lookahead from its start or from today, whichever is later. The span
 * has no cap: the read pages one person's visits and fails on an overflow
 * instead of cutting the list. Null for a date that does not exist or an end
 * before the start.
 */
export function absenceVisitWindow(
  input: Pick<AbsenceAffectedVisitsInput, 'startDate' | 'endDate'>,
  today: string,
): { from: string; to: string } | null {
  const { startDate, endDate } = input;
  try {
    if (addLocalDays(startDate, 0) !== startDate) return null;
    if (endDate !== null && (addLocalDays(endDate, 0) !== endDate || endDate < startDate)) return null;
  } catch {
    return null;
  }
  const lookaheadFrom = startDate > today ? startDate : today;
  return { from: startDate, to: endDate ?? addLocalDays(lookaheadFrom, OPEN_ABSENCE_LOOKAHEAD_DAYS - 1) };
}

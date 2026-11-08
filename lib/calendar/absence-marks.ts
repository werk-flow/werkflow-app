import { addLocalDays } from '@/lib/date-time/berlin';
import type { CalendarJob } from '@/lib/jobs/types';
import {
  absenceMark,
  boardDayKey,
  indexBoardDays,
  type CalendarBoardDay,
  type CalendarBoardRow,
} from './board';

// The card and the person pickers mark who is away from the capacity days the
// calendar window already holds (the planning rules' daily targets), so a
// mark costs no read. A date outside the window has no days: the pickers say
// so, and the save's planning check still warns about an absence.

/** The window's capacity days, indexed for the marks. */
export type BoardAbsences = {
  days: ReadonlyMap<string, CalendarBoardDay>;
  /** The Berlin dates the window holds capacity days for. */
  dates: ReadonlySet<string>;
  recordIdByUserId: ReadonlyMap<string, string>;
};

export const NO_BOARD_ABSENCES: BoardAbsences = {
  days: new Map(),
  dates: new Set(),
  recordIdByUserId: new Map(),
};

/** The hint under a picker whose date lies outside the window. */
export const ABSENCES_NOT_LOADED_HINT =
  'Für diesen Tag sind keine Abwesenheiten geladen. Beim Speichern prüft WerkFlow sie trotzdem.';

export function indexBoardAbsences(
  days: readonly CalendarBoardDay[],
  rows: readonly CalendarBoardRow[],
): BoardAbsences {
  return {
    days: indexBoardDays(days),
    dates: new Set(days.map((day) => day.date)),
    recordIdByUserId: new Map(
      rows.flatMap((row) => (row.userId ? [[row.userId, row.employeeRecordId] as const] : [])),
    ),
  };
}

/**
 * The picker's hint for the date, when the window holds capacity days but none
 * for it. Without any days (no window) the picker marks nothing and says nothing.
 */
export function absencesNotLoadedHint(absences: BoardAbsences, date: string): string | undefined {
  return date && absences.dates.size > 0 && !absences.dates.has(date) ? ABSENCES_NOT_LOADED_HINT : undefined;
}

/** Person options, valued by employee record id, with the absence mark of the date before their description. */
export function withAbsenceMarks<Option extends { value: string; description?: string | undefined }>(
  options: readonly Option[],
  absences: BoardAbsences,
  date: string,
): Option[] {
  return options.map((option) => {
    const mark = absenceMark(absences.days.get(boardDayKey(option.value, date)));
    if (!mark) return option;
    return { ...option, description: option.description ? `${mark} · ${option.description}` : mark };
  });
}

/** The Berlin dates a card covers: its day, or each day of a multi-day all-day entry. */
function cardDates(job: Pick<CalendarJob, 'plannedDate' | 'endDateExclusive'>): string[] {
  if (!job.plannedDate) return [];
  const end = job.endDateExclusive ?? addLocalDays(job.plannedDate, 1);
  const dates: string[] = [];
  for (let date = job.plannedDate; date < end; date = addLocalDays(date, 1)) dates.push(date);
  return dates;
}

/** The card's assignees who are away on one of its days, each with the first mark found. */
export function absentAssignees(
  job: Pick<CalendarJob, 'plannedDate' | 'endDateExclusive' | 'assignedUserIds'>,
  absences: BoardAbsences,
): Array<{ userId: string; mark: string }> {
  const dates = cardDates(job);
  return job.assignedUserIds.flatMap((userId) => {
    const recordId = absences.recordIdByUserId.get(userId);
    if (!recordId) return [];
    for (const date of dates) {
      const mark = absenceMark(absences.days.get(boardDayKey(recordId, date)));
      if (mark) return [{ userId, mark }];
    }
    return [];
  });
}

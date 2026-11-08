import { addLocalDays, splitTimedIntervalByBerlinDate } from '@/lib/date-time/berlin';
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
  /** Each board row's name, people without a login included. */
  nameByRecordId: ReadonlyMap<string, string>;
  /** For a legacy card that names its people by user id only. */
  recordIdByUserId: ReadonlyMap<string, string>;
};

export const NO_BOARD_ABSENCES: BoardAbsences = {
  days: new Map(),
  dates: new Set(),
  nameByRecordId: new Map(),
  recordIdByUserId: new Map(),
};

/** The hint under a picker whose date lies outside the window. */
const ABSENCES_NOT_LOADED_HINT =
  'Für diesen Tag sind keine Abwesenheiten geladen. Beim Speichern prüft WerkFlow sie trotzdem.';

export function indexBoardAbsences(
  days: readonly CalendarBoardDay[],
  rows: readonly CalendarBoardRow[],
): BoardAbsences {
  return {
    days: indexBoardDays(days),
    dates: new Set(days.map((day) => day.date)),
    nameByRecordId: new Map(rows.map((row) => [row.employeeRecordId, row.displayName] as const)),
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

type AbsenceCard = Pick<
  CalendarJob,
  'plannedDate' | 'endDateExclusive' | 'startAt' | 'endAt' | 'assignedUserIds' | 'assignedEmployeeRecordIds'
>;

/** The Berlin dates a card covers: each day of a timed interval, its day, or each day of an all-day entry. */
function cardDates(job: AbsenceCard): string[] {
  if (job.startAt && job.endAt) {
    return splitTimedIntervalByBerlinDate(new Date(job.startAt), new Date(job.endAt)).map(
      (allocation) => allocation.localDate,
    );
  }
  if (!job.plannedDate) return [];
  const end = job.endDateExclusive ?? addLocalDays(job.plannedDate, 1);
  const dates: string[] = [];
  for (let date = job.plannedDate; date < end; date = addLocalDays(date, 1)) dates.push(date);
  return dates;
}

/**
 * The card's assignees who are away on one of its days, each with the first
 * mark found and the board row's name. A card names its people by record,
 * people without a login included; a legacy card by user id.
 */
export function absentAssignees(
  job: AbsenceCard,
  absences: BoardAbsences,
): Array<{ employeeRecordId: string; name: string; mark: string }> {
  const dates = cardDates(job);
  const recordIds =
    job.assignedEmployeeRecordIds ??
    job.assignedUserIds.flatMap((userId) => absences.recordIdByUserId.get(userId) ?? []);
  return recordIds.flatMap((employeeRecordId) => {
    for (const date of dates) {
      const mark = absenceMark(absences.days.get(boardDayKey(employeeRecordId, date)));
      if (mark) {
        const name = absences.nameByRecordId.get(employeeRecordId) ?? 'Mitarbeiter';
        return [{ employeeRecordId, name, mark }];
      }
    }
    return [];
  });
}

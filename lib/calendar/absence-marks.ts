import { addLocalDays, splitTimedIntervalByBerlinDate } from '@/lib/date-time/berlin';
import type { CalendarJob } from '@/lib/jobs/types';
import {
  absenceMark,
  boardDayKey,
  indexBoardDays,
  type CalendarBoardDay,
  type CalendarBoardRow,
  type CalendarBoardRowlessAssignee,
} from './board';
import { indexBoardPeople, unavailabilityLabel, unavailableAssignees, type BoardPeople } from './board-model';

// The card and the person pickers mark who is away from the capacity days the
// calendar window already holds (the planning rules' daily targets), so a
// mark costs no read. A date outside the window has no days: the pickers say
// so, and the save's planning check still warns about an absence.

/** The window's capacity days, indexed for the marks. */
export type BoardAbsences = {
  days: ReadonlyMap<string, CalendarBoardDay>;
  /** The Berlin dates the window holds capacity days for. */
  dates: ReadonlySet<string>;
  /** Each board row and each assignee without one, people without a login included. */
  people: BoardPeople;
  /** For a legacy card that names its people by user id only. */
  recordIdByUserId: ReadonlyMap<string, string>;
};

export const NO_BOARD_ABSENCES: BoardAbsences = {
  days: new Map(),
  dates: new Set(),
  people: new Map(),
  recordIdByUserId: new Map(),
};

/** The hint under a picker whose date lies outside the window. */
const ABSENCES_NOT_LOADED_HINT =
  'Für diesen Tag sind keine Abwesenheiten geladen. Beim Speichern prüft WerkFlow sie trotzdem.';

export function indexBoardAbsences(
  days: readonly CalendarBoardDay[],
  rows: readonly CalendarBoardRow[],
  rowlessAssignees: readonly CalendarBoardRowlessAssignee[],
): BoardAbsences {
  const people = indexBoardPeople(rows, rowlessAssignees);
  return {
    days: indexBoardDays(days),
    dates: new Set(days.map((day) => day.date)),
    people,
    recordIdByUserId: new Map(
      [...people.values()].flatMap((person) =>
        person.userId ? [[person.userId, person.employeeRecordId] as const] : [],
      ),
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

/**
 * The loaded Berlin dates a card covers: each day of a timed interval, or each
 * loaded day of an all-day entry. Only loaded days can carry a mark, so an
 * all-day range reads the window's dates instead of stepping through its own.
 */
function cardDates(job: AbsenceCard, loaded: ReadonlySet<string>): string[] {
  if (job.startAt && job.endAt) {
    return splitTimedIntervalByBerlinDate(new Date(job.startAt), new Date(job.endAt)).map(
      (allocation) => allocation.localDate,
    );
  }
  const start = job.plannedDate;
  if (!start) return [];
  const end = job.endDateExclusive ?? addLocalDays(start, 1);
  return [...loaded].filter((date) => date >= start && date < end).toSorted();
}

/**
 * The card's assignees who are away on one of its days, each with the first
 * mark found and the board row's name. A card names its people by record,
 * people without a login included; a legacy card by user id.
 */
function absentAssignees(
  job: AbsenceCard,
  absences: BoardAbsences,
): Array<{ employeeRecordId: string; name: string; mark: string }> {
  const dates = cardDates(job, absences.dates);
  const recordIds =
    job.assignedEmployeeRecordIds ??
    job.assignedUserIds.flatMap((userId) => absences.recordIdByUserId.get(userId) ?? []);
  return recordIds.flatMap((employeeRecordId) => {
    for (const date of dates) {
      const mark = absenceMark(absences.days.get(boardDayKey(employeeRecordId, date)));
      if (mark) {
        const name = absences.people.get(employeeRecordId)?.displayName ?? 'Mitarbeiter';
        return [{ employeeRecordId, name, mark }];
      }
    }
    return [];
  });
}

/**
 * What the card popover says about its people: first who cannot work the
 * visit at all („Ausgeschieden“, „Zugang beendet“, „Noch nicht eingetreten“),
 * then who of the others is away on one of its days.
 */
export function cardAssigneeMarks(
  job: CalendarJob,
  absences: BoardAbsences,
): Array<{ name: string; mark: string }> {
  const unavailable = unavailableAssignees(job, absences.people);
  return [
    ...unavailable.map(({ name, reason }) => ({ name, mark: unavailabilityLabel(reason) })),
    ...absentAssignees(job, absences)
      .filter((entry) => !unavailable.some((person) => person.employeeRecordId === entry.employeeRecordId))
      .map(({ name, mark }) => ({ name, mark })),
  ];
}

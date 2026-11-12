// An apprentice's Berufsschule days (werk-flow/werkflow-planning#165): the
// office records them as a recurring weekday or as a block period. Each
// active rule becomes full-day `school` spans for the target resolution
// (lib/personnel/targets.ts), which credits a school day with the day's
// normal target. Full days only: there is no half school day.

import { addLocalDays } from '@/lib/date-time/berlin';
import type { Tables } from '@/lib/supabase/database.types';
import { formatGermanDate, formatGermanDateRange } from '@/lib/utils';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { getWeekdayIndex, WEEKDAY_LABELS } from './schedule';
import type { ApprovedAbsenceSpan } from './targets';

export const SCHOOL_DAY_KINDS = ['weekday', 'block'] as const;
type SchoolDayKind = (typeof SCHOOL_DAY_KINDS)[number];

/** The weekdays a weekly rule may name: 0 = Montag … 4 = Freitag. */
export const SCHOOL_WEEKDAYS = [0, 1, 2, 3, 4] as const;

export type SchoolDay = {
  id: string;
  employeeRecordId: string;
  kind: SchoolDayKind;
  /** 0 = Montag … 4 = Freitag for a weekly rule; null for a block. */
  weekday: number | null;
  startDate: string;
  /** Null: a weekly rule without an end. */
  endDate: string | null;
  cancelledAt: string | null;
};

export type SchoolDayRow = Pick<
  Tables<'school_days'>,
  'id' | 'employee_record_id' | 'kind' | 'weekday' | 'start_date' | 'end_date' | 'cancelled_at'
>;

export const SCHOOL_DAY_COLUMNS = 'id, employee_record_id, kind, weekday, start_date, end_date, cancelled_at';

export function toSchoolDay(row: SchoolDayRow): SchoolDay {
  return {
    id: row.id,
    employeeRecordId: row.employee_record_id,
    kind: constrainedValue(SCHOOL_DAY_KINDS, row.kind, 'school day kind'),
    weekday: row.weekday,
    startDate: row.start_date,
    endDate: row.end_date,
    cancelledAt: row.cancelled_at,
  };
}

/**
 * The full-day school spans of the active rules inside a window. A block is
 * one span clamped to the window; a weekly rule is one single-day span per
 * matching weekday. A cancelled rule yields nothing.
 */
function expandSchoolDaySpans(
  schoolDays: readonly SchoolDay[],
  windowStartIso: string,
  windowEndIso: string,
): ApprovedAbsenceSpan[] {
  const spans: ApprovedAbsenceSpan[] = [];
  for (const schoolDay of schoolDays) {
    if (schoolDay.cancelledAt !== null) continue;
    const startDate = schoolDay.startDate > windowStartIso ? schoolDay.startDate : windowStartIso;
    const endDate =
      schoolDay.endDate !== null && schoolDay.endDate < windowEndIso ? schoolDay.endDate : windowEndIso;
    if (startDate > endDate) continue;
    if (schoolDay.kind === 'block') {
      spans.push({ type: 'school', startDate, endDate, dayPortion: 'full' });
      continue;
    }
    for (let date = startDate; date <= endDate; date = addLocalDays(date, 1)) {
      if (getWeekdayIndex(date) === schoolDay.weekday) {
        spans.push({ type: 'school', startDate: date, endDate: date, dayPortion: 'full' });
      }
    }
  }
  return spans;
}

/** The school spans per employee record, for the readers that index absences by record. */
export function groupSchoolDaySpansByRecord(
  schoolDays: readonly SchoolDay[],
  windowStartIso: string,
  windowEndIso: string,
): Map<string, ApprovedAbsenceSpan[]> {
  const spansByRecord = new Map<string, ApprovedAbsenceSpan[]>();
  for (const schoolDay of schoolDays) {
    const spans = expandSchoolDaySpans([schoolDay], windowStartIso, windowEndIso);
    if (spans.length === 0) continue;
    spansByRecord.set(schoolDay.employeeRecordId, [
      ...(spansByRecord.get(schoolDay.employeeRecordId) ?? []),
      ...spans,
    ]);
  }
  return spansByRecord;
}

/** How the office and the apprentice read a rule, e.g. „Jeden Montag ab 01.09.2026“. */
export function describeSchoolDay(schoolDay: SchoolDay): string {
  if (schoolDay.kind === 'block') {
    return `Blockunterricht ${formatGermanDateRange(schoolDay.startDate, schoolDay.endDate ?? schoolDay.startDate)}`;
  }
  const weekday = WEEKDAY_LABELS[schoolDay.weekday ?? 0];
  const until = schoolDay.endDate === null ? '' : ` bis ${formatGermanDate(schoolDay.endDate)}`;
  return `Jeden ${weekday} ab ${formatGermanDate(schoolDay.startDate)}${until}`;
}

/** The German sentence for each school-day failure code; shared codes come from lib/action-messages.ts. */
export const SCHOOL_DAY_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid_dates: 'Bitte wähle gültige Daten aus.',
  invalid_range: 'Das Ende darf nicht vor dem Beginn liegen.',
  start_too_early: 'Der Beginn darf höchstens bis zum 1. Januar des Vorjahres zurückliegen.',
  range_too_long:
    'Der Zeitraum ist zu lang. Ein Block dauert höchstens ein Jahr, eine Regel höchstens vier Jahre.',
  block_needs_end: 'Ein Blockunterricht braucht ein Enddatum.',
  weekday_required: 'Bitte wähle einen Wochentag aus.',
  record_not_found: 'Die Personalakte wurde nicht gefunden.',
  not_an_apprentice: 'Berufsschule lässt sich nur für Personen in Ausbildung eintragen.',
  school_day_overlap: 'Für diese Tage ist schon Berufsschule eingetragen.',
  school_day_not_found:
    'Der Eintrag wurde inzwischen geändert. Lade die Seite neu und versuche es noch einmal.',
  school_day_end_not_earlier:
    'Das neue Ende muss vor dem bisherigen liegen. Für eine Verlängerung erfasse eine neue Regel.',
  period_closed:
    'Der Zeitraum berührt einen abgeschlossenen Monat. Abgeschlossene Monate bleiben, wie sie sind; wähle Tage danach.',
};

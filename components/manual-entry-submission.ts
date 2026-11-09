import { SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import { isDateInClosedPeriod, type ClosedTimePeriod } from '@/lib/time-tracking/closed-period-dates';
import type { ManualEntryInput } from '@/lib/time-tracking/types';
import { describeTimeValidationFailure } from '@/lib/time-tracking/validation-messages';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { isClockTime } from '@/lib/time-corrections/types';
import { toLocalDateString } from '@/lib/utils';
import type { ManualEntryMode } from '@/components/use-manual-entry-form-draft';

// What a press of „Speichern“ in the manual entry form sends: nothing while a
// field is missing or wrong, the manual entries of the day, or own time of an
// earlier day with its reason (manual-entry-past-day.ts).

/**
 * True when the picked calendar date lies before today in Berlin, the day the
 * server refuses an employee's manual entry before.
 */
export function isBeforeToday(date: Date | undefined, todayIso: string = getBusinessTodayIso()): boolean {
  return date !== undefined && toLocalDateString(date) < todayIso;
}

export type ManualEntryFieldErrors = {
  member: string | undefined;
  date: string | undefined;
  clockIn: string | undefined;
  clockOut: string | undefined;
  reason: string | undefined;
};

export const NO_MANUAL_ENTRY_FIELD_ERRORS: ManualEntryFieldErrors = {
  member: undefined,
  date: undefined,
  clockIn: undefined,
  clockOut: undefined,
  reason: undefined,
};

export type ManualEntryFormValues = {
  isAdminOrManager: boolean;
  selectedUserId: string;
  entryMode: ManualEntryMode;
  selectedDate: Date | undefined;
  /** `HH:MM`, or '' while the person has not entered the time. */
  clockInTime: string;
  clockOutTime: string;
  /** Own time of an earlier day that waits for an approver: it needs the reason. */
  needsReason: boolean;
  reason: string;
  closedPeriods: readonly ClosedTimePeriod[];
};

export type ManualEntrySubmission =
  | { kind: 'invalid'; fieldErrors: ManualEntryFieldErrors }
  | { kind: 'entries'; dateIso: string; entries: ManualEntryInput[] }
  | { kind: 'past-day'; dateIso: string; reason: string };

const MISSING_TIME = 'Bitte gib eine Uhrzeit an.';

function needsClockIn(mode: ManualEntryMode): boolean {
  return mode === 'clock_in' || mode === 'both';
}

function needsClockOut(mode: ManualEntryMode): boolean {
  return mode === 'clock_out' || mode === 'both';
}

/** The clock-in and clock-out entries the form's mode asks for, on the chosen day. */
function buildManualEntries(
  entryMode: ManualEntryMode,
  dateIso: string,
  clockInTime: string,
  clockOutTime: string,
): ManualEntryInput[] {
  const entries: ManualEntryInput[] = [];
  if (needsClockIn(entryMode)) {
    entries.push({
      entryType: 'clock_in',
      timestamp: new Date(`${dateIso}T${clockInTime}:00`).toISOString(),
    });
  }
  if (needsClockOut(entryMode)) {
    entries.push({
      entryType: 'clock_out',
      timestamp: new Date(`${dateIso}T${clockOutTime}:00`).toISOString(),
    });
  }
  return entries;
}

/** Every field error of the form, in form order. */
function manualEntryFieldErrors(
  values: ManualEntryFormValues,
  dateIso: string | null,
): ManualEntryFieldErrors {
  const { entryMode, clockInTime, clockOutTime } = values;
  return {
    member:
      values.isAdminOrManager && !values.selectedUserId ? 'Bitte wähle einen Mitarbeiter aus.' : undefined,
    date: !dateIso
      ? 'Bitte wähle ein gültiges Datum.'
      : isDateInClosedPeriod(dateIso, values.closedPeriods)
        ? SHARED_FAILURE_MESSAGES.period_closed
        : undefined,
    // Own time of an earlier day carries a timeline instead (manual-entry-past-day.ts).
    clockIn:
      !values.needsReason && needsClockIn(entryMode) && !isClockTime(clockInTime) ? MISSING_TIME : undefined,
    clockOut:
      values.needsReason || !needsClockOut(entryMode)
        ? undefined
        : !isClockTime(clockOutTime)
          ? MISSING_TIME
          : entryMode === 'both' && isClockTime(clockInTime) && clockOutTime <= clockInTime
            ? describeTimeValidationFailure({ error: 'pair_clock_in_not_before_clock_out' })
            : undefined,
    reason: values.needsReason && !values.reason.trim() ? 'Bitte gib einen Grund an.' : undefined,
  };
}

/** The field ids in form order, for focusFirstInvalidField; an earlier day's timeline follows the date. */
export function manualEntryFieldIds(
  errors: ManualEntryFieldErrors,
  timelineErrors: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    'manual-entry-member': errors.member,
    'manual-entry-date': errors.date,
    ...timelineErrors,
    clockInTime: errors.clockIn,
    clockOutTime: errors.clockOut,
    'manual-entry-reason': errors.reason,
  };
}

/** What the form sends for its values: nothing while a field error stands. */
export function planManualEntrySubmission(values: ManualEntryFormValues): ManualEntrySubmission {
  const dateIso = values.selectedDate ? toLocalDateString(values.selectedDate) : null;
  const fieldErrors = manualEntryFieldErrors(values, dateIso);
  if (!dateIso || Object.values(fieldErrors).some(Boolean)) return { kind: 'invalid', fieldErrors };
  if (values.needsReason) return { kind: 'past-day', dateIso, reason: values.reason.trim() };
  return {
    kind: 'entries',
    dateIso,
    entries: buildManualEntries(values.entryMode, dateIso, values.clockInTime, values.clockOutTime),
  };
}

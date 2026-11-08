// Whether a substitute is away during a delegation window. The picker counts
// the absent days and the dialog warns; the create action refuses an
// unacknowledged substitute who is away on every day. One rule for both, so the
// warning the owner saw is the one the server enforces.

import { ROLE_LABELS } from '@/lib/roles';
import type { ResponsibilityPerson } from './types';

/**
 * One full-day absence of a person, neutral: approved vacation and reported
 * sickness look the same, as in the shared calendar. An open sickness report
 * has no end date and lasts until further notice.
 */
export type SubstituteAbsenceSpan = {
  employeeRecordId: string;
  startDate: string;
  endDate: string | null;
};

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS;
}

/** The days of the inclusive window; 0 for a window that ends before it starts. */
export function windowDayCount(validFrom: string, validUntil: string): number {
  return Math.max(0, dayNumber(validUntil) - dayNumber(validFrom) + 1);
}

/** How many days of the inclusive window the person is absent; overlapping spans count a day once. */
export function absentDaysInWindow(
  spans: readonly SubstituteAbsenceSpan[],
  employeeRecordId: string,
  validFrom: string,
  validUntil: string,
): number {
  const windowStart = dayNumber(validFrom);
  const windowEnd = dayNumber(validUntil);
  const absentDays = new Set<number>();
  for (const span of spans) {
    if (span.employeeRecordId !== employeeRecordId) continue;
    const start = Math.max(windowStart, dayNumber(span.startDate));
    const end = Math.min(windowEnd, span.endDate === null ? windowEnd : dayNumber(span.endDate));
    for (let day = start; day <= end; day += 1) absentDays.add(day);
  }
  return absentDays.size;
}

/** Whether the person is absent on every day of a valid window. */
export function isAbsentForWholeWindow(
  spans: readonly SubstituteAbsenceSpan[],
  employeeRecordId: string,
  validFrom: string,
  validUntil: string,
): boolean {
  const days = windowDayCount(validFrom, validUntil);
  return days > 0 && absentDaysInWindow(spans, employeeRecordId, validFrom, validUntil) === days;
}

/** The picker's second line for a possible substitute: role, and the absent days in the window. */
export function substituteOptionDescription(
  person: ResponsibilityPerson,
  absences: readonly SubstituteAbsenceSpan[] | null,
  validFrom: string,
  validUntil: string,
): string {
  const role = ROLE_LABELS[person.role];
  const days = windowDayCount(validFrom, validUntil);
  if (!absences || days === 0) return role;
  const absent = absentDaysInWindow(absences, person.employeeRecordId, validFrom, validUntil);
  if (absent === 0) return role;
  if (absent === days) return `${role} · im ganzen Zeitraum abwesend`;
  return `${role} · an ${absent} von ${days} Tagen abwesend`;
}

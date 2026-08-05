import type { Database } from '@/lib/supabase/database.types';
import { toBusinessIsoDate } from '@/lib/personnel/types';

export type WorkScheduleRow =
  Database['public']['Tables']['work_schedules']['Row'];

// Weekday index convention across the schedule domain: 0 = Montag … 6 = Sonntag
// (matches the weekly time chart's Monday-first layout).
export const WEEKDAY_LABELS = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
] as const;

export const WEEKDAY_SHORT_LABELS = [
  'Mo',
  'Di',
  'Mi',
  'Do',
  'Fr',
  'Sa',
  'So',
] as const;

export type WorkSchedule = {
  id: string;
  organizationId: string;
  employeeRecordId: string;
  validFrom: string;
  /** Minutes per weekday, index 0 = Montag … 6 = Sonntag. 0 = kein Arbeitstag. */
  dayMinutes: number[];
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toWorkSchedule(row: WorkScheduleRow): WorkSchedule {
  return {
    id: row.id,
    organizationId: row.organization_id,
    employeeRecordId: row.employee_record_id,
    validFrom: row.valid_from,
    dayMinutes: [
      row.monday_minutes,
      row.tuesday_minutes,
      row.wednesday_minutes,
      row.thursday_minutes,
      row.friday_minutes,
      row.saturday_minutes,
      row.sunday_minutes,
    ],
    note: row.note,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const WORK_SCHEDULE_DAY_COLUMNS = [
  'monday_minutes',
  'tuesday_minutes',
  'wednesday_minutes',
  'thursday_minutes',
  'friday_minutes',
  'saturday_minutes',
  'sunday_minutes',
] as const;

/** Total contracted minutes per week for one schedule version. */
export function getWeeklyScheduleMinutes(schedule: WorkSchedule): number {
  return schedule.dayMinutes.reduce((total, minutes) => total + minutes, 0);
}

/**
 * The schedule version effective on a date: newest version with
 * `valid_from <= date` (same rule as `getEffectiveCondition`). Historical days
 * therefore keep the version that was effective then.
 */
export function getEffectiveSchedule(
  schedules: WorkSchedule[],
  onDateIso: string
): WorkSchedule | null {
  const applicable = schedules
    .filter((schedule) => schedule.validFrom <= onDateIso)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  return applicable[0] ?? null;
}

/**
 * Weekday index (0 = Montag … 6 = Sonntag) of an ISO calendar date.
 * Parses the date parts directly so the host time zone can never shift it.
 */
export function getWeekdayIndex(dateIso: string): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  const jsWeekday = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  return jsWeekday === 0 ? 6 : jsWeekday - 1;
}

/** ISO dates Monday–Sunday of the week containing the given Berlin business date. */
export function getBusinessWeekDates(referenceDate: Date = new Date()): string[] {
  const todayIso = toBusinessIsoDate(referenceDate);
  const [year, month, day] = todayIso.split('-').map(Number);
  const todayUtcMs = Date.UTC(year, (month ?? 1) - 1, day ?? 1);
  const weekdayIndex = getWeekdayIndex(todayIso);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(todayUtcMs + (i - weekdayIndex) * 86_400_000);
    const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    dates.push(iso);
  }
  return dates;
}

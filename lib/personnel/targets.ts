// P1-04 target-computation contract: the daily target for (person, date) is a
// pure function of the schedule version effective on that date, the holiday /
// closure state effective on that date, and the missing-configuration
// exception. Nothing here is persisted — later corrections to configuration
// are traceable through their own histories, and historical days always
// resolve against what was effective then.

import { z } from 'zod';

import type { EmploymentCondition } from '@/lib/personnel/types';
import { toBusinessIsoDate } from '@/lib/personnel/types';
import { getEffectiveCondition } from '@/lib/personnel/types';
import {
  getEffectiveSchedule,
  getWeekdayIndex,
  type WorkSchedule,
} from '@/lib/personnel/schedule';
import {
  getHolidayName,
  getPublicHolidaysForYear,
  isHolidayRegion,
  type PublicHoliday,
} from '@/lib/personnel/holidays';

/**
 * The legacy fixed daily goal (8h). With the labeled fallback cascade (owner
 * decision, P1-04) this value is only ever used as the visibly labeled
 * `default` source — never as a silent assumption.
 */
export const DEFAULT_DAILY_TARGET_MINUTES = 480;

export type DailyTargetSource =
  // A real work-schedule version effective on the date.
  | 'schedule'
  // No schedule, but the effective employment condition has weekly hours:
  // spread across Montag–Freitag, labeled as derived.
  | 'derived'
  // Neither exists: the legacy 8h default, visibly labeled as unconfigured.
  | 'default';

export type DailyTarget = {
  date: string;
  /** 0 = Montag … 6 = Sonntag */
  weekday: number;
  /** Effective target after holiday/closure zeroing. */
  targetMinutes: number;
  /** Target from the schedule/derivation before holiday/closure zeroing. */
  baseTargetMinutes: number;
  source: DailyTargetSource;
  isHoliday: boolean;
  holidayName: string | null;
  isClosureDay: boolean;
  closureLabel: string | null;
};

// Effective-from history for the org's holiday-region selection, following the
// break_policy_history precedent. Unlike break policy there is deliberately no
// fallback to the first entry: days before the first selection have no holiday
// context, so selecting a region never rewrites what was true for past days.
export const holidayRegionHistoryEntrySchema = z.object({
  region: z.string(),
  effectiveFrom: z.string().datetime(),
});

export type HolidayRegionHistoryEntry = z.infer<
  typeof holidayRegionHistoryEntrySchema
>;

export function parseHolidayRegionHistory(
  value: unknown
): HolidayRegionHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => holidayRegionHistoryEntrySchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data)
    .sort(
      (a, b) =>
        new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime()
    );
}

export type ClosureDay = {
  /** Row id, present when loaded from the database (needed for removal). */
  id?: string;
  closureDate: string;
  label: string | null;
};

export type OrganizationHolidayCalendar = {
  holidayRegion: string | null;
  holidayRegionHistory: HolidayRegionHistoryEntry[];
  closureDays: ClosureDay[];
};

export const EMPTY_HOLIDAY_CALENDAR: OrganizationHolidayCalendar = {
  holidayRegion: null,
  holidayRegionHistory: [],
  closureDays: [],
};

/**
 * The holiday region effective on a Berlin business date: newest history entry
 * whose effectiveFrom (as a Berlin date) is on or before the date; none → null.
 */
export function resolveHolidayRegionOnDate(
  calendar: Pick<
    OrganizationHolidayCalendar,
    'holidayRegion' | 'holidayRegionHistory'
  >,
  dateIso: string
): string | null {
  const history = calendar.holidayRegionHistory;
  if (history.length === 0) {
    // No recorded history: the current selection (if any) applies from now on;
    // without history we cannot place it in time, so treat it as effective.
    return calendar.holidayRegion;
  }

  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (toBusinessIsoDate(new Date(entry.effectiveFrom)) <= dateIso) {
      return entry.region.length > 0 ? entry.region : null;
    }
  }
  return null;
}

export type ResolveDailyTargetInput = {
  /** ISO Berlin business date (YYYY-MM-DD). */
  dateIso: string;
  schedules: WorkSchedule[];
  conditions: EmploymentCondition[];
  calendar: OrganizationHolidayCalendar;
};

export function resolveDailyTarget({
  dateIso,
  schedules,
  conditions,
  calendar,
}: ResolveDailyTargetInput): DailyTarget {
  const weekday = getWeekdayIndex(dateIso);

  let source: DailyTargetSource;
  let baseTargetMinutes: number;

  const schedule = getEffectiveSchedule(schedules, dateIso);
  if (schedule) {
    source = 'schedule';
    baseTargetMinutes = schedule.dayMinutes[weekday] ?? 0;
  } else {
    const condition = getEffectiveCondition(
      conditions,
      new Date(`${dateIso}T12:00:00+02:00`)
    );
    if (condition?.weeklyHours != null && condition.weeklyHours > 0) {
      source = 'derived';
      // Spread across Montag–Freitag; weekends carry no derived target.
      baseTargetMinutes =
        weekday <= 4 ? Math.round((condition.weeklyHours * 60) / 5) : 0;
    } else {
      // Legacy behavior, visibly labeled: 480 on every day exactly matches the
      // pre-P1-04 overtime math, so nothing shifts for unconfigured members.
      source = 'default';
      baseTargetMinutes = DEFAULT_DAILY_TARGET_MINUTES;
    }
  }

  const region = resolveHolidayRegionOnDate(calendar, dateIso);
  const holidayName =
    region && isHolidayRegion(region) ? getHolidayName(region, dateIso) : null;

  const closure = calendar.closureDays.find(
    (day) => day.closureDate === dateIso
  );

  const isHoliday = holidayName !== null;
  const isClosureDay = closure !== undefined;

  return {
    date: dateIso,
    weekday,
    targetMinutes: isHoliday || isClosureDay ? 0 : baseTargetMinutes,
    baseTargetMinutes,
    source,
    isHoliday,
    holidayName,
    isClosureDay,
    closureLabel: closure?.label ?? null,
  };
}

export function resolveDailyTargets(
  dates: string[],
  input: Omit<ResolveDailyTargetInput, 'dateIso'>
): DailyTarget[] {
  return dates.map((dateIso) => resolveDailyTarget({ dateIso, ...input }));
}

/** Sum of effective targets, e.g. for a week's Soll display. */
export function sumTargetMinutes(targets: DailyTarget[]): number {
  return targets.reduce((total, target) => total + target.targetMinutes, 0);
}

/**
 * All holidays that actually apply to the organization between two years,
 * honoring the effective-from region history per date (calendar context for
 * planning surfaces). Dates before the first region selection yield nothing.
 */
export function getHolidayContextDays(
  calendar: Pick<
    OrganizationHolidayCalendar,
    'holidayRegion' | 'holidayRegionHistory'
  >,
  fromYear: number,
  toYear: number
): PublicHoliday[] {
  const candidateRegions = new Set<string>();
  if (calendar.holidayRegion) candidateRegions.add(calendar.holidayRegion);
  for (const entry of calendar.holidayRegionHistory) {
    if (entry.region.length > 0) candidateRegions.add(entry.region);
  }

  const result: PublicHoliday[] = [];
  for (const region of candidateRegions) {
    if (!isHolidayRegion(region)) continue;
    for (let year = fromYear; year <= toYear; year++) {
      for (const holiday of getPublicHolidaysForYear(region, year)) {
        if (resolveHolidayRegionOnDate(calendar, holiday.date) === region) {
          result.push(holiday);
        }
      }
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The label shown wherever a non-`schedule` source must be visible as an
 * exception rather than a silent assumption (spec: missing configuration is
 * never a silent eight-hour day).
 */
export function getTargetSourceHint(target: DailyTarget): string | null {
  if (target.source === 'derived') {
    return 'Aus den Wochenstunden der Beschäftigung abgeleitet – noch kein Arbeitszeitmodell hinterlegt.';
  }
  if (target.source === 'default') {
    return 'Kein Arbeitszeitmodell hinterlegt – Standardziel 8 Stunden.';
  }
  return null;
}

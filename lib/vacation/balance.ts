// P1-06 balance contract: WerkFlow stores the organization's entered
// entitlement and shows arithmetic (Anspruch − genommen = Rest). It makes no
// legal claims — no automatic pro-rata, no expiry law. Missing configuration
// is a visible labeled exception, never an invented number.
//
// Vacation-day consumption is DERIVED from the P1-04 target truth: a day only
// costs entitlement if it has a positive resolved base target. Weekends,
// holidays, closure days, and schedule-free days therefore cost nothing with
// zero new date logic. For the labeled `default` source (no configuration at
// all) only Montag–Freitag consume, mirroring the `derived` weekday spread so
// an unconfigured person never pays seven days per week.

import type { EmploymentCondition } from '@/lib/personnel/types';
import type { WorkSchedule } from '@/lib/personnel/schedule';
import {
  resolveDailyTarget,
  type OrganizationHolidayCalendar,
} from '@/lib/personnel/targets';
import type { VacationDayPortion, VacationRequest } from './types';

/**
 * The entitlement for a vacation year (calendar year) is the
 * `vacation_days_per_year` of the newest employment condition with
 * `valid_from` on or before December 31 of that year. A mid-year change means
 * the latest value entered for the year governs it — deliberately simple,
 * explainable arithmetic on entered numbers (owner-facing decision, P1-06).
 * Returns null when no condition carries a value: the labeled
 * „kein Urlaubsanspruch hinterlegt" exception.
 */
export function resolveVacationEntitlementForYear(
  conditions: EmploymentCondition[],
  year: number
): number | null {
  const yearEnd = `${year}-12-31`;
  const effective = conditions
    .filter((condition) => condition.validFrom <= yearEnd)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  return effective?.vacationDaysPerYear ?? null;
}

export type VacationCountingContext = {
  schedules: WorkSchedule[];
  conditions: EmploymentCondition[];
  calendar: OrganizationHolidayCalendar;
};

/** Inclusive ISO-date iteration without timezone drift. */
export function listIsoDatesInRange(
  startDate: string,
  endDate: string
): string[] {
  const dates: string[] = [];
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  const cursor = Date.UTC(startYear, startMonth - 1, startDay);
  const last = Date.UTC(endYear, endMonth - 1, endDay);
  for (let time = cursor; time <= last; time += 86_400_000) {
    const date = new Date(time);
    dates.push(
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
    );
  }
  return dates;
}

/**
 * Whether a single date consumes entitlement, before applying the portion.
 * Derived from the resolved target (no absence input — consumption asks what
 * the day would have required, not what it requires after the vacation).
 */
export function doesDateConsumeVacation(
  dateIso: string,
  context: VacationCountingContext
): boolean {
  const target = resolveDailyTarget({ dateIso, ...context });
  if (target.targetMinutes <= 0) return false;
  // Labeled default source: the legacy 480 applies to every day including
  // weekends for overtime continuity; vacation must only cost Montag–Freitag.
  if (target.source === 'default' && target.weekday > 4) return false;
  return true;
}

/**
 * Entitlement days consumed by a request range, split per vacation year (a
 * range crossing New Year charges each year separately).
 */
export function countVacationDaysByYear(
  input: {
    startDate: string;
    endDate: string;
    dayPortion: VacationDayPortion;
  },
  context: VacationCountingContext
): Record<string, number> {
  const perDay = input.dayPortion === 'half_day' ? 0.5 : 1;
  const daysByYear: Record<string, number> = {};
  for (const dateIso of listIsoDatesInRange(input.startDate, input.endDate)) {
    if (!doesDateConsumeVacation(dateIso, context)) continue;
    const year = dateIso.slice(0, 4);
    daysByYear[year] = (daysByYear[year] ?? 0) + perDay;
  }
  return daysByYear;
}

/** Total consumed days of a range (sum across years). */
export function countVacationDays(
  input: {
    startDate: string;
    endDate: string;
    dayPortion: VacationDayPortion;
  },
  context: VacationCountingContext
): number {
  return Object.values(countVacationDaysByYear(input, context)).reduce(
    (total, days) => total + days,
    0
  );
}

export type VacationBalance = {
  year: number;
  /** null = kein Urlaubsanspruch hinterlegt (labeled exception, never 0). */
  entitlementDays: number | null;
  /** Sum of approval-time snapshots of approved requests for this year. */
  takenDays: number;
  /** Live-computed preview of pending requests for this year. */
  pendingDays: number;
  /** entitlement − taken; null while no entitlement is stored. */
  remainingDays: number | null;
};

/**
 * The explainable balance for one vacation year. `takenDays` sums the
 * approval-time snapshots (`approvedDaysByYear`) so a later schedule change
 * never silently rewrites a decided balance; pending days are a live preview.
 */
export function computeVacationBalance(
  year: number,
  requests: VacationRequest[],
  context: VacationCountingContext
): VacationBalance {
  const yearKey = String(year);
  let takenDays = 0;
  let pendingDays = 0;

  for (const request of requests) {
    if (request.status === 'approved') {
      takenDays += request.approvedDaysByYear?.[yearKey] ?? 0;
    } else if (request.status === 'pending') {
      pendingDays +=
        countVacationDaysByYear(request, context)[yearKey] ?? 0;
    }
  }

  const entitlementDays = resolveVacationEntitlementForYear(
    context.conditions,
    year
  );

  return {
    year,
    entitlementDays,
    takenDays,
    pendingDays,
    remainingDays:
      entitlementDays === null ? null : entitlementDays - takenDays,
  };
}

/** „3 Tage", „0,5 Tage", „1 Tag" — German day formatting for balances. */
export function formatVacationDays(days: number): string {
  const formatted = new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(days);
  return `${formatted} ${days === 1 ? 'Tag' : 'Tage'}`;
}

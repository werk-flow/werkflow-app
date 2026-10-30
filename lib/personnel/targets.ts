// P1-04 target-computation contract: the daily target for (person, date) is a
// pure function of the employment interval, the schedule version effective on
// that date, the holiday / closure state effective on that date, and the
// missing-configuration exception. Nothing here is persisted — later corrections to configuration
// are traceable through their own histories, and historical days always
// resolve against what was effective then.

import { z } from '@/lib/zod';

import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import type { EmploymentCondition } from '@/lib/personnel/types';
import { getEffectiveCondition } from '@/lib/personnel/types';
import { getEffectiveSchedule, getWeekdayIndex, type WorkSchedule } from '@/lib/personnel/schedule';
import {
  getHolidayName,
  getPublicHolidaysForYear,
  isHolidayRegion,
  type PublicHoliday,
} from '@/lib/personnel/holidays';

/**
 * The fixed daily goal (8h) of the labeled `default` source (owner decision,
 * P1-04): Montag–Freitag only, like the `derived` weekday spread, and never a
 * silent assumption.
 */
export const DEFAULT_DAILY_TARGET_MINUTES = 480;

type DailyTargetSource =
  // A real work-schedule version effective on the date.
  | 'schedule'
  // No schedule, but the effective employment condition has weekly hours:
  // spread across Montag–Freitag, labeled as derived.
  | 'derived'
  // Neither exists: the 8h default on Montag–Freitag, visibly labeled as unconfigured.
  | 'default';

/**
 * The days a person is employed: the personnel record's entry and exit dates,
 * both inclusive Berlin business dates, null when open. The employment
 * lifecycle writes the exit date on an exit and a planned exit, so the
 * record's exit date is the lifecycle exit; the Plantafel hatching and the
 * period's people read the same two columns.
 */
export type EmploymentInterval = {
  entryDate: string | null;
  exitDate: string | null;
};

/**
 * Effective absence span feeding target resolution. Only EFFECTIVE absence
 * may ever reach this input: approved vacation (P1-06; pending requests are
 * provisional and never change targets) and active sickness reports (P1-08;
 * a report is a fact and effective immediately, cancelled reports never
 * qualify, open-ended reports are clamped to the caller's window by the
 * loader). One union, one mechanism — no parallel absence pathway.
 */
export type ApprovedAbsenceSpan = {
  type: 'vacation' | 'sickness';
  /** Inclusive ISO Berlin business dates. */
  startDate: string;
  endDate: string;
  dayPortion: 'full' | 'half_day';
};

type DailyTargetAbsence = {
  type: ApprovedAbsenceSpan['type'];
  portion: ApprovedAbsenceSpan['dayPortion'];
};

export type DailyTarget = {
  date: string;
  /** 0 = Montag … 6 = Sonntag */
  weekday: number;
  /** Effective target after holiday/closure zeroing and approved absence. */
  targetMinutes: number;
  /** Target from the schedule/derivation before holiday/closure zeroing; 0 outside employment. */
  baseTargetMinutes: number;
  source: DailyTargetSource;
  /** Set when the date lies before the entry or after the exit date. */
  outsideEmployment: 'before_entry' | 'after_exit' | null;
  isHoliday: boolean;
  holidayName: string | null;
  isClosureDay: boolean;
  closureLabel: string | null;
  /** Approved absence covering this date, if any (P1-06: vacation). */
  absence: DailyTargetAbsence | null;
};

// Effective-from history for the org's holiday-region selection, following the
// break_policy_history precedent. Unlike break policy there is deliberately no
// fallback to the first entry: days before the first selection have no holiday
// context, so selecting a region never rewrites what was true for past days.
export const holidayRegionHistoryEntrySchema = z.object({
  region: z.string(),
  effectiveFrom: z.string().datetime(),
});

export type HolidayRegionHistoryEntry = z.infer<typeof holidayRegionHistoryEntrySchema>;

export function parseHolidayRegionHistory(value: unknown): HolidayRegionHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => holidayRegionHistoryEntrySchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data)
    .sort((a, b) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime());
}

export type ClosureDay = {
  /** Row id, present when loaded from the database (needed for removal). */
  id?: string | undefined;
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
 * The unit tests pin the history cases here instead of through a daily target.
 * @internal
 */
export function resolveHolidayRegionOnDate(
  calendar: Pick<OrganizationHolidayCalendar, 'holidayRegion' | 'holidayRegionHistory'>,
  dateIso: string,
): string | null {
  if (calendar.holidayRegionHistory.length === 0) {
    // No recorded history: the current selection (if any) applies from now on;
    // without history we cannot place it in time, so treat it as effective.
    return calendar.holidayRegion;
  }

  // parseHolidayRegionHistory sorts ascending, but calendars can be assembled
  // elsewhere (tests, future callers) — order defensively, non-mutating.
  const history = [...calendar.holidayRegionHistory].sort(
    (a, b) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime(),
  );

  for (const entry of history.reverse()) {
    if (formatBerlinLocalDate(entry.effectiveFrom) <= dateIso) {
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
  /** Required, so no reader can forget the entry and exit boundary. */
  employment: EmploymentInterval;
  /** Approved absence spans for the person (P1-06). Optional and additive. */
  absences?: ApprovedAbsenceSpan[];
};

function resolveOutsideEmployment(
  employment: EmploymentInterval,
  dateIso: string,
): DailyTarget['outsideEmployment'] {
  if (employment.entryDate !== null && dateIso < employment.entryDate) return 'before_entry';
  if (employment.exitDate !== null && dateIso > employment.exitDate) return 'after_exit';
  return null;
}

export function resolveDailyTarget({
  dateIso,
  schedules,
  conditions,
  calendar,
  employment,
  absences,
}: ResolveDailyTargetInput): DailyTarget {
  const weekday = getWeekdayIndex(dateIso);
  const outsideEmployment = resolveOutsideEmployment(employment, dateIso);

  let source: DailyTargetSource;
  let baseTargetMinutes: number;

  const schedule = getEffectiveSchedule(schedules, dateIso);
  if (schedule) {
    source = 'schedule';
    baseTargetMinutes = schedule.dayMinutes[weekday] ?? 0;
  } else {
    // Noon UTC always maps onto the same Berlin calendar date, in CET and
    // CEST alike — no fixed-offset assumption around DST changes.
    const condition = getEffectiveCondition(conditions, new Date(`${dateIso}T12:00:00Z`));
    if (condition?.weeklyHours != null && condition.weeklyHours > 0) {
      source = 'derived';
      // Spread across Montag–Freitag; weekends carry no derived target.
      baseTargetMinutes = weekday <= 4 ? Math.round((condition.weeklyHours * 60) / 5) : 0;
    } else {
      // Visibly labeled, Montag–Freitag like the derived spread (owner
      // decision, werk-flow/werkflow-planning#131): an unconfigured person
      // owes no weekend.
      source = 'default';
      baseTargetMinutes = weekday <= 4 ? DEFAULT_DAILY_TARGET_MINUTES : 0;
    }
  }
  // Outside employment the person owes nothing, so not even an informational
  // absence treatment can bring a base target back.
  if (outsideEmployment) baseTargetMinutes = 0;

  const region = resolveHolidayRegionOnDate(calendar, dateIso);
  const holidayName = region && isHolidayRegion(region) ? getHolidayName(region, dateIso) : null;

  const closure = calendar.closureDays.find((day) => day.closureDate === dateIso);

  const isHoliday = holidayName !== null;
  const isClosureDay = closure !== undefined;

  // A day can be covered by several spans (sickness during approved vacation
  // is a real case). Coverage strength and attribution are separate concerns:
  // any full-day span makes the day fully absent — a half-day vacation must
  // never weaken a full-day sickness — and among equally strong spans
  // vacation keeps the attribution, so days with a single span (all pre-P1-08
  // data) behave bit-identically.
  const coveringSpans = (absences ?? []).filter(
    (span) => span.startDate <= dateIso && dateIso <= span.endDate,
  );
  const fullSpans = coveringSpans.filter((span) => span.dayPortion === 'full');
  const strongestSpans = fullSpans.length > 0 ? fullSpans : coveringSpans;
  const absenceSpan = strongestSpans.find((span) => span.type === 'vacation') ?? strongestSpans[0];
  const absence: DailyTargetAbsence | null = absenceSpan
    ? { type: absenceSpan.type, portion: absenceSpan.dayPortion }
    : null;

  // Zeroing order: a holiday/closure day already has no target, so absence on
  // such a day changes nothing (and costs no entitlement — see the vacation
  // day-counting rule). Otherwise a full absent day is 0 and a half day halves
  // the base target.
  let targetMinutes: number;
  if (isHoliday || isClosureDay) {
    targetMinutes = 0;
  } else if (absence?.portion === 'full') {
    targetMinutes = 0;
  } else if (absence?.portion === 'half_day') {
    targetMinutes = Math.round(baseTargetMinutes / 2);
  } else {
    targetMinutes = baseTargetMinutes;
  }

  return {
    date: dateIso,
    weekday,
    targetMinutes,
    baseTargetMinutes,
    source,
    outsideEmployment,
    isHoliday,
    holidayName,
    isClosureDay,
    closureLabel: closure?.label ?? null,
    absence,
  };
}

export function resolveDailyTargets(
  dates: string[],
  input: Omit<ResolveDailyTargetInput, 'dateIso'>,
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
  calendar: Pick<OrganizationHolidayCalendar, 'holidayRegion' | 'holidayRegionHistory'>,
  fromYear: number,
  toYear: number,
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
 * never a silent eight-hour day). Outside employment no configuration applies.
 */
export function getTargetSourceHint(target: DailyTarget): string | null {
  if (target.outsideEmployment) return null;
  if (target.source === 'derived') {
    return 'Aus den Wochenstunden der Beschäftigung abgeleitet – noch kein Arbeitszeitmodell hinterlegt.';
  }
  if (target.source === 'default') {
    return 'Kein Arbeitszeitmodell hinterlegt – Standardziel 8 Stunden von Montag bis Freitag.';
  }
  return null;
}

/**
 * Why a day carries no target, in German, for the progress surfaces; null
 * when it has one. The strongest reason wins: employment, then holiday and
 * closure, then a full-day absence, then the weekday rule of the source.
 */
export function getNoTargetReason(target: DailyTarget): string | null {
  if (target.targetMinutes > 0) return null;
  if (target.outsideEmployment === 'before_entry') return 'Noch nicht eingetreten';
  if (target.outsideEmployment === 'after_exit') return 'Ausgeschieden';
  if (target.isHoliday) return `Feiertag: ${target.holidayName}`;
  if (target.isClosureDay) return target.closureLabel ? `Betriebsruhe (${target.closureLabel})` : 'Betriebsruhe';
  if (target.absence?.type === 'vacation') return 'Urlaub';
  if (target.absence?.type === 'sickness') return 'Krankmeldung';
  if (target.source === 'schedule') return 'Kein Arbeitstag laut Wochenplan';
  return 'Wochenende';
}

import type { TimeEntry, WeeklyTimeDataPoint, WeeklyTimeLabel } from './types';
import type { DailyTarget } from '@/lib/personnel/targets';
import {
  calculateBreakMinutes,
  calculateTotalMinutes,
  groupEntriesByDate,
  sessionActivityMinutes,
} from './helpers';
import { getEffectiveTimeEntries } from './effective-entries';
import {
  computeDayBreakdown,
  currentBreakPolicy,
  resolveBreakPolicyAtTimestamp,
  type BreakPolicy,
  type BreakPolicyValues,
} from './settings';
import { calculateBreakSessions, calculateWorkSessions } from './work-sessions';
import {
  addLocalDays,
  formatBerlinLocalDate,
  getLocalDayEnd,
  getLocalDayStart,
  getLocalWeekday,
} from '@/lib/date-time/berlin';

const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// The week is the Berlin calendar week wherever this runs: the server renders
// in UTC, and the runtime's local date there starts the week two hours late
// and moves "today" to the previous day after 22:00 or 23:00 Berlin time.

/** Noon UTC of a Berlin calendar date: an instant inside that Berlin day. */
function berlinNoon(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00Z`);
}

/** Monday 00:00 and Sunday 23:59:59.999 of the Berlin week that contains `baseDate`. */
export function getWeekBounds(baseDate = new Date()): {
  monday: Date;
  sunday: Date;
} {
  const todayKey = formatBerlinLocalDate(baseDate);
  const mondayKey = addLocalDays(todayKey, -getLocalWeekday(todayKey));
  return {
    monday: getLocalDayStart(berlinNoon(mondayKey)),
    sunday: getLocalDayEnd(berlinNoon(addLocalDays(mondayKey, 6))),
  };
}

export function getTodayIndex(baseDate = new Date()): number {
  return getLocalWeekday(formatBerlinLocalDate(baseDate));
}

export function computeWeekLabel(monday: Date): WeeklyTimeLabel {
  const mondayKey = formatBerlinLocalDate(monday);
  const fridayKey = addLocalDays(mondayKey, 4);
  const dayMonth = (dateKey: string): string => `${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}.`;

  const isoWeekDate = new Date(`${mondayKey}T00:00:00Z`);
  isoWeekDate.setUTCDate(isoWeekDate.getUTCDate() + 4 - (isoWeekDate.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(isoWeekDate.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((isoWeekDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  return {
    dateRange: `Diese Woche (${dayMonth(mondayKey)} - ${dayMonth(fridayKey)})`,
    kw: `KW ${weekNum}`,
  };
}

/**
 * Targets kept from an earlier read, only while they belong to the week that
 * starts on `monday`: after the week turns, last week's holidays and absences
 * must never stand in for this week's days.
 */
export function targetsOfWeek(targets: DailyTarget[] | undefined, monday: Date): DailyTarget[] | undefined {
  return targets?.[0]?.date === formatBerlinLocalDate(monday) ? targets : undefined;
}

/**
 * The break rule a day counts by (docs/features/time-tracking.md, „Break
 * rule“): the version in force at the day's last counted entry, so a rule
 * saved after clock-out never moves the day. While the clock runs, today's
 * last entry is now, and the current rule holds. The week and every live
 * view of today resolve the day here.
 */
export function dayBreakPolicy(
  settings: BreakPolicy,
  dayEntries: TimeEntry[],
  running: boolean,
): BreakPolicyValues {
  if (running) return currentBreakPolicy(settings);
  // The entries the totals count: none rejected, waiting for deletion or still ahead.
  const lastEntry = getEffectiveTimeEntries(dayEntries).at(-1);
  return resolveBreakPolicyAtTimestamp(settings, lastEntry?.timestamp ?? null);
}

export function buildWeeklyTimeData(
  entries: TimeEntry[],
  monday: Date,
  settings: BreakPolicy,
  // Monday-first resolved targets (P1-04); joined by index so a server/client
  // date-key drift can never mis-assign a day's target.
  weekTargets?: DailyTarget[],
): WeeklyTimeDataPoint[] {
  const grouped = groupEntriesByDate(entries);
  const days: WeeklyTimeDataPoint[] = [];

  const mondayKey = formatBerlinLocalDate(monday);
  for (const [i, label] of DAY_LABELS.entries()) {
    // The same Berlin day key that groupEntriesByDate assigns.
    const key = addLocalDays(mondayKey, i);
    const dayEntries = grouped[key] || [];
    const workSessions = calculateWorkSessions(dayEntries);
    const breakSessions = calculateBreakSessions(dayEntries);
    const activityMinutes = sessionActivityMinutes(workSessions);
    const trackedBreakMinutes = calculateBreakMinutes(breakSessions);
    const totalMinutes = calculateTotalMinutes(workSessions) + trackedBreakMinutes;
    const target = weekTargets?.[i];
    const breakdown = computeDayBreakdown(
      { presenceMinutes: totalMinutes, standbyMinutes: activityMinutes.standbyMinutes, trackedBreakMinutes },
      // The snapshot counts every day by its last entry, today too; the live
      // views lay today's running split over it (`computeZeiterfassungLiveTotals`, `memberLiveDay`).
      dayBreakPolicy(settings, dayEntries, false),
      target?.targetMinutes,
    );

    days.push({
      date: key,
      label,
      totalMinutes,
      workMinutes: breakdown.workMinutes,
      breakMinutes: breakdown.breakMinutes,
      overtimeMinutes: breakdown.overtimeMinutes,
      // Category minutes explain totalMinutes; they do not add to it. Travel,
      // standby, call-out and internal activity are parts of the working time.
      ...activityMinutes,
      target,
    });
  }

  return days;
}

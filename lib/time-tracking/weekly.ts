import type { TimeEntry, WeeklyTimeDataPoint, WeeklyTimeLabel } from './types';
import type { DailyTarget } from '@/lib/personnel/targets';
import { calculateBreakMinutes, calculateTotalMinutes, groupEntriesByDate } from './helpers';
import {
  computeBreakdownForSettings,
  resolveBreakPolicyAtTimestamp,
  type OrganizationTimeTrackingSettings,
} from './settings';
import { calculateBreakSessions, calculateWorkSessions } from './validation';
import { getLocalDayEnd, getLocalDayKey, getLocalDayStart } from './day-utils';
import { shiftIsoDateByDays } from '@/lib/personnel/types';

const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// The week is the Berlin calendar week wherever this runs: the server renders
// in UTC, and the runtime's local date there starts the week two hours late
// and moves "today" to the previous day after 22:00 or 23:00 Berlin time.

/** Noon UTC of a Berlin calendar date: an instant inside that Berlin day. */
function berlinNoon(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00Z`);
}

/** Monday-first index (0 = Montag) of a Berlin calendar date. */
function weekdayIndex(dateKey: string): number {
  const day = berlinNoon(dateKey).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

/** Monday 00:00 and Sunday 23:59:59.999 of the Berlin week that contains `baseDate`. */
export function getWeekBounds(baseDate = new Date()): {
  monday: Date;
  sunday: Date;
} {
  const todayKey = getLocalDayKey(baseDate);
  const mondayKey = shiftIsoDateByDays(todayKey, -weekdayIndex(todayKey));
  return {
    monday: getLocalDayStart(berlinNoon(mondayKey)),
    sunday: getLocalDayEnd(berlinNoon(shiftIsoDateByDays(mondayKey, 6))),
  };
}

export function getTodayIndex(baseDate = new Date()): number {
  return weekdayIndex(getLocalDayKey(baseDate));
}

export function computeWeekLabel(monday: Date): WeeklyTimeLabel {
  const mondayKey = getLocalDayKey(monday);
  const fridayKey = shiftIsoDateByDays(mondayKey, 4);
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

export function buildWeeklyTimeData(
  entries: TimeEntry[],
  monday: Date,
  settings: OrganizationTimeTrackingSettings,
  // Monday-first resolved targets (P1-04); joined by index so a server/client
  // date-key drift can never mis-assign a day's target.
  weekTargets?: DailyTarget[],
): WeeklyTimeDataPoint[] {
  const grouped = groupEntriesByDate(entries);
  const days: WeeklyTimeDataPoint[] = [];

  const mondayKey = getLocalDayKey(monday);
  for (const [i, label] of DAY_LABELS.entries()) {
    // The same Berlin day key that groupEntriesByDate assigns.
    const key = shiftIsoDateByDays(mondayKey, i);
    const dayEntries = grouped[key] || [];
    const workSessions = calculateWorkSessions(dayEntries);
    const breakSessions = calculateBreakSessions(dayEntries);
    const productiveMinutes = calculateTotalMinutes(
      workSessions.filter((session) => session.clockIn?.activityKind !== 'standby'),
    );
    const standbyMinutes = calculateTotalMinutes(
      workSessions.filter((session) => session.clockIn?.activityKind === 'standby'),
    );
    const trackedBreakMinutes = calculateBreakMinutes(breakSessions);
    const policyMinutes = productiveMinutes + trackedBreakMinutes;
    const totalMinutes = policyMinutes + standbyMinutes;
    const referenceTimestamp = dayEntries[dayEntries.length - 1]?.timestamp ?? null;
    const effectiveSettings = resolveBreakPolicyAtTimestamp(settings, referenceTimestamp);
    const target = weekTargets?.[i];
    const breakdown = computeBreakdownForSettings(
      policyMinutes,
      trackedBreakMinutes,
      effectiveSettings,
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
      // call-out and internal activity are productive, while standby is not.
      travelMinutes: calculateTotalMinutes(
        workSessions.filter((session) => session.clockIn?.activityKind === 'travel'),
      ),
      standbyMinutes,
      calloutMinutes: calculateTotalMinutes(
        workSessions.filter((session) => session.clockIn?.activityKind === 'callout'),
      ),
      internalMinutes: calculateTotalMinutes(
        workSessions.filter((session) => session.clockIn?.activityKind === 'internal_activity'),
      ),
      target,
    });
  }

  return days;
}

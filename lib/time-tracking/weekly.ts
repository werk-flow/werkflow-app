import type { TimeEntry, WeeklyTimeDataPoint, WeeklyTimeLabel } from './types';
import {
  calculateBreakMinutes,
  calculateTotalMinutes,
  computeTimeBreakdown,
  groupEntriesByDate,
} from './helpers';
import { calculateBreakSessions, calculateWorkSessions } from './validation';

const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export function getWeekBounds(baseDate = new Date()): {
  monday: Date;
  sunday: Date;
} {
  const day = baseDate.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() + diffToMon
  );
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
}

export function getTodayIndex(baseDate = new Date()): number {
  const day = baseDate.getDay();
  return day === 0 ? 6 : day - 1;
}

export function computeWeekLabel(monday: Date): WeeklyTimeLabel {
  const monDay = String(monday.getDate()).padStart(2, '0');
  const monMonth = String(monday.getMonth() + 1).padStart(2, '0');

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const friDay = String(friday.getDate()).padStart(2, '0');
  const friMonth = String(friday.getMonth() + 1).padStart(2, '0');

  const isoWeekDate = new Date(
    Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate())
  );
  isoWeekDate.setUTCDate(
    isoWeekDate.getUTCDate() + 4 - (isoWeekDate.getUTCDay() || 7)
  );
  const yearStart = new Date(Date.UTC(isoWeekDate.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((isoWeekDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return {
    dateRange: `Diese Woche (${monDay}.${monMonth}. - ${friDay}.${friMonth}.)`,
    kw: `KW ${weekNum}`,
  };
}

export function buildWeeklyTimeData(
  entries: TimeEntry[],
  monday: Date
): WeeklyTimeDataPoint[] {
  const grouped = groupEntriesByDate(entries);
  const days: WeeklyTimeDataPoint[] = [];

  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    const key = formatDateKey(day);
    const dayEntries = grouped[key] || [];
    const workSessions = calculateWorkSessions(dayEntries);
    const breakSessions = calculateBreakSessions(dayEntries);
    const workMinutes = calculateTotalMinutes(workSessions);
    const breakMinutes = calculateBreakMinutes(breakSessions);
    const totalMinutes = workMinutes + breakMinutes;
    const breakdown = computeTimeBreakdown(totalMinutes, breakMinutes);

    days.push({
      date: key,
      label: DAY_LABELS[i],
      totalMinutes,
      workMinutes: breakdown.workMinutes,
      breakMinutes: breakdown.breakMinutes,
      overtimeMinutes: breakdown.overtimeMinutes,
    });
  }

  return days;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

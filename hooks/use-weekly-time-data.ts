'use client';

import { useState, useEffect, useCallback } from 'react';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import {
  calculateTotalMinutes,
  groupEntriesByDate,
  computeTimeBreakdown,
} from '@/lib/time-tracking/helpers';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';

export interface DayData {
  date: string;
  label: string;
  totalMinutes: number;
  workMinutes: number;
  breakMinutes: number;
  overtimeMinutes: number;
}

const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function getWeekBounds(): { monday: Date; sunday: Date } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon...
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

function getTodayIndex(): number {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1; // Sun=0..Sat=6 → Mon=0..Sun=6
}

function computeWeekLabel(monday: Date) {
  const monDay = String(monday.getDate()).padStart(2, '0');
  const monMonth = String(monday.getMonth() + 1).padStart(2, '0');
  const fri = new Date(monday);
  fri.setDate(monday.getDate() + 4);
  const friDay = String(fri.getDate()).padStart(2, '0');
  const friMonth = String(fri.getMonth() + 1).padStart(2, '0');
  const d = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return {
    dateRange: `Diese Woche (${monDay}.${monMonth}. - ${friDay}.${friMonth}.)`,
    kw: `KW ${weekNum}`,
  };
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface UseWeeklyTimeDataOptions {
  organizationId: string;
  userId: string;
  enabled?: boolean;
}

export function useWeeklyTimeData({
  organizationId,
  userId,
  enabled = true,
}: UseWeeklyTimeDataOptions) {
  const [weekData, setWeekData] = useState<DayData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [todayIndex, setTodayIndex] = useState(getTodayIndex);
  const [weekLabel, setWeekLabel] = useState(() => computeWeekLabel(getWeekBounds().monday));

  const fetchWeekData = useCallback(async () => {
    if (!organizationId || !userId) {
      setIsLoading(false);
      return;
    }

    // Recompute week bounds fresh on every fetch so we never use stale dates
    const { monday, sunday } = getWeekBounds();
    setTodayIndex(getTodayIndex());
    setWeekLabel(computeWeekLabel(monday));

    try {
      const result = await getTimeEntries({
        organizationId,
        from: monday.toISOString(),
        to: sunday.toISOString(),
        userId,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      const grouped = groupEntriesByDate(result.entries || []);

      const days: DayData[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const key = formatDateKey(d);
        const entries = grouped[key] || [];
        const sessions = calculateWorkSessions(entries);
        const totalMinutes = calculateTotalMinutes(sessions);
        const bd = computeTimeBreakdown(totalMinutes);

        days.push({
          date: key,
          label: DAY_LABELS[i],
          totalMinutes,
          workMinutes: bd.workMinutes,
          breakMinutes: bd.breakMinutes,
          overtimeMinutes: bd.overtimeMinutes,
        });
      }

      setWeekData(days);
      setError(null);
    } catch (err) {
      console.error('Error fetching weekly time data:', err);
      setError('Failed to fetch weekly data');
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, userId]);

  useEffect(() => {
    if (enabled) {
      fetchWeekData();
    }
  }, [fetchWeekData, enabled]);

  useRealtimeEvent('time_entries', fetchWeekData);

  return { weekData, todayIndex, weekLabel, isLoading, error, refetch: fetchWeekData };
}

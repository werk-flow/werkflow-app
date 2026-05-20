'use client';

import { useMemo } from 'react';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import {
  calculateTotalMinutes,
  formatDuration
} from '@/lib/time-tracking/helpers';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { TimeEntry } from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';
import type { CalendarView } from '../calendar-container';

interface CalendarMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface MonthViewProps {
  date: Date;
  entries: TimeEntry[];
  members: CalendarMember[];
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  isLoading: boolean;
  onDateSelect: (date: Date) => void;
  onViewChange: (view: CalendarView) => void;
}

const DAY_NAMES_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function getMonthDays(date: Date): (Date | null)[] {
  const year = date.getFullYear();
  const month = date.getMonth();

  // First day of the month
  const firstDay = new Date(year, month, 1);
  // Last day of the month
  const lastDay = new Date(year, month + 1, 0);

  // Get the day of week for the first day (0 = Sunday, 1 = Monday, etc.)
  let startDay = firstDay.getDay();
  // Adjust for Monday start (0 = Monday, 6 = Sunday)
  startDay = startDay === 0 ? 6 : startDay - 1;

  const days: (Date | null)[] = [];

  // Add empty slots for days before the first day
  for (let i = 0; i < startDay; i++) {
    days.push(null);
  }

  // Add all days of the month
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i));
  }

  // Add empty slots to complete the last week
  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

function getMemberDisplayName(member: CalendarMember): string {
  if (member.first_name) {
    return member.first_name;
  }
  return member.email.split('@')[0].slice(0, 6);
}

export function MonthView({
  date,
  entries,
  members,
  isAdminOrManager,
  isLoading,
  onDateSelect,
  onViewChange
}: MonthViewProps) {
  const monthDays = useMemo(() => getMonthDays(date), [date]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Calculate hours per day per user
  const hoursData = useMemo(() => {
    const data: Record<string, Record<string, number>> = {};

    // Group entries by user and then by day
    for (const entry of entries) {
      const userId = entry.userId;
      const entryDate = new Date(entry.timestamp).toDateString();

      if (!data[userId]) {
        data[userId] = {};
      }
      if (!data[userId][entryDate]) {
        // Calculate sessions for this user and day
        const userDayEntries = entries.filter(
          (e) =>
            e.userId === userId &&
            new Date(e.timestamp).toDateString() === entryDate
        );
        const sessions = calculateWorkSessions(userDayEntries);
        data[userId][entryDate] = calculateTotalMinutes(sessions);
      }
    }

    return data;
  }, [entries]);

  // Calculate totals per day (all users)
  const dailyTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const day of monthDays) {
      if (!day) continue;
      const dayStr = day.toDateString();
      let total = 0;
      for (const userHours of Object.values(hoursData)) {
        total += userHours[dayStr] || 0;
      }
      totals[dayStr] = total;
    }
    return totals;
  }, [monthDays, hoursData]);

  const handleDayClick = (day: Date) => {
    onDateSelect(day);
    onViewChange('day');
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Month header */}
      <div className="grid grid-cols-7 gap-px mb-px bg-border/50 rounded-t-lg overflow-hidden">
        {DAY_NAMES_SHORT.map((name) => (
          <div
            key={name}
            className="text-center text-sm font-medium text-muted-foreground py-2 bg-background"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-px bg-border/50 rounded-b-lg overflow-hidden">
        {monthDays.map((day, i) => {
          if (!day) {
            return <div key={i} className="min-h-[80px] bg-background" />;
          }

          const dayStr = day.toDateString();
          const isToday = dayStr === today.toDateString();
          const isCurrentMonth = day.getMonth() === date.getMonth();
          const totalMinutes = dailyTotals[dayStr] || 0;

          return (
            <button
              key={i}
              onClick={() => handleDayClick(day)}
              className={cn(
                'min-h-[80px] p-1 text-left transition-colors bg-background cursor-pointer',
                'hover:bg-[rgba(123,44,191,0.06)]',
                !isCurrentMonth && 'opacity-50',
                isToday && 'bg-[rgba(123,44,191,0.08)]'
              )}
            >
              {/* Day number */}
              <div
                className={cn(
                  'text-xs font-medium mb-1',
                  isToday &&
                    'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-primary-foreground px-1'
                )}
              >
                {day.getDate()}
              </div>

              {/* Hours summary */}
              {totalMinutes > 0 && (
                <div className="text-[10px] font-medium text-primary truncate">
                  {formatDuration(totalMinutes)}
                </div>
              )}

              {/* Per-user breakdown (admin/manager) - compact */}
              {isAdminOrManager && totalMinutes > 0 && (
                <div className="mt-1 space-y-0.5 max-h-[40px] overflow-hidden">
                  {members.slice(0, 3).map((member) => {
                    const userMinutes =
                      hoursData[member.user_id]?.[dayStr] || 0;
                    if (userMinutes === 0) return null;
                    return (
                      <div
                        key={member.user_id}
                        className="text-[9px] text-muted-foreground truncate"
                      >
                        {getMemberDisplayName(member)}:{' '}
                        {Math.round(userMinutes / 60)}h
                      </div>
                    );
                  })}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

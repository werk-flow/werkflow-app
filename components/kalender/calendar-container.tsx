'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { CalendarHeader } from './calendar-header';
import { CalendarViewTabs } from './calendar-view-tabs';
import { DayView } from './day-view/day-view';
import { WeekView } from './week-view/week-view';
import { DayViewSkeleton } from './day-view/day-view-skeleton';
import { WeekViewSkeleton } from './week-view/week-view-skeleton';
import { FullCalendarSkeleton } from './fullcalendar-skeleton';
import { EntryDetailsDialog } from './entry-details-dialog';
import type { TimeEntry, WorkSession } from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/supabase/database.types';

export type CalendarView = 'day' | 'week' | 'month';

// Filters for what types of events to show in the calendar
export interface CalendarFilters {
  showWorkingHours: boolean;
  // Future filters:
  // showAppointments: boolean;
  // showProjectDates: boolean;
}

// Dynamically import FullCalendar to avoid SSR issues
const FullCalendarView = dynamic(
  () => import('./fullcalendar-view').then((mod) => mod.FullCalendarView),
  {
    ssr: false,
    loading: () => <FullCalendarSkeleton view="month" />
  }
);

interface CalendarMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface CalendarContainerProps {
  organizationId: string;
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  members: CalendarMember[];
}

export function CalendarContainer({
  organizationId,
  currentUserId,
  currentUserRole,
  isAdminOrManager,
  members
}: CalendarContainerProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<CalendarView>('day');
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMembers, setSelectedMembers] = useState<string[]>(
    members.map((m) => m.user_id)
  );
  const [selectedSession, setSelectedSession] = useState<WorkSession | null>(
    null
  );
  const [filters, setFilters] = useState<CalendarFilters>({
    showWorkingHours: true
    // Future filters will be added here
  });

  // Calculate date range based on view
  const getDateRange = useCallback(() => {
    const start = new Date(currentDate);
    const end = new Date(currentDate);

    if (view === 'day') {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (view === 'week') {
      // Start of week (Monday)
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      // End of week (Sunday)
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else if (view === 'month') {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(end.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
    }

    return { start, end };
  }, [currentDate, view]);

  // Fetch entries
  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const { start, end } = getDateRange();

      const response = await fetch('/api/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          from: start.toISOString(),
          to: end.toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch entries: ${response.status}`);
      }

      const result: {
        success: boolean;
        entries?: TimeEntry[];
        error?: string;
      } = await response.json();

      if (result.success && result.entries) {
        setEntries(result.entries);
      } else {
        console.error('Error fetching entries:', result.error);
      }
    } catch (error) {
      console.error('Error fetching entries:', error);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, getDateRange]);

  // Fetch entries when date/view changes
  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Navigation handlers
  const handlePrevious = useCallback(() => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      if (view === 'day') {
        newDate.setDate(newDate.getDate() - 1);
      } else if (view === 'week') {
        newDate.setDate(newDate.getDate() - 7);
      } else if (view === 'month') {
        newDate.setMonth(newDate.getMonth() - 1);
      }
      return newDate;
    });
  }, [view]);

  const handleNext = useCallback(() => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      if (view === 'day') {
        newDate.setDate(newDate.getDate() + 1);
      } else if (view === 'week') {
        newDate.setDate(newDate.getDate() + 7);
      } else if (view === 'month') {
        newDate.setMonth(newDate.getMonth() + 1);
      }
      return newDate;
    });
  }, [view]);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const handleDateSelect = useCallback((date: Date) => {
    setCurrentDate(date);
  }, []);

  // Filter entries based on selected members and filters
  const filteredEntries = useMemo(() => {
    // If working hours filter is off, return empty array (no time entries to show)
    if (!filters.showWorkingHours) {
      return [];
    }

    return isAdminOrManager
      ? entries.filter((e) => selectedMembers.includes(e.userId))
      : entries.filter((e) => e.userId === currentUserId);
  }, [
    entries,
    selectedMembers,
    isAdminOrManager,
    currentUserId,
    filters.showWorkingHours
  ]);

  // Filter members based on selection
  const filteredMembers = isAdminOrManager
    ? members.filter((m) => selectedMembers.includes(m.user_id))
    : members.filter((m) => m.user_id === currentUserId);

  // Determine whether to use FullCalendar or custom views
  // - Employees: Use FullCalendar for all views
  // - Admin/Manager: Use FullCalendar for month view, custom for day/week
  const useFullCalendar =
    !isAdminOrManager || (isAdminOrManager && view === 'month');

  const handleEventClick = useCallback((session: WorkSession) => {
    setSelectedSession(session);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <CalendarHeader
        currentDate={currentDate}
        view={view}
        isLoading={isLoading}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onToday={handleToday}
        onRefresh={fetchEntries}
      />

      <div className="border-b px-4 py-2 sm:px-6">
        <CalendarViewTabs
          view={view}
          onViewChange={setView}
          members={members}
          selectedMembers={selectedMembers}
          onSelectedMembersChange={setSelectedMembers}
          isAdminOrManager={isAdminOrManager}
          filters={filters}
          onFiltersChange={setFilters}
        />
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          // Show appropriate skeleton based on view and user role
          useFullCalendar ? (
            <FullCalendarSkeleton view={view} />
          ) : view === 'day' ? (
            <DayViewSkeleton memberCount={filteredMembers.length || 5} />
          ) : (
            <WeekViewSkeleton memberCount={filteredMembers.length || 5} />
          )
        ) : useFullCalendar ? (
          <FullCalendarView
            date={currentDate}
            view={view}
            entries={filteredEntries}
            members={members}
            currentUserId={currentUserId}
            isAdminOrManager={isAdminOrManager}
            onEventClick={handleEventClick}
            onDateSelect={handleDateSelect}
            onViewChange={setView}
          />
        ) : (
          <>
            {view === 'day' && (
              <DayView
                date={currentDate}
                entries={filteredEntries}
                members={filteredMembers}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                isAdminOrManager={isAdminOrManager}
                isLoading={isLoading}
                onRefresh={fetchEntries}
              />
            )}
            {view === 'week' && (
              <WeekView
                date={currentDate}
                entries={filteredEntries}
                members={filteredMembers}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                isAdminOrManager={isAdminOrManager}
                isLoading={isLoading}
                onDateSelect={handleDateSelect}
                onViewChange={setView}
                onSessionClick={handleEventClick}
              />
            )}
          </>
        )}
      </div>

      {/* Entry details dialog for FullCalendar events */}
      {selectedSession && (
        <EntryDetailsDialog
          open={!!selectedSession}
          onOpenChange={(open) => !open && setSelectedSession(null)}
          session={selectedSession}
          currentUserRole={currentUserRole}
          onRefresh={fetchEntries}
        />
      )}
    </div>
  );
}

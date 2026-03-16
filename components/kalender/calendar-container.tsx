'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { CalendarHeader } from './calendar-header';
import { CalendarViewTabs } from './calendar-view-tabs';
import { DayView } from './day-view/day-view';
import { WeekView } from './week-view/week-view';
import { DayViewSkeleton } from './day-view/day-view-skeleton';
import { WeekViewSkeleton } from './week-view/week-view-skeleton';
import { FullCalendarSkeleton } from './fullcalendar-skeleton';
import {
  getTimeEntries,
  getChangeRequestsForEntries
} from '@/lib/time-tracking/actions';
import { getJobsForCalendar } from '@/lib/jobs/actions';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import type { CalendarJob } from '@/lib/jobs/types';

const EntryDetailsDialog = dynamic(
  () => import('./entry-details-dialog').then((mod) => mod.EntryDetailsDialog),
  { ssr: false }
);
import type {
  TimeEntry,
  WorkSession,
  EntryChangeRequestMap
} from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';
import { toLocalDateString } from '@/lib/utils';

export type CalendarView = 'day' | 'week' | 'month';

// Filters for what types of events to show in the calendar
export interface CalendarFilters {
  showWorkingHours: boolean;
  showJobs: boolean;
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
  initialEntries?: TimeEntry[];
  initialChangeRequestMap?: EntryChangeRequestMap;
  initialJobs?: CalendarJob[];
}

export function CalendarContainer({
  organizationId,
  currentUserId,
  currentUserRole,
  isAdminOrManager,
  members,
  initialEntries,
  initialChangeRequestMap,
  initialJobs
}: CalendarContainerProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<CalendarView>('day');
  const [entries, setEntries] = useState<TimeEntry[]>(initialEntries ?? []);
  const [changeRequestMap, setChangeRequestMap] =
    useState<EntryChangeRequestMap>(initialChangeRequestMap ?? {});
  const [isLoading, setIsLoading] = useState(!initialEntries);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>(
    members.map((m) => m.user_id)
  );
  const [selectedSession, setSelectedSession] = useState<WorkSession | null>(
    null
  );
  const [calendarJobs, setCalendarJobs] = useState<CalendarJob[]>(initialJobs ?? []);
  const [filters, setFilters] = useState<CalendarFilters>({
    showWorkingHours: true,
    showJobs: true
  });

  // Track the date range we've already fetched data for.
  // When switching to a narrower view (e.g. week→day), the needed range
  // is already covered so we skip the refetch entirely.
  const fetchedRangeRef = useRef<{ start: Date; end: Date } | null>(null);
  const hasDataRef = useRef(!!initialEntries);
  const previousOrgIdRef = useRef(organizationId);
  const entriesRequestIdRef = useRef(0);
  const jobsRequestIdRef = useRef(0);

  // Track which member to highlight when navigating from week view cell click
  // We use two states: pendingHighlight stores the ID while loading,
  // highlightMemberId is the active highlight (only set after loading completes)
  const [pendingHighlightMemberId, setPendingHighlightMemberId] = useState<
    string | null
  >(null);
  const [highlightMemberId, setHighlightMemberId] = useState<string | null>(
    null
  );

  // Calculate date range based on view
  // For proper session pairing, we fetch slightly beyond view boundaries
  const getDateRange = useCallback(() => {
    const start = new Date(currentDate);
    const end = new Date(currentDate);

    if (view === 'day') {
      // For day view, also fetch previous day to catch overnight clock_ins
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (view === 'week') {
      // Start of week (Monday) - 1 day to catch previous day's clock_ins
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff - 1);
      start.setHours(0, 0, 0, 0);
      // End of week (Sunday) + 1 day to catch next day's clock_outs
      end.setDate(start.getDate() + 8);
      end.setHours(23, 59, 59, 999);
    } else if (view === 'month') {
      // Fetch from a few days before month start to catch sessions spanning month boundary
      start.setDate(1);
      start.setDate(start.getDate() - 3);
      start.setHours(0, 0, 0, 0);
      // Fetch to a few days after month end
      end.setMonth(end.getMonth() + 1);
      end.setDate(3);
      end.setHours(23, 59, 59, 999);
    }

    return { start, end };
  }, [currentDate, view]);

  // Fetch entries and their pending change requests via server actions.
  // - silent=true  → no visual indicator (used by Realtime)
  // - silent=false → spinner in header; skeleton only when no data exists yet
  // Change requests are fetched non-blocking so the calendar renders entries
  // immediately and CR badges fill in shortly after.
  const fetchEntries = useCallback(async (silent = false) => {
    const requestId = ++entriesRequestIdRef.current;
    const requestOrgId = organizationId;

    if (!silent) {
      if (!hasDataRef.current) setIsLoading(true);
      setIsRefreshing(true);
    }
    try {
      const { start, end } = getDateRange();

      const result = await getTimeEntries({
        organizationId,
        from: start.toISOString(),
        to: end.toISOString()
      });

      if (result.success && result.entries) {
        if (
          entriesRequestIdRef.current !== requestId ||
          previousOrgIdRef.current !== requestOrgId
        ) {
          return;
        }

        setEntries(result.entries);
        hasDataRef.current = true;
        fetchedRangeRef.current = { start, end };

        // Fetch change requests in background (non-blocking)
        const entryIds = result.entries.map((e) => e.id);
        if (entryIds.length > 0) {
          getChangeRequestsForEntries(entryIds)
            .then((crResult) => {
              if (
                entriesRequestIdRef.current !== requestId ||
                previousOrgIdRef.current !== requestOrgId
              ) {
                return;
              }

              if (crResult.success && crResult.requests) {
                const crMap: EntryChangeRequestMap = {};
                for (const cr of crResult.requests) {
                  crMap[cr.entryId] = cr;
                  if (cr.pairedEntryId) {
                    crMap[cr.pairedEntryId] = cr;
                  }
                }
                setChangeRequestMap(crMap);
              }
            })
            .catch((crError) => {
              if (
                entriesRequestIdRef.current !== requestId ||
                previousOrgIdRef.current !== requestOrgId
              ) {
                return;
              }

              console.error('Error fetching change requests:', crError);
            });
        } else {
          if (
            entriesRequestIdRef.current !== requestId ||
            previousOrgIdRef.current !== requestOrgId
          ) {
            return;
          }
          setChangeRequestMap({});
        }
      } else if (!result.success) {
        console.error('Error fetching entries:', result.error);
      }
    } catch (error) {
      console.error('Error fetching entries:', error);
    } finally {
      if (
        entriesRequestIdRef.current !== requestId ||
        previousOrgIdRef.current !== requestOrgId
      ) {
        return;
      }
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [organizationId, getDateRange]);

  const fetchJobs = useCallback(async () => {
    const requestId = ++jobsRequestIdRef.current;
    const requestOrgId = organizationId;

    try {
      const { start, end } = getDateRange();
      const fromIso = toLocalDateString(start);
      const toIso = toLocalDateString(end);

      const result = await getJobsForCalendar(fromIso, toIso);
      if (result.success) {
        if (
          jobsRequestIdRef.current !== requestId ||
          previousOrgIdRef.current !== requestOrgId
        ) {
          return;
        }
        setCalendarJobs(result.jobs);
      }
    } catch (error) {
      console.error('Error fetching calendar jobs:', error);
    }
  }, [organizationId, getDateRange]);

  const hasUsedInitialData = useRef(!!initialEntries);

  useEffect(() => {
    if (previousOrgIdRef.current === organizationId) {
      return;
    }

    previousOrgIdRef.current = organizationId;
    entriesRequestIdRef.current += 1;
    jobsRequestIdRef.current += 1;
    fetchedRangeRef.current = null;
    hasDataRef.current = false;
    hasUsedInitialData.current = false;

    setEntries([]);
    setChangeRequestMap({});
    setCalendarJobs([]);
    setSelectedMembers(members.map((member) => member.user_id));
    setSelectedSession(null);
    setPendingHighlightMemberId(null);
    setHighlightMemberId(null);
    setIsRefreshing(false);
    setIsLoading(true);
  }, [organizationId, members]);

  useEffect(() => {
    if (hasUsedInitialData.current) {
      hasUsedInitialData.current = false;
      // Seed the fetched-range ref with the server-prefetched day range
      fetchedRangeRef.current = getDateRange();
      return;
    }

    const needed = getDateRange();
    const fetched = fetchedRangeRef.current;

    // Skip refetch when the needed range is within what we already have
    if (fetched && needed.start >= fetched.start && needed.end <= fetched.end) {
      return;
    }

    // Wider data needed — silent refetch (no skeleton) if we have existing data
    fetchEntries(hasDataRef.current);
    fetchJobs();
  }, [fetchEntries, fetchJobs, getDateRange]);

  // Realtime events always refetch (data changed, bypass range check)
  useRealtimeEvent('time_entries', () => fetchEntries(true));
  useRealtimeEvent('entry_change_requests', () => fetchEntries(true));
  useRealtimeEvent('jobs', fetchJobs);
  useRealtimeEvent('job_assignments', fetchJobs);

  // Force a full refetch with loading skeleton (manual refresh button, after edits, etc.)
  const handleManualRefresh = useCallback(() => {
    fetchedRangeRef.current = null;
    setIsLoading(true);
    fetchEntries();
    fetchJobs();
  }, [fetchEntries, fetchJobs]);

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
    // Clear any pending/active highlight when navigating via date selection
    // (e.g., clicking day header in week view - no specific member)
    setPendingHighlightMemberId(null);
    setHighlightMemberId(null);
  }, []);

  // Handle click on a specific member's day cell in the week view
  const handleMemberDayClick = useCallback((memberId: string, date: Date) => {
    setCurrentDate(date);
    // Store as pending - will be activated after loading completes
    setPendingHighlightMemberId(memberId);
    setView('day');
  }, []);

  // When loading finishes and we have a pending highlight, activate it
  useEffect(() => {
    if (!isLoading && pendingHighlightMemberId && view === 'day') {
      // Activate the highlight now that the view is visible
      setHighlightMemberId(pendingHighlightMemberId);
      setPendingHighlightMemberId(null);

      // Clear highlight after animation duration (1.5s)
      const timer = setTimeout(() => {
        setHighlightMemberId(null);
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [isLoading, pendingHighlightMemberId, view]);

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

  const filteredMembers = useMemo(
    () =>
      isAdminOrManager
        ? members.filter((m) => selectedMembers.includes(m.user_id))
        : members.filter((m) => m.user_id === currentUserId),
    [members, selectedMembers, isAdminOrManager, currentUserId]
  );

  const filteredJobs = useMemo(() => {
    if (!filters.showJobs) return [];

    return isAdminOrManager
      ? calendarJobs.filter(
          (j) =>
            j.assignedUserIds.length === 0 ||
            j.assignedUserIds.some((uid) => selectedMembers.includes(uid))
        )
      : calendarJobs.filter(
          (j) => j.assignedUserIds.includes(currentUserId)
        );
  }, [calendarJobs, filters.showJobs, selectedMembers, isAdminOrManager, currentUserId]);

  // Determine whether to use FullCalendar or custom views
  // - Employees: Use FullCalendar for all views
  // - Admin/Manager: Use FullCalendar for month view, custom for day/week
  const useFullCalendar =
    !isAdminOrManager || (isAdminOrManager && view === 'month');

  const handleEventClick = useCallback((session: WorkSession) => {
    setSelectedSession(session);
  }, []);

  const isSwitchingCalendarOrg = previousOrgIdRef.current !== organizationId;
  const showLoadingSkeleton = isLoading || isSwitchingCalendarOrg;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <CalendarHeader
        currentDate={currentDate}
        view={view}
        isLoading={showLoadingSkeleton || isRefreshing}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onToday={handleToday}
        onRefresh={handleManualRefresh}
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
        {showLoadingSkeleton ? (
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
            jobs={filteredJobs}
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
                onRefresh={handleManualRefresh}
                changeRequestMap={changeRequestMap}
                highlightMemberId={highlightMemberId}
                jobs={filteredJobs}
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
                changeRequestMap={changeRequestMap}
                onMemberDayClick={handleMemberDayClick}
                jobs={filteredJobs}
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
          currentUserId={currentUserId}
          onRefresh={handleManualRefresh}
          jobName={
            selectedSession.jobId
              ? calendarJobs.find((j) => j.id === selectedSession.jobId)?.title ?? null
              : null
          }
        />
      )}
    </div>
  );
}

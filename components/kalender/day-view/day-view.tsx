'use client';

import { useMemo } from 'react';
import { TimelineHeader } from './timeline-header';
import { EmployeeTimelineRow } from './employee-timeline-row';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import { Skeleton } from '@/components/ui/skeleton';
import { TIMELINE_WIDTH } from './timeline-grid';
import type {
  TimeEntry,
  EntryChangeRequestMap
} from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';

interface CalendarMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface DayViewProps {
  date: Date;
  entries: TimeEntry[];
  members: CalendarMember[];
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  isLoading: boolean;
  onRefresh: () => void;
  changeRequestMap?: EntryChangeRequestMap;
}

/**
 * Admin/Manager Day View - shows employee timeline rows
 * Note: Employee day view uses FullCalendar instead
 */
export function DayView({
  date,
  entries,
  members,
  currentUserId,
  currentUserRole,
  isLoading,
  onRefresh,
  changeRequestMap = {}
}: DayViewProps) {
  // Group entries by user
  const entriesByUser = useMemo(() => {
    const grouped: Record<string, TimeEntry[]> = {};
    for (const entry of entries) {
      if (!grouped[entry.userId]) {
        grouped[entry.userId] = [];
      }
      grouped[entry.userId].push(entry);
    }
    return grouped;
  }, [entries]);

  // Calculate work sessions for each user
  const sessionsByUser = useMemo(() => {
    const sessions: Record<
      string,
      ReturnType<typeof calculateWorkSessions>
    > = {};
    for (const [userId, userEntries] of Object.entries(entriesByUser)) {
      sessions[userId] = calculateWorkSessions(userEntries);
    }
    return sessions;
  }, [entriesByUser]);

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  // Admin/Manager timeline grid view with synchronized scrolling
  return (
    <div className="flex h-full">
      {/* Fixed employee names column */}
      <div className="w-48 shrink-0 border-r bg-background z-10">
        {/* Header */}
        <div className="h-10 border-b bg-muted/30 px-3 flex items-center">
          <span className="text-sm font-medium text-muted-foreground">
            Mitarbeiter
          </span>
        </div>
        {/* Employee names */}
        <div className="divide-y">
          {members.length === 0 ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
              Keine Mitarbeiter
            </div>
          ) : (
            members.map((member) => {
              const sessions = sessionsByUser[member.user_id] || [];
              const userEntries = entriesByUser[member.user_id] || [];
              return (
                <EmployeeTimelineRow
                  key={member.user_id}
                  member={member}
                  sessions={sessions}
                  entries={userEntries}
                  showNameOnly
                />
              );
            })
          )}
        </div>
      </div>

      {/* Scrollable timeline area */}
      <div className="flex-1 overflow-x-auto">
        <div style={{ minWidth: TIMELINE_WIDTH }}>
          {/* Timeline header */}
          <TimelineHeader date={date} />

          {/* Timeline rows */}
          <div className="divide-y">
            {members.map((member) => {
              const sessions = sessionsByUser[member.user_id] || [];
              const userEntries = entriesByUser[member.user_id] || [];
              return (
                <EmployeeTimelineRow
                  key={member.user_id}
                  member={member}
                  sessions={sessions}
                  entries={userEntries}
                  date={date}
                  currentUserRole={currentUserRole}
                  currentUserId={currentUserId}
                  onRefresh={onRefresh}
                  showTimelineOnly
                  changeRequestMap={changeRequestMap}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { Briefcase } from 'lucide-react';
import { TimelineHeader } from './timeline-header';
import { EmployeeTimelineRow } from './employee-timeline-row';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import { Skeleton } from '@/components/ui/skeleton';
import { TIMELINE_WIDTH } from './timeline-grid';
import { cn, toLocalDateString } from '@/lib/utils';
import type {
  TimeEntry,
  EntryChangeRequestMap
} from '@/lib/time-tracking/types';
import type { CalendarJob } from '@/lib/jobs/types';
import type { OrgRole } from '@/lib/members/actions';
import { JobEventPopover } from '../job-event-popover';

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
  highlightMemberId?: string | null;
  jobs?: CalendarJob[];
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
  changeRequestMap = {},
  highlightMemberId,
  jobs = []
}: DayViewProps) {
  const [selectedJob, setSelectedJob] = useState<{
    job: CalendarJob;
    position: { x: number; y: number };
  } | null>(null);

  const memberNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) {
      map[m.user_id] =
        m.first_name || m.last_name
          ? `${m.first_name || ''} ${m.last_name || ''}`.trim()
          : m.email;
    }
    return map;
  }, [members]);

  const dayJobs = useMemo(() => {
    const dateStr = toLocalDateString(date);
    return jobs.filter((j) => j.plannedDate === dateStr);
  }, [jobs, date]);
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

  return (
    <div className="flex flex-col h-full">
      {/* All-day jobs row */}
      {dayJobs.length > 0 && (
        <div className="border-b bg-muted/20 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground mr-1">
              Aufträge:
            </span>
            {dayJobs.map((job) => (
              <button
                key={job.id}
                onClick={(e) => {
                  const rect = (e.target as HTMLElement).getBoundingClientRect();
                  setSelectedJob({
                    job,
                    position: { x: rect.right + 8, y: rect.top }
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-brand-purple/30 bg-brand-purple/10 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-brand-purple/20"
              >
                <Briefcase className="h-3 w-3 text-brand-purple" />
                <span className="truncate max-w-[150px]">{job.title}</span>
                {job.jobNumber && (
                  <span className="text-muted-foreground text-[10px]">
                    {job.jobNumber}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-1">
      {/* Fixed employee names column */}
      <div className="w-48 shrink-0 border-r bg-background z-10">
        <div className="h-10 border-b bg-muted/30 px-3 flex items-center">
          <span className="text-sm font-medium text-muted-foreground">
            Mitarbeiter
          </span>
        </div>
        <div className="divide-y">
          {members.length === 0 ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
              Keine Mitarbeiter
            </div>
          ) : (
            members.map((member) => {
              const sessions = sessionsByUser[member.user_id] || [];
              const userEntries = entriesByUser[member.user_id] || [];
              const isHighlighted = highlightMemberId === member.user_id;
              return (
                <EmployeeTimelineRow
                  key={member.user_id}
                  member={member}
                  sessions={sessions}
                  entries={userEntries}
                  showNameOnly
                  isHighlighted={isHighlighted}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Scrollable timeline area - uses CSS grid to fill available width on wide screens */}
      <div className="flex-1 overflow-x-auto">
        <div className="min-w-[1440px] w-full">
          {/* Timeline header */}
          <TimelineHeader date={date} />

          {/* Timeline rows */}
          <div className="divide-y">
            {members.map((member) => {
              const sessions = sessionsByUser[member.user_id] || [];
              const userEntries = entriesByUser[member.user_id] || [];
              const isHighlighted = highlightMemberId === member.user_id;
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
                  isHighlighted={isHighlighted}
                />
              );
            })}
          </div>
        </div>
      </div>
      </div>

      {selectedJob && (
        <JobEventPopover
          job={selectedJob.job}
          position={selectedJob.position}
          onClose={() => setSelectedJob(null)}
          memberNames={memberNameMap}
        />
      )}
    </div>
  );
}

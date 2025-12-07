'use client';

import { useMemo, useEffect, useState } from 'react';
import {
  calculateBlockPosition,
  HOUR_WIDTH,
  TIMELINE_WIDTH
} from './timeline-grid';
import { WorkSessionBlock } from './work-session-block';
import {
  formatDuration,
  calculateTotalMinutes
} from '@/lib/time-tracking/helpers';
import type { TimeEntry, WorkSession } from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';

interface CalendarMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface EmployeeTimelineRowProps {
  member: CalendarMember;
  sessions: WorkSession[];
  entries: TimeEntry[];
  date?: Date;
  currentUserRole?: OrgRole;
  onRefresh?: () => void;
  /** Show only the name column */
  showNameOnly?: boolean;
  /** Show only the timeline column */
  showTimelineOnly?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  accountant: 'Buchhalter',
  secretary: 'Sekretär',
  employee: 'Mitarbeiter'
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function getMemberDisplayName(member: CalendarMember): string {
  if (member.first_name || member.last_name) {
    return `${member.first_name || ''} ${member.last_name || ''}`.trim();
  }
  return member.email;
}

export function EmployeeTimelineRow({
  member,
  sessions,
  entries,
  date,
  currentUserRole,
  onRefresh,
  showNameOnly = false,
  showTimelineOnly = false
}: EmployeeTimelineRowProps) {
  const [currentTimePosition, setCurrentTimePosition] = useState<number | null>(
    null
  );

  // Calculate total minutes worked
  const totalMinutes = useMemo(() => {
    return calculateTotalMinutes(sessions);
  }, [sessions]);

  // Check if there are pending entries
  const hasPendingEntries = useMemo(() => {
    return entries.some((e) => e.status === 'pending');
  }, [entries]);

  // Filter sessions to only those on the current date
  const daySessionsWithBlocks = useMemo(() => {
    if (!date) return [];
    return sessions
      .map((session) => {
        // Handle orphan sessions (no clockIn, only clockOut)
        // or regular sessions (has clockIn)
        let referenceDate: Date;
        if (session.clockIn) {
          referenceDate = new Date(session.clockIn.timestamp);
        } else if (session.clockOut) {
          // Orphan clock_out - use clockOut timestamp as reference
          referenceDate = new Date(session.clockOut.timestamp);
        } else {
          // Invalid session - no clockIn or clockOut
          return null;
        }

        const clockOutDate = session.clockOut
          ? new Date(session.clockOut.timestamp)
          : null;

        // Check if session is on this day
        const isOnDay = referenceDate.toDateString() === date.toDateString();
        if (!isOnDay) return null;

        const { left, width } = calculateBlockPosition(
          referenceDate,
          clockOutDate
        );

        return {
          session,
          left,
          width,
          isPending:
            session.clockIn?.status === 'pending' ||
            session.clockOut?.status === 'pending'
        };
      })
      .filter(Boolean) as Array<{
      session: WorkSession;
      left: number;
      width: number;
      isPending: boolean;
    }>;
  }, [sessions, date]);

  // Current time indicator
  useEffect(() => {
    if (showNameOnly) return;

    const updateCurrentTime = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const position = (hours + minutes / 60) * HOUR_WIDTH;
      setCurrentTimePosition(position);
    };

    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000);
    return () => clearInterval(interval);
  }, [showNameOnly]);

  // Show only the employee name column
  if (showNameOnly) {
    return (
      <div className="h-16 px-3 flex flex-col justify-center hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">
            {getMemberDisplayName(member)}
          </span>
          {hasPendingEntries && (
            <span
              className="h-2 w-2 rounded-full bg-yellow-500 shrink-0"
              title="Ausstehende Einträge"
            />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{ROLE_LABELS[member.role] || member.role}</span>
          <span>•</span>
          <span>{totalMinutes > 0 ? formatDuration(totalMinutes) : '—'}</span>
        </div>
      </div>
    );
  }

  // Show only the timeline column
  if (showTimelineOnly) {
    return (
      <div
        className="relative h-16 hover:bg-muted/30 transition-colors"
        style={{ minWidth: TIMELINE_WIDTH }}
      >
        {/* Hour grid lines */}
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="absolute top-0 h-full border-l border-border/30"
            style={{ left: hour * HOUR_WIDTH }}
          />
        ))}

        {/* Current time indicator */}
        {currentTimePosition !== null && (
          <div
            className="absolute top-0 h-full w-0.5 bg-destructive/50 z-10"
            style={{ left: currentTimePosition }}
          />
        )}

        {/* Work session blocks */}
        {daySessionsWithBlocks.map(
          ({ session, left, width, isPending }, index) => (
            <WorkSessionBlock
              key={`${
                session.clockIn?.id ?? session.clockOut?.id ?? index
              }-${index}`}
              session={session}
              left={left}
              width={width}
              isPending={isPending}
              currentUserRole={currentUserRole!}
              onRefresh={onRefresh!}
            />
          )
        )}
      </div>
    );
  }

  // Default: show both (legacy mode, not used in new design)
  return null;
}

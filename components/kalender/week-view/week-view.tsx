'use client';

import { useMemo } from 'react';
import { Clock, ArrowUp, ArrowDown } from 'lucide-react';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type {
  TimeEntry,
  WorkSession,
  EntryChangeRequestMap
} from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';
import type { CalendarView } from '../calendar-container';

interface CalendarMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface WeekViewProps {
  date: Date;
  entries: TimeEntry[];
  members: CalendarMember[];
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  isLoading: boolean;
  onDateSelect: (date: Date) => void;
  onViewChange: (view: CalendarView) => void;
  onSessionClick?: (session: WorkSession) => void;
  /** Map of entry IDs to their pending change requests */
  changeRequestMap?: EntryChangeRequestMap;
}

const DAY_NAMES_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MAX_SESSIONS_PER_DAY = 3;

function getWeekDays(date: Date): Date[] {
  const days: Date[] = [];
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start

  for (let i = 0; i < 7; i++) {
    const d = new Date(date);
    d.setDate(diff + i);
    d.setHours(0, 0, 0, 0);
    days.push(d);
  }

  return days;
}

function getMemberDisplayName(member: CalendarMember): string {
  if (member.first_name || member.last_name) {
    return `${member.first_name || ''} ${member.last_name || ''}`.trim();
  }
  return member.email.split('@')[0];
}

export function WeekView({
  date,
  entries,
  members,
  currentUserId,
  currentUserRole,
  isAdminOrManager,
  isLoading,
  onDateSelect,
  onViewChange,
  onSessionClick,
  changeRequestMap = {}
}: WeekViewProps) {
  const weekDays = useMemo(() => getWeekDays(date), [date]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto">
        <div className="min-w-[1150px] p-4">
          {/* Header Row */}
          <div className="grid grid-cols-[140px_repeat(7,_minmax(140px,_1fr))] gap-1 mb-1 sticky top-0 bg-background z-20">
            <div className="p-2 font-medium text-sm text-muted-foreground flex items-center sticky left-0 bg-background z-10">
              Mitarbeiter
            </div>
            {weekDays.map((day, i) => {
              const isToday = day.toDateString() === today.toDateString();
              return (
                <div
                  key={i}
                  className={cn(
                    'text-center p-2 rounded-md border text-sm font-medium transition-colors cursor-pointer hover:bg-accent',
                    isToday
                      ? 'bg-[rgba(123,44,191,0.12)] border-[rgba(123,44,191,0.5)] text-[rgb(123,44,191)]'
                      : 'bg-muted/30 border-transparent'
                  )}
                  onClick={() => {
                    onDateSelect(day);
                    onViewChange('day');
                  }}
                >
                  <div className="text-muted-foreground text-xs uppercase">
                    {DAY_NAMES_SHORT[i]}
                  </div>
                  <div className={cn('text-lg', isToday && 'font-bold')}>
                    {day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Member Rows */}
          <div className="space-y-1">
            {members.map((member) => {
              const memberEntries = entriesByUser[member.user_id] || [];

              return (
                <div
                  key={member.user_id}
                  className="grid grid-cols-[140px_repeat(7,_minmax(140px,_1fr))] gap-1"
                >
                  {/* Member Info Column */}
                  <div className="p-3 bg-card border border-border/60 rounded-md flex flex-col justify-center sticky left-0 z-10">
                    <div className="font-medium text-sm truncate">
                      {getMemberDisplayName(member)}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {member.role}
                    </div>
                  </div>

                  {/* Day Cells */}
                  {weekDays.map((day, i) => {
                    const dayStr = day.toDateString();
                    const isToday = dayStr === today.toDateString();

                    // Filter entries for this day
                    const dayEntries = memberEntries.filter((e) => {
                      const d = new Date(e.timestamp);
                      d.setHours(0, 0, 0, 0);
                      return d.getTime() === day.getTime();
                    });

                    // Calculate sessions
                    const sessions = calculateWorkSessions(dayEntries);

                    const visibleSessions = sessions.slice(
                      0,
                      MAX_SESSIONS_PER_DAY
                    );
                    const extraSessions =
                      sessions.length - visibleSessions.length;

                    return (
                      <button
                        key={i}
                        className={cn(
                          'min-h-[110px] p-1.5 bg-card border border-border/60 rounded-md transition-colors text-left cursor-pointer',
                          'hover:bg-[rgba(123,44,191,0.06)] hover:border-[rgba(123,44,191,0.3)]',
                          isToday &&
                            'bg-[rgba(123,44,191,0.08)] border-[rgba(123,44,191,0.4)]'
                        )}
                        type="button"
                        onClick={() => {
                          onDateSelect(day);
                          onViewChange('day');
                        }}
                      >
                        <div className="space-y-1.5">
                          {visibleSessions.map((session, idx) => {
                            // Check if pending delete
                            const isPendingDelete =
                              session.clockIn?.status === 'pending_delete' ||
                              session.clockOut?.status === 'pending_delete';

                            // CSS for diagonal hatching pattern
                            const hatchedStyle = isPendingDelete
                              ? {
                                  backgroundImage: `repeating-linear-gradient(
                                    -45deg,
                                    transparent,
                                    transparent 3px,
                                    rgba(161, 98, 7, 0.3) 3px,
                                    rgba(161, 98, 7, 0.3) 6px
                                  )`
                                }
                              : {};

                            // Handle orphan clock_out (no clockIn)
                            if (
                              session.isOrphan &&
                              !session.clockIn &&
                              session.clockOut
                            ) {
                              const orphanTime = new Date(
                                session.clockOut.timestamp
                              );
                              const isPending =
                                session.clockOut.status === 'pending';
                              const timeStr = orphanTime.toLocaleTimeString(
                                'de-DE',
                                {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                }
                              );

                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSessionClick?.(session);
                                  }}
                                  className={cn(
                                    'text-xs p-1 rounded border flex items-center gap-1 shadow-sm w-full text-left transition-opacity hover:opacity-80',
                                    isPendingDelete
                                      ? 'bg-yellow-200/80 border-yellow-500/60 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200'
                                      : isPending
                                      ? 'bg-yellow-400/80 border-yellow-500/60 text-yellow-900 dark:bg-yellow-500/80 dark:text-yellow-100'
                                      : 'bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-400'
                                  )}
                                  style={hatchedStyle}
                                >
                                  <Clock className="h-3 w-3 shrink-0 opacity-70" />
                                  <ArrowDown className="h-3 w-3 shrink-0" />
                                  <span className="font-medium truncate text-[10px]">
                                    {timeStr}
                                  </span>
                                </button>
                              );
                            }

                            // Handle orphan clock_in (from previous day)
                            if (
                              session.isOrphan &&
                              session.clockIn &&
                              !session.clockOut
                            ) {
                              const orphanTime = new Date(
                                session.clockIn.timestamp
                              );
                              const isPending =
                                session.clockIn.status === 'pending';
                              const timeStr = orphanTime.toLocaleTimeString(
                                'de-DE',
                                {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                }
                              );

                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSessionClick?.(session);
                                  }}
                                  className={cn(
                                    'text-xs p-1 rounded border flex items-center gap-1 shadow-sm w-full text-left transition-opacity hover:opacity-80',
                                    isPendingDelete
                                      ? 'bg-yellow-200/80 border-yellow-500/60 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200'
                                      : isPending
                                      ? 'bg-yellow-400/80 border-yellow-500/60 text-yellow-900 dark:bg-yellow-500/80 dark:text-yellow-100'
                                      : 'bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-400'
                                  )}
                                  style={hatchedStyle}
                                >
                                  <Clock className="h-3 w-3 shrink-0 opacity-70" />
                                  <ArrowUp className="h-3 w-3 shrink-0" />
                                  <span className="font-medium truncate text-[10px]">
                                    {timeStr}
                                  </span>
                                </button>
                              );
                            }

                            // Normal session with clockIn (paired or open/currently working)
                            const start = new Date(session.clockIn!.timestamp);
                            const end = session.clockOut
                              ? new Date(session.clockOut.timestamp)
                              : new Date();

                            const isPending =
                              session.clockIn!.status === 'pending' ||
                              session.clockOut?.status === 'pending';
                            const isOpen =
                              !session.clockOut && !session.isOrphan;

                            // Duration calculation
                            const durationMs = end.getTime() - start.getTime();
                            const hours = Math.floor(
                              durationMs / (1000 * 60 * 60)
                            );
                            const minutes = Math.floor(
                              (durationMs % (1000 * 60 * 60)) / (1000 * 60)
                            );
                            const durationText =
                              hours > 0
                                ? `${hours}h ${minutes}m`
                                : `${minutes}m`;

                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSessionClick?.(session);
                                }}
                                className={cn(
                                  'text-xs p-1.5 rounded border flex items-center gap-1.5 shadow-sm w-full text-left transition-opacity hover:opacity-80',
                                  isPendingDelete
                                    ? 'bg-yellow-200/80 border-yellow-500/60 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200'
                                    : isPending
                                    ? 'bg-yellow-400/80 border-yellow-500/60 text-yellow-900 dark:bg-yellow-500/80 dark:text-yellow-100'
                                    : isOpen
                                    ? 'bg-green-500/10 border-green-500/60 text-foreground animate-pulse'
                                    : 'bg-green-500/80 border-green-500/60 text-white'
                                )}
                                style={hatchedStyle}
                              >
                                <Clock className="h-3 w-3 shrink-0 opacity-70" />
                                <span className="font-medium truncate">
                                  {isPendingDelete
                                    ? 'Löschen'
                                    : isOpen
                                    ? 'Arbeitet'
                                    : 'Arbeitszeit'}
                                </span>
                                <span className="opacity-70 truncate text-[10px]">
                                  {durationText}
                                </span>
                              </button>
                            );
                          })}
                          {extraSessions > 0 && (
                            <span className="text-[11px] font-medium text-[rgb(123,44,191)]">
                              +{extraSessions} mehr
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {members.length === 0 && (
              <div className="p-8 text-center text-muted-foreground text-sm border rounded-md bg-muted/10">
                Keine Mitarbeiter gefunden
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

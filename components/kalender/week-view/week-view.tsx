'use client';

import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Clock, ArrowUp, ArrowDown, Briefcase, Coffee } from 'lucide-react';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import {
  calculateCalendarWorkBlocks,
  createSessionFromCalendarBlock,
  getCalendarBlockDurationMinutes
} from '@/lib/time-tracking/calendar-blocks';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, toLocalDateString } from '@/lib/utils';
import type {
  InteractiveCalendarSession,
  TimeEntry,
  WorkSession,
  EntryChangeRequestMap
} from '@/lib/time-tracking/types';
import type { CalendarJob } from '@/lib/jobs/types';
import type { OrgRole } from '@/lib/members/actions';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import { getRoleLabel } from '@/lib/roles';
import type { CalendarView } from '../calendar-container';
import { JobEventPopover } from '../job-event-popover';
import type { DragJobPayload } from '../parkplatz-panel';

const JOB_MIME = 'application/x-werkflow-job';
const SESSION_MIME = 'application/x-werkflow-session';

type DragSessionPayload = {
  session: InteractiveCalendarSession;
  sourceDate: string;
  sourceMemberId: string;
};

// CSS for day cell hover behavior - only highlights when not hovering on entry buttons
const dayCellStyles = `
  .week-view-day-cell {
    transition: background-color 0.15s, border-color 0.15s;
  }
  .week-view-day-cell:hover:not(:has(.week-view-entry:hover)) {
    background-color: rgba(123, 44, 191, 0.06) !important;
    border-color: rgba(123, 44, 191, 0.3) !important;
  }
  .week-view-day-cell.is-today:hover:not(:has(.week-view-entry:hover)) {
    background-color: rgba(123, 44, 191, 0.12) !important;
    border-color: rgba(123, 44, 191, 0.5) !important;
  }
`;

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
  organizationSettings: OrganizationTimeTrackingSettings;
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  isLoading: boolean;
  onDateSelect: (date: Date) => void;
  onViewChange: (view: CalendarView) => void;
  onSessionClick?: (session: WorkSession) => void;
  changeRequestMap?: EntryChangeRequestMap;
  onMemberDayClick?: (memberId: string, date: Date) => void;
  jobs?: CalendarJob[];
  onParkJob?: (jobId: string) => void;
  onUnparkJob?: (jobId: string, date: string, time?: string, memberId?: string) => void;
  onJobWeekMove?: (jobId: string, newDate: string, newMemberId: string, oldMemberId: string) => void;
  onJobWeekHeaderMove?: (jobId: string, newDate: string, oldMemberId?: string) => void;
  onSessionWeekMove?: (session: WorkSession, newDate: string, newMemberId: string) => void;
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

function withMemberContext(
  session: WorkSession,
  member: CalendarMember
): InteractiveCalendarSession {
  return {
    ...(session as InteractiveCalendarSession),
    employeeName: getMemberDisplayName(member),
    employeeRole: member.role as OrgRole
  };
}

export function WeekView({
  date,
  entries,
  members,
  organizationSettings,
  isAdminOrManager,
  isLoading,
  onDateSelect,
  onViewChange,
  onSessionClick,
  onMemberDayClick,
  jobs = [],
  onUnparkJob,
  onJobWeekMove,
  onJobWeekHeaderMove,
  onSessionWeekMove
}: WeekViewProps) {
  const weekDays = useMemo(() => getWeekDays(date), [date]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [selectedJob, setSelectedJob] = useState<{
    job: CalendarJob;
    position: { x: number; y: number };
  } | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 60000);

    return () => window.clearInterval(interval);
  }, []);

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

  const didDragRef = useRef(false);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const handleCellDrop = useCallback((
    e: React.DragEvent,
    targetDay: Date,
    targetMemberId: string
  ) => {
    if (!isAdminOrManager) return;
    e.preventDefault();
    setDragOverTarget(null);
    document.body.classList.remove('is-dragging');

    const targetDate = toLocalDateString(targetDay);

    const jobRaw = e.dataTransfer.getData(JOB_MIME);
    if (jobRaw) {
      try {
        const payload: DragJobPayload = JSON.parse(jobRaw);
        if (payload.source === 'parkplatz') {
          onUnparkJob?.(payload.jobId, targetDate, undefined, targetMemberId);
        } else {
          onJobWeekMove?.(payload.jobId, targetDate, targetMemberId, payload.sourceMemberId ?? '');
        }
      } catch { /* ignore */ }
      return;
    }

    const sessionRaw = e.dataTransfer.getData(SESSION_MIME);
    if (sessionRaw) {
      try {
        const payload: DragSessionPayload = JSON.parse(sessionRaw);
        onSessionWeekMove?.(payload.session, targetDate, targetMemberId);
      } catch { /* ignore */ }
    }
  }, [isAdminOrManager, onUnparkJob, onJobWeekMove, onSessionWeekMove]);

  const handleHeaderDrop = useCallback((
    e: React.DragEvent,
    targetDay: Date
  ) => {
    if (!isAdminOrManager) return;
    e.preventDefault();
    setDragOverTarget(null);
    document.body.classList.remove('is-dragging');

    const targetDate = toLocalDateString(targetDay);
    const jobRaw = e.dataTransfer.getData(JOB_MIME);
    if (!jobRaw) return;

    try {
      const payload: DragJobPayload = JSON.parse(jobRaw);
      if (payload.source === 'parkplatz') {
        onUnparkJob?.(payload.jobId, targetDate);
      } else {
        onJobWeekHeaderMove?.(payload.jobId, targetDate, payload.sourceMemberId);
      }
    } catch {
      // ignore parse errors
    }
  }, [isAdminOrManager, onJobWeekHeaderMove, onUnparkJob]);

  const jobsByDay = useMemo(() => {
    const map: Record<string, CalendarJob[]> = {};
    for (const day of weekDays) {
      const dateStr = toLocalDateString(day);
      map[dateStr] = jobs.filter((j) => j.plannedDate === dateStr);
    }
    return map;
  }, [jobs, weekDays]);

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

  // Pre-compute sessions for all member×day combinations in a single pass.
  // Avoids calling calculateWorkSessions per-cell inside the render loop.
  const sessionsByMemberDay = useMemo(() => {
    // Open work blocks depend on the current time, so re-evaluate this memo every minute.
    void nowTick;
    const map = new Map<
      string,
      {
        workBlocks: ReturnType<typeof calculateCalendarWorkBlocks>;
        orphanSessions: ReturnType<typeof calculateWorkSessions>;
      }
    >();
    for (const [userId, userEntries] of Object.entries(entriesByUser)) {
      for (const day of weekDays) {
        const dayTime = day.getTime();
        const dayEntries = userEntries.filter((e) => {
          const d = new Date(e.timestamp);
          d.setHours(0, 0, 0, 0);
          return d.getTime() === dayTime;
        });
        if (dayEntries.length > 0) {
          const sessions = calculateWorkSessions(dayEntries);
          map.set(`${userId}-${day.toDateString()}`, {
            workBlocks: calculateCalendarWorkBlocks(dayEntries),
            orphanSessions: sessions.filter((session) => session.isOrphan)
          });
        }
      }
    }
    return map;
  }, [entriesByUser, weekDays, nowTick]);

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
    <div className="min-w-[1150px] px-4 pb-4">
      <style dangerouslySetInnerHTML={{ __html: dayCellStyles }} />
          {/* Header Row */}
          <div className="grid grid-cols-[140px_repeat(7,_minmax(140px,_1fr))] gap-1 mb-1 sticky top-0 pt-4 bg-background z-20">
            <div className="p-2 font-medium text-sm text-muted-foreground flex items-center sticky left-0 bg-background z-10">
              Mitarbeiter
            </div>
            {weekDays.map((day, i) => {
              const isToday = day.toDateString() === today.toDateString();
              const dateStr = toLocalDateString(day);
              const headerJobs = (jobsByDay[dateStr] || []).filter(
                (job) => job.assignedUserIds.length === 0
              );
              return (
                <div
                  key={i}
                  className={cn(
                    'rounded-md border p-2 text-sm font-medium transition-colors cursor-pointer hover:bg-accent',
                    isToday
                      ? 'bg-[rgba(123,44,191,0.12)] border-[rgba(123,44,191,0.5)] text-[rgb(123,44,191)]'
                      : 'bg-muted/30 border-transparent',
                    dragOverTarget === `header-${i}` && 'ring-2 ring-brand-purple/50 bg-brand-purple/5'
                  )}
                  onClick={() => {
                    onDateSelect(day);
                    onViewChange('day');
                  }}
                  onDragOver={(e) => {
                    if (!isAdminOrManager) return;
                    if (e.dataTransfer.types.includes(JOB_MIME)) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDragOverTarget(`header-${i}`);
                    }
                  }}
                  onDragEnter={(e) => {
                    if (!isAdminOrManager) return;
                    if (e.dataTransfer.types.includes(JOB_MIME)) {
                      e.preventDefault();
                      setDragOverTarget(`header-${i}`);
                    }
                  }}
                  onDragLeave={(e) => {
                    const related = e.relatedTarget as Node | null;
                    if (related && (e.currentTarget as HTMLElement).contains(related)) return;
                    setDragOverTarget(null);
                  }}
                  onDrop={(e) => handleHeaderDrop(e, day)}
                >
                  <div className="flex flex-col gap-2">
                    <div className="text-center">
                      <div className="text-muted-foreground text-xs uppercase">
                        {DAY_NAMES_SHORT[i]}
                      </div>
                      <div className={cn('text-lg', isToday && 'font-bold')}>
                        {day.getDate()}
                      </div>
                    </div>
                    {isAdminOrManager && headerJobs.length > 0 && (() => {
                      const MAX_VISIBLE_HEADER_JOBS = 3;
                      const visibleHeaderJobs = headerJobs.slice(0, MAX_VISIBLE_HEADER_JOBS);
                      const extraHeaderJobs = headerJobs.length - visibleHeaderJobs.length;

                      return (
                        <div className="space-y-1 text-left" onClick={(e) => e.stopPropagation()}>
                          {visibleHeaderJobs.map((job) => (
                            <button
                              key={job.id}
                              type="button"
                              draggable
                              onDragStart={(e) => {
                                didDragRef.current = true;
                                const payload: DragJobPayload = {
                                  jobId: job.id,
                                  source: 'week',
                                  sourceDate: toLocalDateString(day),
                                };
                                e.dataTransfer.setData(JOB_MIME, JSON.stringify(payload));
                                e.dataTransfer.effectAllowed = 'move';
                                document.body.classList.add('is-dragging');
                              }}
                              onDragEnd={() => {
                                document.body.classList.remove('is-dragging');
                                setTimeout(() => { didDragRef.current = false; }, 0);
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (didDragRef.current) return;
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setSelectedJob({
                                  job,
                                  position: { x: rect.right + 8, y: rect.top }
                                });
                              }}
                              className="week-view-entry w-full rounded-md border border-brand-purple/30 bg-brand-purple/10 p-1 text-left text-xs text-foreground shadow-sm transition-opacity hover:opacity-80"
                            >
                              <span className="flex items-center gap-1">
                                <Briefcase className="h-3 w-3 shrink-0 text-brand-purple" />
                                <span className="truncate text-[10px] font-medium" title={job.title}>
                                  {job.title}
                                </span>
                              </span>
                            </button>
                          ))}
                          {extraHeaderJobs > 0 && (
                            <span className="block text-[11px] font-medium text-brand-purple">
                              +{extraHeaderJobs} mehr
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Member Rows */}
          <div className="space-y-1">
            {members.map((member) => {
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
                      {getRoleLabel(member.role)}
                    </div>
                  </div>

                  {/* Day Cells */}
                  {weekDays.map((day, i) => {
                    const dayStr = day.toDateString();
                    const isToday = dayStr === today.toDateString();

                    const cellData = sessionsByMemberDay.get(`${member.user_id}-${dayStr}`);
                    const workBlocks = cellData?.workBlocks ?? [];
                    const orphanSessions = cellData?.orphanSessions ?? [];
                    const items = [...workBlocks, ...orphanSessions];

                    const visibleSessions = items.slice(
                      0,
                      MAX_SESSIONS_PER_DAY
                    );
                    const extraSessions =
                      items.length - visibleSessions.length;

                    return (
                      <div
                        key={i}
                        className={cn(
                          'week-view-day-cell min-h-[110px] p-1.5 bg-card border border-border/60 rounded-md text-left cursor-pointer',
                          isToday &&
                            'is-today bg-[rgba(123,44,191,0.08)] border-[rgba(123,44,191,0.4)]',
                          dragOverTarget === `${member.user_id}-${i}` && 'ring-2 ring-brand-purple/50 bg-brand-purple/5'
                        )}
                        onClick={() => {
                          if (onMemberDayClick) {
                            onMemberDayClick(member.user_id, day);
                          } else {
                            onDateSelect(day);
                            onViewChange('day');
                          }
                        }}
                        onDragOver={(e) => {
                          if (!isAdminOrManager) return;
                          if (e.dataTransfer.types.includes(JOB_MIME) || e.dataTransfer.types.includes(SESSION_MIME)) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            setDragOverTarget(`${member.user_id}-${i}`);
                          }
                        }}
                        onDragEnter={(e) => {
                          if (!isAdminOrManager) return;
                          if (e.dataTransfer.types.includes(JOB_MIME) || e.dataTransfer.types.includes(SESSION_MIME)) {
                            e.preventDefault();
                            setDragOverTarget(`${member.user_id}-${i}`);
                          }
                        }}
                        onDragLeave={(e) => {
                          const related = e.relatedTarget as Node | null;
                          if (related && (e.currentTarget as HTMLElement).contains(related)) return;
                          setDragOverTarget(null);
                        }}
                        onDrop={(e) => handleCellDrop(e, day, member.user_id)}
                      >
                        <div className="space-y-1.5">
                          {visibleSessions.map((session, idx) => {
                            if ('segments' in session) {
                              const durationText = formatDuration(
                                Math.round(getCalendarBlockDurationMinutes(session))
                              );
                              const sessionForBlock = withMemberContext(
                                createSessionFromCalendarBlock(
                                  session,
                                  new Date(nowTick),
                                  organizationSettings
                                ),
                                member
                              );
                              const breakMinutes = Math.round(
                                (sessionForBlock.breaks ?? []).reduce((total, workBreak) => {
                                  const breakEnd = workBreak.breakEnd
                                    ? new Date(workBreak.breakEnd.timestamp)
                                    : new Date(nowTick);
                                  return (
                                    total +
                                    Math.max(
                                      0,
                                      (breakEnd.getTime() -
                                        new Date(workBreak.breakStart.timestamp).getTime()) /
                                        60000
                                    )
                                  );
                                }, 0)
                              );
                              const workMinutes = Math.max(
                                0,
                                Math.round(getCalendarBlockDurationMinutes(session)) - breakMinutes
                              );
                              const canDrag =
                                isAdminOrManager &&
                                !!sessionForBlock.clockIn &&
                                !!sessionForBlock.clockOut &&
                                !session.isOpen;

                              return (
                                <button
                                  key={`work-block-${session.id}`}
                                  type="button"
                                  draggable={canDrag}
                                  onDragStart={canDrag ? (e) => {
                                    didDragRef.current = true;
                                    const payload: DragSessionPayload = {
                                      session: sessionForBlock,
                                      sourceDate: toLocalDateString(day),
                                      sourceMemberId: member.user_id,
                                    };
                                    e.dataTransfer.setData(SESSION_MIME, JSON.stringify(payload));
                                    e.dataTransfer.effectAllowed = 'move';
                                    document.body.classList.add('is-dragging');
                                  } : undefined}
                                  onDragEnd={canDrag ? () => {
                                    document.body.classList.remove('is-dragging');
                                    setTimeout(() => { didDragRef.current = false; }, 0);
                                  } : undefined}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (didDragRef.current) return;
                                    onSessionClick?.(sessionForBlock);
                                  }}
                                  className={cn(
                                    'week-view-entry text-xs p-1.5 rounded-md flex items-center gap-1.5 shadow-sm w-full text-left transition-opacity',
                                    sessionForBlock
                                      ? 'cursor-pointer hover:opacity-80'
                                      : 'cursor-default',
                                    session.isOpen && !session.isOnBreak
                                      ? 'bg-green-500/60 text-white dark:bg-green-600/60 animate-pulse'
                                      : 'bg-green-500/80 text-white dark:bg-green-600/80'
                                  )}
                                >
                                  <Clock className="h-3 w-3 shrink-0 opacity-70" />
                                  <span className="font-medium truncate">
                                    Arbeitszeit
                                  </span>
                                  {breakMinutes > 0 ? (
                                    <span className="flex items-center gap-1 opacity-70 truncate text-[10px]">
                                      <span>{formatDuration(workMinutes)}</span>
                                      <Coffee className="h-3 w-3 shrink-0" />
                                      <span>{formatDuration(breakMinutes)}</span>
                                    </span>
                                  ) : (
                                    <span className="opacity-70 truncate text-[10px]">
                                      {durationText}
                                    </span>
                                  )}
                                </button>
                              );
                            }

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
                                    onSessionClick?.(withMemberContext(session, member));
                                  }}
                                  className={cn(
                                    'week-view-entry text-xs p-1 rounded-md flex items-center gap-1 shadow-sm w-full text-left transition-opacity cursor-pointer hover:opacity-80',
                                    isPendingDelete
                                      ? 'bg-yellow-200/80 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200'
                                      : isPending
                                      ? 'bg-yellow-400/80 text-yellow-900 dark:bg-yellow-500/80 dark:text-yellow-100'
                                      : 'bg-red-500/20 text-red-700 dark:bg-red-600/20 dark:text-red-300 border border-red-500/40'
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
                                    onSessionClick?.(withMemberContext(session, member));
                                  }}
                                  className={cn(
                                    'week-view-entry text-xs p-1 rounded-md flex items-center gap-1 shadow-sm w-full text-left transition-opacity cursor-pointer hover:opacity-80',
                                    isPendingDelete
                                      ? 'bg-yellow-200/80 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200'
                                      : isPending
                                      ? 'bg-yellow-400/80 text-yellow-900 dark:bg-yellow-500/80 dark:text-yellow-100'
                                      : 'bg-red-500/20 text-red-700 dark:bg-red-600/20 dark:text-red-300 border border-red-500/40'
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

                            const canDrag =
                              isAdminOrManager &&
                              !!session.clockIn &&
                              !!session.clockOut &&
                              !session.isOrphan &&
                              !isOpen;

                            return (
                              <button
                                key={idx}
                                type="button"
                                draggable={canDrag}
                                onDragStart={canDrag ? (e) => {
                                  didDragRef.current = true;
                                  const payload: DragSessionPayload = {
                                    session: withMemberContext(session, member),
                                    sourceDate: toLocalDateString(day),
                                    sourceMemberId: member.user_id,
                                  };
                                  e.dataTransfer.setData(SESSION_MIME, JSON.stringify(payload));
                                  e.dataTransfer.effectAllowed = 'move';
                                  document.body.classList.add('is-dragging');
                                } : undefined}
                                onDragEnd={canDrag ? () => { document.body.classList.remove('is-dragging'); setTimeout(() => { didDragRef.current = false; }, 0); } : undefined}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (didDragRef.current) return;
                                  onSessionClick?.(withMemberContext(session, member));
                                }}
                                className={cn(
                                  'week-view-entry text-xs p-1.5 rounded-md flex items-center gap-1.5 shadow-sm w-full text-left transition-opacity cursor-pointer hover:opacity-80',
                                  isPendingDelete
                                    ? 'bg-yellow-200/80 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200'
                                    : isPending
                                    ? 'bg-yellow-400/80 text-yellow-900 dark:bg-yellow-500/80 dark:text-yellow-100'
                                    : isOpen
                                    ? 'bg-green-500/60 text-white dark:bg-green-600/60 animate-pulse'
                                    : 'bg-green-500/80 text-white dark:bg-green-600/80'
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
                            <span className="text-[11px] font-medium text-[rgb(123,44,191)] cursor-pointer">
                              +{extraSessions} mehr
                            </span>
                          )}

                          {/* Job badges */}
                          {(() => {
                            const dateStr = toLocalDateString(day);
                            const dayJobsList = jobsByDay[dateStr] || [];
                            const memberJobs = dayJobsList.filter(
                              (j) => j.assignedUserIds.includes(member.user_id)
                            );
                            if (memberJobs.length === 0) return null;

                            const MAX_VISIBLE_JOBS = 3;
                            const visibleJobs = memberJobs.slice(0, MAX_VISIBLE_JOBS);
                            const extraJobs = memberJobs.length - visibleJobs.length;
                            return (<>
                            {visibleJobs.map((job) => (
                              <button
                                key={job.id}
                                type="button"
                                draggable={isAdminOrManager}
                                onDragStart={(e) => {
                                  if (!isAdminOrManager) return;
                                  didDragRef.current = true;
                                  const payload: DragJobPayload = {
                                    jobId: job.id,
                                    source: 'week',
                                    sourceDate: toLocalDateString(day),
                                    sourceMemberId: member.user_id,
                                  };
                                  e.dataTransfer.setData(JOB_MIME, JSON.stringify(payload));
                                  e.dataTransfer.effectAllowed = 'move';
                                  document.body.classList.add('is-dragging');
                                }}
                                onDragEnd={() => { document.body.classList.remove('is-dragging'); setTimeout(() => { didDragRef.current = false; }, 0); }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (didDragRef.current) return;
                                  const rect = (e.target as HTMLElement).getBoundingClientRect();
                                  setSelectedJob({
                                    job,
                                    position: { x: rect.right + 8, y: rect.top }
                                  });
                                }}
                                className="week-view-entry text-xs p-1 rounded-md flex items-center gap-1 shadow-sm w-full text-left transition-opacity cursor-pointer hover:opacity-80 bg-brand-purple/10 border border-brand-purple/30 text-foreground"
                              >
                                <Briefcase className="h-3 w-3 shrink-0 text-brand-purple" />
                                <span className="font-medium truncate text-[10px]" title={job.title}>
                                  {job.title}
                                </span>
                              </button>
                            ))}
                            {extraJobs > 0 && (
                              <span className="text-[11px] font-medium text-brand-purple cursor-pointer">
                                +{extraJobs} mehr
                              </span>
                            )}
                            </>);
                          })()}
                        </div>
                      </div>
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

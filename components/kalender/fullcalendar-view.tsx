'use client';

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventClickArg, EventContentArg, EventDropArg } from '@fullcalendar/core';
import { Clock, ArrowUp, ArrowDown, Briefcase, Coffee } from 'lucide-react';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import {
  calculateCalendarWorkBlocks,
  createSessionFromCalendarBlock,
  getCalendarBlockDurationMinutes
} from '@/lib/time-tracking/calendar-blocks';
import { toLocalDateString } from '@/lib/utils';
import type {
  InteractiveCalendarSession,
  TimeEntry,
  WorkSession
} from '@/lib/time-tracking/types';
import type { CalendarJob } from '@/lib/jobs/types';
import type { CalendarView } from './calendar-container';
import { JobEventPopover } from './job-event-popover';
import { clearCalendarDragState, startCalendarDragState } from './drag-state';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';

interface CalendarMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface FullCalendarViewProps {
  date: Date;
  view: CalendarView;
  entries: TimeEntry[];
  members: CalendarMember[];
  organizationSettings: OrganizationTimeTrackingSettings;
  currentUserId: string;
  isAdminOrManager: boolean;
  onEventClick: (session: InteractiveCalendarSession) => void;
  onDateSelect: (date: Date) => void;
  onViewChange: (view: CalendarView) => void;
  jobs?: CalendarJob[];
  onJobDateChange?: (jobId: string, newDate: string, newTime?: string, revertFn?: () => void) => void;
  onParkJob?: (jobId: string) => void;
  onUnparkJob?: (jobId: string, date: string, time?: string) => void;
  parkplatzZoneRef?: React.RefObject<HTMLElement | null>;
  parkplatzPanelOpen?: boolean;
  onSessionDateChange?: (session: InteractiveCalendarSession, newDate: string, newMemberId: string, revertFn?: () => void) => void;
  onPointerOverParkplatzChange?: (isOver: boolean) => void;
}

// Map our view names to FullCalendar view names
const VIEW_MAP: Record<CalendarView, string> = {
  day: 'timeGridDay',
  week: 'timeGridWeek',
  month: 'dayGridMonth'
};

export function FullCalendarView({
  date,
  view,
  entries,
  members,
  organizationSettings,
  currentUserId,
  isAdminOrManager,
  onEventClick,
  onDateSelect,
  onViewChange,
  jobs = [],
  onJobDateChange,
  onParkJob,
  onUnparkJob,
  parkplatzZoneRef,
  parkplatzPanelOpen,
  onSessionDateChange,
  onPointerOverParkplatzChange
}: FullCalendarViewProps) {
  const calendarRef = useRef<FullCalendar>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedJob, setSelectedJob] = useState<{
    job: CalendarJob;
    position: { x: number; y: number };
  } | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const onUnparkJobRef = useRef(onUnparkJob);
  const onParkJobRef = useRef(onParkJob);
  const onPointerOverParkplatzChangeRef = useRef(onPointerOverParkplatzChange);

  useEffect(() => {
    onUnparkJobRef.current = onUnparkJob;
  }, [onUnparkJob]);

  useEffect(() => {
    onParkJobRef.current = onParkJob;
  }, [onParkJob]);

  useEffect(() => {
    onPointerOverParkplatzChangeRef.current = onPointerOverParkplatzChange;
  }, [onPointerOverParkplatzChange]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 60000);

    return () => window.clearInterval(interval);
  }, []);
  const fcDragMoveRef = useRef<((e: MouseEvent) => void) | null>(null);

  useEffect(() => {
    if (view !== 'month') return;
    const container = containerRef.current;
    if (!container) return;

    const HIGHLIGHT_CLASS = 'fc-parkplatz-drop-highlight';
    let currentHighlight: Element | null = null;

    const findDayCell = (el: Element | null): Element | null => {
      if (!el) return null;
      if (el.classList?.contains('fc-daygrid-day')) return el;
      return el.closest?.('.fc-daygrid-day') ?? null;
    };

    const handleDragOver = (e: Event) => {
      const de = e as DragEvent;
      if (!de.dataTransfer?.types.includes('application/x-werkflow-job')) return;
      de.preventDefault();
      const cell = findDayCell(de.target as Element);
      if (cell && cell !== currentHighlight) {
        currentHighlight?.classList.remove(HIGHLIGHT_CLASS);
        cell.classList.add(HIGHLIGHT_CLASS);
        currentHighlight = cell;
      }
    };

    const handleDragLeave = (e: Event) => {
      const de = e as DragEvent;
      const cell = findDayCell(de.target as Element);
      if (cell && cell === currentHighlight) {
        const related = de.relatedTarget as Element | null;
        if (!related || !cell.contains(related)) {
          cell.classList.remove(HIGHLIGHT_CLASS);
          currentHighlight = null;
        }
      }
    };

    const handleDrop = (e: Event) => {
      const de = e as DragEvent;
      currentHighlight?.classList.remove(HIGHLIGHT_CLASS);

      const raw = de.dataTransfer?.getData('application/x-werkflow-job');
      if (raw) {
        try {
          const payload = JSON.parse(raw);
          if (payload.jobId) {
            const cell = findDayCell(de.target as Element);
            const dateStr = cell?.getAttribute('data-date');
            if (dateStr) {
              de.preventDefault();
              de.stopPropagation();
              onUnparkJobRef.current?.(payload.jobId, dateStr);
            }
          }
        } catch { /* ignore parse errors */ }
      }

      currentHighlight = null;
    };

    const handleDragEnd = () => {
      currentHighlight?.classList.remove(HIGHLIGHT_CLASS);
      currentHighlight = null;
    };

    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('dragleave', handleDragLeave);
    container.addEventListener('drop', handleDrop);
    window.addEventListener('dragend', handleDragEnd);

    return () => {
      container.removeEventListener('dragover', handleDragOver);
      container.removeEventListener('dragleave', handleDragLeave);
      container.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragend', handleDragEnd);
      currentHighlight?.classList.remove(HIGHLIGHT_CLASS);
    };
  }, [view]);

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
  const selectedJobDisplay = useMemo(() => {
    if (!selectedJob) return null;
    return jobs.find((job) => job.id === selectedJob.job.id) ?? selectedJob.job;
  }, [jobs, selectedJob]);

  // Helper to get member name
  const getMemberName = (userId: string) => {
    const member = members.find((m) => m.user_id === userId);
    if (!member) return 'Arbeitszeit';
    return member.first_name || member.email.split('@')[0] || 'Arbeitszeit';
  };

  const withMemberContext = useCallback(
    (session: WorkSession): InteractiveCalendarSession => {
      const userId = session.clockIn?.userId || session.clockOut?.userId;
      const member = members.find((item) => item.user_id === userId);

      return {
        ...(session as InteractiveCalendarSession),
        employeeName: member
          ? member.first_name || member.last_name
            ? `${member.first_name || ''} ${member.last_name || ''}`.trim()
            : member.email
          : undefined,
        employeeRole: member?.role as InteractiveCalendarSession['employeeRole']
      };
    },
    [members]
  );

  // Convert work sessions to FullCalendar events
  const events = (() => {
    // Filter entries for the current user (for employees) or all (for admin in month view)
    const relevantEntries = isAdminOrManager
      ? entries
      : entries.filter((e) => e.userId === currentUserId);

    // Group entries by user first to calculate sessions correctly
    // calculateWorkSessions expects entries from a single user to pair correctly
    const entriesByUser: Record<string, typeof relevantEntries> = {};
    for (const entry of relevantEntries) {
      if (!entriesByUser[entry.userId]) {
        entriesByUser[entry.userId] = [];
      }
      entriesByUser[entry.userId].push(entry);
    }

    return Object.values(entriesByUser).flatMap((userEntries) => {
      const sessions = calculateWorkSessions(userEntries);
      const orphanSessions = sessions.filter((session) => session.isOrphan);
      const workBlocks = calculateCalendarWorkBlocks(userEntries);

      const orphanEvents = orphanSessions.map((session) => {
        const isPendingDelete =
          session.clockIn?.status === 'pending_delete' ||
          session.clockOut?.status === 'pending_delete';

        if (session.isOrphan && !session.clockIn && session.clockOut) {
          const orphanTime = new Date(session.clockOut.timestamp);
          const orphanEnd = new Date(orphanTime.getTime() + 15 * 60 * 1000);
          const isPending = session.clockOut.status === 'pending';

          return {
            id: `orphan-out-${session.clockOut.id}`,
            title: '',
            start: orphanTime,
            end: orphanEnd,
            backgroundColor: isPendingDelete
              ? 'rgb(254 240 138 / 0.8)'
              : isPending
                ? 'rgb(250 204 21 / 0.8)'
                : 'rgb(239 68 68 / 0.2)',
            borderColor: isPendingDelete
              ? 'rgba(202, 138, 4, 0.5)'
              : isPending
                ? 'rgba(202, 138, 4, 0.5)'
                : 'rgba(239, 68, 68, 0.4)',
            textColor: 'inherit',
            extendedProps: {
              session: withMemberContext(session),
              isPending,
              isPendingDelete,
              isOpen: false,
              isOrphan: true,
              isOrphanClockIn: false,
              durationText: isPendingDelete ? 'Löschen' : 'Ausstempeln',
              memberName: getMemberName(session.clockOut.userId)
            },
            classNames: [
              'fc-event-custom',
              'fc-event-orphan',
              isPendingDelete ? 'fc-event-pending-delete' : ''
            ].filter(Boolean)
          };
        }

        if (session.isOrphan && session.clockIn && !session.clockOut) {
          const orphanTime = new Date(session.clockIn.timestamp);
          const orphanEnd = new Date(orphanTime.getTime() + 15 * 60 * 1000);
          const isPending = session.clockIn.status === 'pending';

          return {
            id: `orphan-in-${session.clockIn.id}`,
            title: '',
            start: orphanTime,
            end: orphanEnd,
            backgroundColor: isPendingDelete
              ? 'rgb(254 240 138 / 0.8)'
              : isPending
                ? 'rgb(250 204 21 / 0.8)'
                : 'rgb(239 68 68 / 0.2)',
            borderColor: isPendingDelete
              ? 'rgba(202, 138, 4, 0.5)'
              : isPending
                ? 'rgba(202, 138, 4, 0.5)'
                : 'rgba(239, 68, 68, 0.4)',
            textColor: 'inherit',
            extendedProps: {
              session: withMemberContext(session),
              isPending,
              isPendingDelete,
              isOpen: false,
              isOrphan: true,
              isOrphanClockIn: true,
              durationText: isPendingDelete ? 'Löschen' : 'Einstempeln',
              memberName: getMemberName(session.clockIn.userId)
            },
            classNames: [
              'fc-event-custom',
              'fc-event-orphan',
              isPendingDelete ? 'fc-event-pending-delete' : ''
            ].filter(Boolean)
          };
        }

        return null;
      });

      const workEvents = workBlocks.map((block) => {
        const start = new Date(block.start);
        const end = block.end ? new Date(block.end) : new Date(nowTick);
        const durationMinutes = Math.round(getCalendarBlockDurationMinutes(block));
        const hours = Math.floor(durationMinutes / 60);
        const minutes = durationMinutes % 60;
        const durationText =
          hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        const isPulseOpen = block.isOpen && !block.isOnBreak;
        const session = withMemberContext(
          createSessionFromCalendarBlock(block, new Date(nowTick), organizationSettings)
        );
        const canDrag = isAdminOrManager && !!session?.clockOut && !block.isOpen;

        return {
          id: `work-block-${block.id}`,
          title: '',
          start,
          end,
          editable: canDrag,
          backgroundColor: block.isOpen
            ? 'rgb(34 197 94 / 0.6)'
            : 'rgb(34 197 94 / 0.8)',
          borderColor: 'transparent',
          textColor: '#fff',
          extendedProps: {
            session,
            isPending: block.isPending,
            isPendingDelete: false,
            isOpen: isPulseOpen,
            isOrphan: false,
            isOrphanClockIn: false,
            durationText,
            memberName: getMemberName(block.userId),
            isComposite: block.isComposite
          },
          classNames: [
            'fc-event-custom',
            isPulseOpen ? 'fc-event-open' : '',
            canDrag ? '' : 'fc-event-not-draggable'
          ].filter(Boolean)
        };
      });

      return [
        ...workEvents,
        ...orphanEvents.filter((event): event is NonNullable<typeof event> => event !== null)
      ];
    });
  })();

  const jobEvents = useMemo(() => {
    return jobs.map((job) => {
      const isAllDay = !job.plannedTime;
      let start: Date;
      let end: Date | undefined;

      if (job.plannedDate && job.plannedTime) {
        start = new Date(`${job.plannedDate}T${job.plannedTime}:00`);
        const durationMs = (job.estimatedDurationMinutes || 60) * 60 * 1000;
        end = new Date(start.getTime() + durationMs);
      } else if (job.plannedDate) {
        start = new Date(`${job.plannedDate}T00:00:00`);
      } else {
        return null;
      }

      return {
        id: `job-${job.id}`,
        title: '',
        start,
        end: isAllDay ? undefined : end,
        allDay: isAllDay,
        backgroundColor: 'rgb(123 44 191 / 0.15)',
        borderColor: 'rgb(123 44 191 / 0.4)',
        textColor: 'inherit',
        editable: true,
        extendedProps: {
          isJobEvent: true,
          jobId: job.id,
          job
        },
        classNames: ['fc-event-job']
      };
    }).filter((e): e is NonNullable<typeof e> => e !== null);
  }, [jobs]);

  const allEvents = useMemo(
    () => [...events, ...jobEvents],
    [events, jobEvents]
  );

  // Sync date with FullCalendar
  useEffect(() => {
    const calendarApi = calendarRef.current?.getApi();
    if (!calendarApi) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      calendarApi.gotoDate(date);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [date]);

  // Sync view with FullCalendar
  useEffect(() => {
    const calendarApi = calendarRef.current?.getApi();
    if (!calendarApi) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      calendarApi.changeView(VIEW_MAP[view]);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  // Handle column hover highlighting for timeGrid week view via JavaScript
  // FullCalendar overlays slots table on columns table, so CSS :hover doesn't work reliably
  // Note: This is disabled for day view as there's no navigation action in single day view
  useEffect(() => {
    if (view !== 'week') return;

    const wrapper = document.querySelector('.fullcalendar-wrapper');
    if (!wrapper) return;

    let hoveredDay: string | null = null;

    const clearHover = () => {
      if (hoveredDay) {
        // Remove highlight from header
        const header = wrapper.querySelector(
          `.fc-col-header-cell.fc-day-${hoveredDay}`
        );
        header?.classList.remove('column-hovered');

        // Remove highlight from column frame
        const colFrame = wrapper.querySelector(
          `.fc-timegrid-col.fc-day-${hoveredDay} .fc-timegrid-col-frame`
        );
        colFrame?.classList.remove('column-hovered');

        hoveredDay = null;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Check if hovering over an event - if so, clear hover
      if (target.closest('.fc-event')) {
        clearHover();
        return;
      }

      // Find the column we're in by looking for the timegrid-col parent
      // or by calculating position based on slot lane
      const slotLane = target.closest('.fc-timegrid-slot-lane');
      const colElement = target.closest('.fc-timegrid-col');

      let dayClass: string | null = null;

      if (colElement) {
        // Direct column hover (when clicking on events area)
        dayClass =
          Array.from(colElement.classList).find((c) =>
            c.match(/^fc-day-(mon|tue|wed|thu|fri|sat|sun|today)$/)
          ) || null;
      } else if (slotLane) {
        // Slot lane hover - calculate which column based on X position
        const cols = wrapper.querySelectorAll('.fc-timegrid-col');
        const mouseX = e.clientX;

        for (const col of cols) {
          const rect = col.getBoundingClientRect();
          if (mouseX >= rect.left && mouseX <= rect.right) {
            dayClass =
              Array.from(col.classList).find((c) =>
                c.match(/^fc-day-(mon|tue|wed|thu|fri|sat|sun|today)$/)
              ) || null;
            break;
          }
        }
      }

      if (dayClass) {
        // Extract the day part (e.g., "mon" from "fc-day-mon")
        const day = dayClass.replace('fc-day-', '');

        if (day !== hoveredDay) {
          clearHover();
          hoveredDay = day;

          // Add highlight to header
          const header = wrapper.querySelector(
            `.fc-col-header-cell.fc-day-${day}`
          );
          header?.classList.add('column-hovered');

          // Add highlight to column frame
          const colFrame = wrapper.querySelector(
            `.fc-timegrid-col.fc-day-${day} .fc-timegrid-col-frame`
          );
          colFrame?.classList.add('column-hovered');
        }
      } else {
        clearHover();
      }
    };

    const handleMouseLeave = () => {
      clearHover();
    };

    const timegridBody = wrapper.querySelector('.fc-timegrid-body');
    timegridBody?.addEventListener(
      'mousemove',
      handleMouseMove as EventListener
    );
    timegridBody?.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      timegridBody?.removeEventListener(
        'mousemove',
        handleMouseMove as EventListener
      );
      timegridBody?.removeEventListener('mouseleave', handleMouseLeave);
      clearHover();
    };
  }, [view]);

  useEffect(() => {
    return () => {
      if (fcDragMoveRef.current) {
        window.removeEventListener('mousemove', fcDragMoveRef.current);
        fcDragMoveRef.current = null;
      }
    };
  }, []);

  const handleEventClick = (info: EventClickArg) => {
    if (info.event.extendedProps.isJobEvent) {
      const job = info.event.extendedProps.job as CalendarJob;
      const rect = info.el.getBoundingClientRect();
      setSelectedJob({
        job,
        position: { x: rect.right + 8, y: rect.top }
      });
      return;
    }

    const session = info.event.extendedProps.session as InteractiveCalendarSession;
    if (session) {
      onEventClick(session);
    }
  };

  const handleEventDrop = (info: EventDropArg) => {
    // Always revert FullCalendar's internal move immediately. React state
    // (entries/calendarJobs) is the single source of truth — the optimistic
    // update in the handler will re-render FullCalendar with the correct
    // position via the events prop. Without this revert, FullCalendar's
    // internal state and our React state fight each other, causing entries
    // to flicker, jump, or disappear during rapid successive drags.
    info.revert();

    const newDate = info.event.start ? toLocalDateString(info.event.start) : null;
    if (!newDate) return;

    if (info.event.extendedProps.isJobEvent) {
      const jobId = info.event.extendedProps.jobId as string;
      if (!jobId) return;
      const newTime = info.event.allDay
        ? undefined
        : info.event.start
          ? `${String(info.event.start.getHours()).padStart(2, '0')}:${String(info.event.start.getMinutes()).padStart(2, '0')}`
          : undefined;
      onJobDateChange?.(jobId, newDate, newTime);
      return;
    }

    const session = info.event.extendedProps.session as InteractiveCalendarSession | undefined;
    if (session?.clockIn && session?.clockOut) {
      onSessionDateChange?.(
        session,
        newDate,
        session.clockIn.userId
      );
      return;
    }
  };

  const handleEventDragStart = useCallback((info: { event: { extendedProps: Record<string, unknown> } }) => {
    startCalendarDragState();

    if (!info.event.extendedProps.isJobEvent) return;

    const handler = (e: MouseEvent) => {
      let overParkplatz = false;

      const btnEl = parkplatzZoneRef?.current;
      if (btnEl) {
        const rect = btnEl.getBoundingClientRect();
        overParkplatz =
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom;
      }

      if (!overParkplatz && parkplatzPanelOpen) {
        const panelEl = document.querySelector('[data-parkplatz-panel]');
        if (panelEl) {
          const rect = panelEl.getBoundingClientRect();
          overParkplatz =
            e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom;
        }
      }

      onPointerOverParkplatzChangeRef.current?.(overParkplatz);
    };

    window.addEventListener('mousemove', handler);
    fcDragMoveRef.current = handler;
  }, [parkplatzZoneRef, parkplatzPanelOpen]);

  const handleEventDragStop = (info: { event: { extendedProps: Record<string, unknown>; remove: () => void }; el: HTMLElement; jsEvent: MouseEvent }) => {
    clearCalendarDragState();

    if (fcDragMoveRef.current) {
      window.removeEventListener('mousemove', fcDragMoveRef.current);
      fcDragMoveRef.current = null;
      onPointerOverParkplatzChangeRef.current?.(false);
    }

    if (!info.event.extendedProps.isJobEvent) return;

    const jobId = info.event.extendedProps.jobId as string | undefined;
    if (!jobId) return;

    const { clientX, clientY } = info.jsEvent;

    const isOverZone = (el: Element | HTMLElement | null | undefined) => {
      if (!el) return false;
      const rect = (el as HTMLElement).getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    };

    const hitParkplatz =
      isOverZone(parkplatzZoneRef?.current) ||
      (parkplatzPanelOpen && isOverZone(document.querySelector('[data-parkplatz-panel]')));

    if (hitParkplatz) {
      document.body.classList.add('fc-parking');
      info.el.style.display = 'none';
      document.querySelectorAll('.fc-event-mirror').forEach(m => {
        (m as HTMLElement).style.display = 'none';
      });
      info.event.remove();
      onParkJobRef.current?.(jobId);
      setTimeout(() => {
        document.body.classList.remove('fc-parking');
      }, 500);
    }
  };

  const handleEventReceive = (info: { event: { start: Date | null; allDay: boolean; extendedProps: Record<string, unknown>; remove: () => void } }) => {
    clearCalendarDragState();
    const jobId = info.event.extendedProps.jobId as string | undefined;
    if (!jobId) {
      info.event.remove();
      return;
    }

    const date = info.event.start ? toLocalDateString(info.event.start) : null;
    if (!date) {
      info.event.remove();
      return;
    }

    const time = info.event.allDay
      ? undefined
      : info.event.start
        ? `${String(info.event.start.getHours()).padStart(2, '0')}:${String(info.event.start.getMinutes()).padStart(2, '0')}`
        : undefined;

    info.event.remove();
    onUnparkJob?.(jobId, date, time);
  };

  const renderEventContent = (eventInfo: EventContentArg) => {
    if (eventInfo.event.extendedProps.isJobEvent) {
      const job = eventInfo.event.extendedProps.job as CalendarJob;
      return (
        <div className="flex items-center gap-1 pl-1 pr-0.5 overflow-hidden w-full text-foreground">
          <Briefcase className="h-3 w-3 shrink-0 text-brand-purple" />
          <span className="font-medium truncate text-xs" title={job.title}>
            {job.title}
          </span>
          {job.jobNumber && (
            <span className="text-[10px] text-muted-foreground truncate">
              {job.jobNumber}
            </span>
          )}
        </div>
      );
    }

    const {
      isPending,
      isPendingDelete,
      isOrphan,
      isOrphanClockIn,
      durationText,
      memberName
    } = eventInfo.event.extendedProps;
    const session = eventInfo.event.extendedProps.session as
      | InteractiveCalendarSession
      | undefined;
    const breakMinutes =
      session?.breaks?.reduce((total, workBreak) => {
        const breakEnd = workBreak.breakEnd
          ? new Date(workBreak.breakEnd.timestamp)
          : new Date();

        return (
          total +
          Math.max(
            0,
            (breakEnd.getTime() - new Date(workBreak.breakStart.timestamp).getTime()) /
              60000
          )
        );
      }, 0) ?? 0;

    // Orphan entries show differently - CSS handles vertical centering via fc-event-orphan class
    if (isOrphan) {
      const orphanLabel = isPendingDelete
        ? 'Löschen'
        : isOrphanClockIn
        ? 'Einstempeln'
        : 'Ausstempeln';
      const ArrowIcon = isOrphanClockIn ? ArrowUp : ArrowDown;
      const textColorClass =
        isPendingDelete || isPending
          ? 'text-yellow-800 dark:text-yellow-200'
          : 'text-red-600 dark:text-red-400';
      return (
        <div
          className={`flex items-center gap-1 pl-1 pr-0.5 overflow-hidden w-full ${textColorClass}`}
        >
          <Clock className="h-3 w-3 shrink-0 opacity-70" />
          <ArrowIcon className="h-3 w-3 shrink-0" />
          <span className="font-medium truncate text-[10px]">
            {isAdminOrManager ? memberName : orphanLabel}
          </span>
        </div>
      );
    }

    // Regular events - text at top
    const label = isAdminOrManager ? memberName : 'Arbeitszeit';
    const activityText = isPendingDelete ? 'Löschen' : durationText;

    const textColorClass =
      isPendingDelete || isPending
        ? 'text-yellow-800 dark:text-yellow-200'
        : 'text-white';

    return (
      <div
        className={`flex items-center gap-1.5 pl-1 pr-0.5 py-0.5 overflow-hidden w-full ${textColorClass}`}
      >
        <Clock className="h-3 w-3 shrink-0 opacity-70" />
        <span className="font-medium truncate">{label}</span>
        <span className="opacity-70 truncate text-[10px]">{activityText}</span>
        {breakMinutes > 0 && <Coffee className="h-3 w-3 shrink-0 opacity-70" />}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="fullcalendar-wrapper p-4 h-full">
      <style jsx global>{`
        /* Parkplatz drop highlight for month view cells */
        .fc-daygrid-day.fc-parkplatz-drop-highlight {
          box-shadow: inset 0 0 0 2px rgba(111, 95, 148, 0.5);
          background-color: rgba(111, 95, 148, 0.05) !important;
        }
        /* ===== BASE VARIABLES ===== */
        .fullcalendar-wrapper {
          background: transparent;
          --fc-border-color: var(--border);
          --fc-today-bg-color: rgba(111, 95, 148, 0.08);
          --fc-page-bg-color: transparent;
          --fc-neutral-bg-color: color-mix(
            in srgb,
            var(--muted),
            transparent 50%
          );
          --fc-event-border-color: transparent;
        }

        .fullcalendar-wrapper .fc {
          font-family: inherit;
          background: transparent;
          border: none;
          border-radius: 0.75rem;
          overflow: hidden;
          height: 100%;
        }

        /* ===== RESET DEFAULT TABLE SPACING ===== */
        .fullcalendar-wrapper .fc table {
          border-collapse: separate;
          border-spacing: 0;
        }

        /* Ensure view containers use transparent background */
        .fullcalendar-wrapper .fc-view-harness,
        .fullcalendar-wrapper .fc-view,
        .fullcalendar-wrapper .fc-scrollgrid {
          background: transparent;
        }

        /* Scrollgrid border and radius */
        .fullcalendar-wrapper .fc-scrollgrid {
          border-radius: 0.75rem;
          border: 1px solid color-mix(in srgb, var(--border), transparent 40%);
          overflow: hidden;
        }

        .fullcalendar-wrapper .fc-scrollgrid-section > td {
          border: none;
        }

        /* ===== HIDE DEFAULT TOOLBAR ===== */
        .fullcalendar-wrapper .fc-toolbar {
          display: none !important;
        }

        /* ===== HEADER STYLING ===== */
        .fullcalendar-wrapper .fc-col-header {
          background: transparent;
          position: sticky;
          top: 0;
          z-index: 3;
        }

        .fullcalendar-wrapper .fc-col-header-cell {
          padding: 0.75rem 0.5rem;
          font-weight: 600;
          font-size: 0.875rem;
          border-bottom: 1px solid var(--border);
          background: transparent;
          transition: background-color 0.15s;
        }

        .fullcalendar-wrapper .fc-col-header-cell-cushion {
          color: var(--foreground);
          text-decoration: none;
        }

        /* Time grid (day/week) header cells are clickable */
        .fullcalendar-wrapper .fc-timegrid .fc-col-header-cell {
          cursor: pointer;
        }

        .fullcalendar-wrapper .fc-timegrid .fc-col-header-cell:hover {
          background: var(--accent);
        }

        .fullcalendar-wrapper .fc-timegrid .fc-col-header-cell-cushion {
          cursor: pointer;
        }

        /* Day grid (month) header cells are NOT clickable - just labels */
        .fullcalendar-wrapper .fc-daygrid .fc-col-header-cell {
          cursor: default;
        }

        .fullcalendar-wrapper .fc-daygrid .fc-col-header-cell-cushion {
          cursor: default;
        }

        /* ===== TIME GRID (Day & Week Views) ===== */
        .fullcalendar-wrapper .fc-timegrid {
          background: transparent;
        }

        .fullcalendar-wrapper .fc-timegrid-slot {
          height: 2.75rem;
          border-top: 1px solid
            color-mix(in srgb, var(--border), transparent 70%) !important;
          border-bottom: none !important;
          background-color: transparent;
        }

        .fullcalendar-wrapper .fc-timegrid-slot-minor {
          border-top: 1px dashed
            color-mix(in srgb, var(--border), transparent 85%) !important;
          background-image: none !important;
        }

        .fullcalendar-wrapper .fc-timegrid-slots {
          border-right: none;
        }

        .fullcalendar-wrapper .fc-timegrid-slot-label {
          font-size: 0.75rem;
          color: var(--muted-foreground);
          padding: 0 0.5rem;
          vertical-align: top;
          padding-top: 0.25rem;
        }

        .fullcalendar-wrapper .fc-timegrid-col {
          border-left: none;
          cursor: pointer;
        }

        /* Column frame - this is the div that actually needs the background */
        .fullcalendar-wrapper .fc-timegrid-col-frame {
          transition: background-color 0.15s;
        }

        /* Timegrid header cells transition */
        .fullcalendar-wrapper .fc-timegrid .fc-col-header-cell {
          transition: background-color 0.15s;
        }

        /* Make the slot lanes receive hover events */
        .fullcalendar-wrapper .fc-timegrid-slot-lane {
          cursor: pointer;
        }

        /* === Column highlighting via JavaScript-added class === */

        /* Column frame highlight when JS adds .column-hovered class */
        .fullcalendar-wrapper .fc-timegrid-col-frame.column-hovered {
          background-color: rgba(111, 95, 148, 0.04) !important;
        }

        /* Header highlight when JS adds .column-hovered class */
        /* Note: Must override "today header base" rule below, so we scope to views for higher specificity */
        .fullcalendar-wrapper
          .fc-timeGridWeek-view
          .fc-col-header-cell.column-hovered,
        .fullcalendar-wrapper
          .fc-timeGridDay-view
          .fc-col-header-cell.column-hovered {
          background-color: var(--accent) !important;
        }

        /* Today column base */
        .fullcalendar-wrapper
          .fc-timegrid-col.fc-day-today
          .fc-timegrid-col-frame {
          background-color: rgba(111, 95, 148, 0.06) !important;
        }

        /* Today header base (week + day views) */
        .fullcalendar-wrapper
          .fc-timeGridWeek-view
          .fc-day-today.fc-col-header-cell,
        .fullcalendar-wrapper
          .fc-timeGridDay-view
          .fc-day-today.fc-col-header-cell {
          background-color: rgba(111, 95, 148, 0.06) !important;
        }

        /* Week view: hovering a column sets .column-hovered on the header via JS */
        /* This must come AFTER the "today header base" rule to override it. */
        .fullcalendar-wrapper
          .fc-timeGridWeek-view
          .fc-col-header-cell.column-hovered {
          background-color: var(--accent) !important;
        }

        /* Today column hover (via JS class) */
        .fullcalendar-wrapper
          .fc-timegrid-col.fc-day-today
          .fc-timegrid-col-frame.column-hovered {
          background-color: rgba(111, 95, 148, 0.1) !important;
        }

        /* === DAY VIEW: Disable hover/click interactions on column/header === */
        /* In day view, there's only one day shown and no navigation action */
        .fullcalendar-wrapper .fc-timeGridDay-view .fc-timegrid-col {
          cursor: default;
        }

        .fullcalendar-wrapper .fc-timeGridDay-view .fc-timegrid-slot-lane {
          cursor: default;
        }

        .fullcalendar-wrapper .fc-timeGridDay-view .fc-col-header-cell {
          cursor: default;
        }

        .fullcalendar-wrapper .fc-timeGridDay-view .fc-col-header-cell-cushion {
          cursor: default;
        }

        /* No hover highlight on header in day view */
        .fullcalendar-wrapper
          .fc-timeGridDay-view
          .fc-col-header-cell:hover:not(.fc-day-today) {
          background-color: transparent !important;
        }

        /* Header hover -> column highlight (CSS :has() works for header hover) */
        /* Only applies to week view - day view has these disabled below */
        /* Monday */
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-mon.fc-col-header-cell:hover)
          .fc-day-mon.fc-col-header-cell {
          background-color: var(--accent) !important;
        }
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-mon.fc-col-header-cell:hover)
          .fc-day-mon.fc-timegrid-col
          .fc-timegrid-col-frame {
          background-color: rgba(111, 95, 148, 0.04) !important;
        }

        /* Tuesday */
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-tue.fc-col-header-cell:hover)
          .fc-day-tue.fc-col-header-cell {
          background-color: var(--accent) !important;
        }
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-tue.fc-col-header-cell:hover)
          .fc-day-tue.fc-timegrid-col
          .fc-timegrid-col-frame {
          background-color: rgba(111, 95, 148, 0.04) !important;
        }

        /* Wednesday */
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-wed.fc-col-header-cell:hover)
          .fc-day-wed.fc-col-header-cell {
          background-color: var(--accent) !important;
        }
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-wed.fc-col-header-cell:hover)
          .fc-day-wed.fc-timegrid-col
          .fc-timegrid-col-frame {
          background-color: rgba(111, 95, 148, 0.04) !important;
        }

        /* Thursday */
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-thu.fc-col-header-cell:hover)
          .fc-day-thu.fc-col-header-cell {
          background-color: var(--accent) !important;
        }
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-thu.fc-col-header-cell:hover)
          .fc-day-thu.fc-timegrid-col
          .fc-timegrid-col-frame {
          background-color: rgba(111, 95, 148, 0.04) !important;
        }

        /* Friday */
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-fri.fc-col-header-cell:hover)
          .fc-day-fri.fc-col-header-cell {
          background-color: var(--accent) !important;
        }
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-fri.fc-col-header-cell:hover)
          .fc-day-fri.fc-timegrid-col
          .fc-timegrid-col-frame {
          background-color: rgba(111, 95, 148, 0.04) !important;
        }

        /* Saturday */
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-sat.fc-col-header-cell:hover)
          .fc-day-sat.fc-col-header-cell {
          background-color: var(--accent) !important;
        }
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-sat.fc-col-header-cell:hover)
          .fc-day-sat.fc-timegrid-col
          .fc-timegrid-col-frame {
          background-color: rgba(111, 95, 148, 0.04) !important;
        }

        /* Sunday */
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-sun.fc-col-header-cell:hover)
          .fc-day-sun.fc-col-header-cell {
          background-color: var(--accent) !important;
        }
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-sun.fc-col-header-cell:hover)
          .fc-day-sun.fc-timegrid-col
          .fc-timegrid-col-frame {
          background-color: rgba(111, 95, 148, 0.04) !important;
        }

        /* Today header hover -> column highlight (week view only) */
        .fullcalendar-wrapper
          .fc-timeGridWeek-view:has(.fc-day-today.fc-col-header-cell:hover)
          .fc-day-today.fc-timegrid-col
          .fc-timegrid-col-frame {
          background-color: rgba(111, 95, 148, 0.1) !important;
        }

        .fullcalendar-wrapper .fc-timegrid-axis {
          border-color: var(--border);
          background: transparent;
        }

        .fullcalendar-wrapper .fc-timegrid-now-indicator-line {
          border-color: var(--primary);
          border-width: 2px;
        }

        .fullcalendar-wrapper .fc-timegrid-now-indicator-arrow {
          border-color: var(--primary);
          border-top-color: transparent;
          border-bottom-color: transparent;
        }

        /* Time grid events */
        .fullcalendar-wrapper .fc-timegrid-event {
          border-radius: 0.375rem;
          font-size: 0.75rem;
          padding: 0.125rem 0.25rem;
          /* Use JS-set borderColor instead of CSS override */
          box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
          min-height: 22px !important; /* Ensure minimum height for short events */
        }

        /* Force timegrid event backgrounds based on class */
        .fullcalendar-wrapper .fc-timegrid-event.fc-event-custom {
          background-color: rgb(34 197 94 / 0.8) !important;
        }

        .fullcalendar-wrapper .fc-timegrid-event.fc-event-pending {
          background-color: rgb(250 204 21 / 0.8) !important;
        }

        .fullcalendar-wrapper .fc-timegrid-event.fc-event-orphan {
          background-color: rgb(239 68 68 / 0.2) !important;
          border: 1px solid rgba(239, 68, 68, 0.4) !important;
        }

        .fullcalendar-wrapper .fc-timegrid-event.fc-event-pending-delete {
          background-color: rgb(254 240 138 / 0.8) !important;
        }

        .fullcalendar-wrapper .fc-timegrid-event.fc-event-open {
          background-color: rgb(34 197 94 / 0.6) !important;
        }

        /* Override FullCalendar's default short event handling */
        .fullcalendar-wrapper .fc-timegrid-event-harness {
          min-height: 22px !important;
        }

        /* Orphan events need vertical centering */
        .fullcalendar-wrapper .fc-timegrid-event.fc-event-orphan {
          display: flex !important;
          align-items: center !important;
        }

        .fullcalendar-wrapper
          .fc-timegrid-event.fc-event-orphan
          .fc-event-main {
          display: flex;
          align-items: center;
          width: 100%;
        }

        /* ===== DAY GRID (Month View) ===== */
        .fullcalendar-wrapper .fc-daygrid {
          background: transparent;
        }

        .fullcalendar-wrapper .fc-daygrid-body {
          border-top: none;
        }

        /* Day cells - match weekly view styling */
        .fullcalendar-wrapper .fc-daygrid-day {
          border: 1px solid color-mix(in srgb, var(--border), transparent 40%) !important;
          background: var(--card);
          transition: background-color 0.15s, border-color 0.15s;
          cursor: pointer;
        }

        /* Only highlight day cell when hovering on empty space, not on events or "mehr" link */
        .fullcalendar-wrapper
          .fc-daygrid-day:hover:not(
            :has(.fc-event:hover, .fc-daygrid-more-link:hover)
          ) {
          background: rgba(111, 95, 148, 0.06) !important;
          border-color: rgba(111, 95, 148, 0.3) !important;
        }

        /* Fixed height for day cells */
        .fullcalendar-wrapper .fc-daygrid-day-frame {
          height: 120px; /* Fixed height */
          padding: 0.25rem;
          background-color: transparent;
          overflow: hidden;
        }

        .fullcalendar-wrapper .fc-daygrid-day-top {
          flex-direction: row;
          padding: 0.25rem;
        }

        .fullcalendar-wrapper .fc-daygrid-day-number {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--foreground);
          padding: 0.25rem 0.5rem;
          text-decoration: none;
        }

        /* Today cell styling - matches weekly view */
        .fullcalendar-wrapper .fc-daygrid-day.fc-day-today {
          background: rgba(111, 95, 148, 0.08) !important;
          border-color: rgba(111, 95, 148, 0.4) !important;
        }

        /* Only highlight today cell when hovering on empty space */
        .fullcalendar-wrapper
          .fc-daygrid-day.fc-day-today:hover:not(
            :has(.fc-event:hover, .fc-daygrid-more-link:hover)
          ) {
          background: rgba(111, 95, 148, 0.12) !important;
          border-color: rgba(111, 95, 148, 0.5) !important;
        }

        .fullcalendar-wrapper
          .fc-daygrid-day.fc-day-today
          .fc-daygrid-day-number {
          background: var(--brand-purple);
          color: #ffffff;
          border-radius: 9999px;
          width: 1.75rem;
          height: 1.75rem;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }

        /* Other month days (grayed out) */
        .fullcalendar-wrapper .fc-daygrid-day.fc-day-other {
          background: color-mix(
            in srgb,
            var(--muted),
            transparent 92%
          ) !important;
        }

        /* Only highlight other month day cell when hovering on empty space */
        .fullcalendar-wrapper
          .fc-daygrid-day.fc-day-other:hover:not(
            :has(.fc-event:hover, .fc-daygrid-more-link:hover)
          ) {
          background: color-mix(
            in srgb,
            var(--muted),
            transparent 85%
          ) !important;
        }

        .fullcalendar-wrapper
          .fc-daygrid-day.fc-day-other
          .fc-daygrid-day-number {
          color: var(--muted-foreground);
        }

        /* Day grid events */
        .fullcalendar-wrapper .fc-daygrid-day-events {
          max-height: 88px;
          overflow: hidden;
        }

        .fullcalendar-wrapper .fc-daygrid-event {
          margin: 1px 2px;
          padding: 0.125rem 0.4rem;
          border-radius: 0.375rem;
          font-size: 0.7rem;
          border: none !important;
          cursor: pointer;
        }

        /* Default green background for approved events in daygrid */
        .fullcalendar-wrapper .fc-daygrid-event.fc-event-custom {
          background-color: rgb(34 197 94 / 0.8) !important;
        }

        /* Pending events - yellow background */
        .fullcalendar-wrapper .fc-daygrid-event.fc-event-pending {
          background-color: rgb(250 204 21 / 0.8) !important;
        }

        /* Orphan events - red background */
        .fullcalendar-wrapper .fc-daygrid-event.fc-event-orphan {
          background-color: rgb(239 68 68 / 0.2) !important;
          border: 1px solid rgba(239, 68, 68, 0.4) !important;
        }

        /* Pending delete events - lighter yellow background with hatching */
        .fullcalendar-wrapper .fc-daygrid-event.fc-event-pending-delete {
          background-color: rgb(254 240 138 / 0.8) !important;
        }

        /* Open/pulsing events - lighter green */
        .fullcalendar-wrapper .fc-daygrid-event.fc-event-open {
          background-color: rgb(34 197 94 / 0.6) !important;
        }

        /* Ensure daygrid event harness doesn't override event styling */
        .fullcalendar-wrapper .fc-daygrid-event-harness {
          margin: 0;
        }

        /* Daygrid event hover effect - matches day/week view */
        .fullcalendar-wrapper .fc-daygrid-event:hover {
          opacity: 0.85;
          transform: scale(1.02);
        }

        /* Ensure event main container is transparent so parent bg shows */
        .fullcalendar-wrapper .fc-daygrid-event .fc-event-main {
          background: transparent !important;
        }

        /* Force inner frame to be transparent */
        .fullcalendar-wrapper .fc-daygrid-event .fc-event-main-frame {
          background: transparent !important;
        }

        /* More link */
        .fullcalendar-wrapper .fc-daygrid-more-link {
          font-size: 0.7rem;
          font-weight: 600;
          color: var(--brand-purple);
          padding: 2px 4px;
          cursor: pointer;
        }

        .fullcalendar-wrapper .fc-daygrid-more-link:hover {
          background: var(--accent);
          border-radius: 0.25rem;
        }

        /* ===== EVENTS GENERAL ===== */
        .fullcalendar-wrapper .fc-event {
          cursor: pointer;
          transition: opacity 0.15s, transform 0.15s;
        }

        .fullcalendar-wrapper .fc-event:hover {
          opacity: 0.85;
          transform: scale(1.02);
          z-index: 5;
        }

        .fullcalendar-wrapper .fc-event:active {
          cursor: grabbing;
        }

        .fullcalendar-wrapper .fc-event-not-draggable {
          cursor: pointer !important;
        }

        .fullcalendar-wrapper .fc-event-not-draggable:active {
          cursor: pointer !important;
        }

        .fullcalendar-wrapper .fc-event-pending-delete {
          background-image: repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 4px,
            rgba(161, 98, 7, 0.3) 4px,
            rgba(161, 98, 7, 0.3) 8px
          ) !important;
        }

        .fullcalendar-wrapper .fc-event-open {
          animation: fc-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        /* Default event text is white (for green approved events) */
        .fullcalendar-wrapper .fc-event-custom {
          color: #fff;
        }

        /* Orphan events use red text */
        .fullcalendar-wrapper .fc-event-orphan {
          color: rgb(185 28 28); /* red-700 */
        }

        .dark .fullcalendar-wrapper .fc-event-orphan {
          color: rgb(252 165 165); /* red-300 */
        }

        /* Pending/delete events use yellow text */
        .fullcalendar-wrapper .fc-event-pending-delete {
          color: rgb(113 63 18); /* yellow-900 */
        }

        .dark .fullcalendar-wrapper .fc-event-pending-delete {
          color: rgb(254 240 138); /* yellow-200 */
        }

        /* Job events */
        .fullcalendar-wrapper .fc-event-job {
          background-color: rgb(123 44 191 / 0.12) !important;
          border: 1px solid rgb(123 44 191 / 0.35) !important;
          border-left: 3px solid rgb(123 44 191 / 0.7) !important;
          color: var(--foreground) !important;
        }

        .fullcalendar-wrapper .fc-event-job:hover {
          background-color: rgb(123 44 191 / 0.2) !important;
        }

        .fullcalendar-wrapper .fc-daygrid-event.fc-event-job {
          background-color: rgb(123 44 191 / 0.12) !important;
          border: 1px solid rgb(123 44 191 / 0.35) !important;
          border-left: 3px solid rgb(123 44 191 / 0.7) !important;
        }

        .fullcalendar-wrapper .fc-timegrid-event.fc-event-job {
          background-color: rgb(123 44 191 / 0.12) !important;
          border: 1px solid rgb(123 44 191 / 0.35) !important;
          border-left: 3px solid rgb(123 44 191 / 0.7) !important;
        }

        @keyframes fc-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }

        /* ===== SCROLLBAR ===== */
        .fullcalendar-wrapper .fc-scroller {
          scrollbar-width: thin;
          scrollbar-color: var(--border) transparent;
        }

        .fullcalendar-wrapper .fc-scroller::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        .fullcalendar-wrapper .fc-scroller::-webkit-scrollbar-track {
          background: transparent;
        }

        .fullcalendar-wrapper .fc-scroller::-webkit-scrollbar-thumb {
          background-color: var(--border);
          border-radius: 4px;
        }

        .fullcalendar-wrapper .fc-scroller::-webkit-scrollbar-thumb:hover {
          background-color: color-mix(
            in srgb,
            var(--muted-foreground),
            transparent 50%
          );
        }

        /* ===== DARK MODE ===== */
        .dark .fullcalendar-wrapper .fc {
          background: transparent;
        }

        .dark .fullcalendar-wrapper .fc-daygrid-day {
          background: var(--card);
        }

        /* Only highlight day cell when hovering on empty space (dark mode) */
        .dark
          .fullcalendar-wrapper
          .fc-daygrid-day:hover:not(
            :has(.fc-event:hover, .fc-daygrid-more-link:hover)
          ) {
          background: rgba(111, 95, 148, 0.08) !important;
        }

        .dark .fullcalendar-wrapper .fc-daygrid-day.fc-day-other {
          background: color-mix(
            in srgb,
            var(--muted),
            transparent 90%
          ) !important;
        }

        /* Only highlight other month day cell when hovering on empty space (dark mode) */
        .dark
          .fullcalendar-wrapper
          .fc-daygrid-day.fc-day-other:hover:not(
            :has(.fc-event:hover, .fc-daygrid-more-link:hover)
          ) {
          background: color-mix(
            in srgb,
            var(--muted),
            transparent 80%
          ) !important;
        }
      `}</style>

      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={VIEW_MAP[view]}
        initialDate={date}
        events={allEvents}
        eventDisplay="block"
        eventClick={handleEventClick}
        eventContent={renderEventContent}
        eventDrop={handleEventDrop}
        eventDragStart={handleEventDragStart}
        eventDragStop={handleEventDragStop}
        droppable={true}
        eventReceive={handleEventReceive}
        dateClick={(arg) => {
          // In day view, clicking the column/header should do nothing (no navigation)
          // Only week/month views should navigate to day view
          if (view === 'day') return;
          onDateSelect(arg.date);
          onViewChange('day');
        }}
        moreLinkClick={(arg) => {
          onDateSelect(arg.date);
          onViewChange('day');
          return 'day'; // Prevent default behavior
        }}
        locale="de"
        firstDay={1} // Monday
        headerToolbar={false} // We use our own header
        height="100%"
        allDaySlot={jobs.length > 0}
        slotEventOverlap={false}
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        scrollTime="06:00:00"
        slotDuration="00:30:00"
        slotLabelInterval="01:00:00"
        slotLabelFormat={{
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          meridiem: false
        }}
        eventTimeFormat={{
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          meridiem: false
        }}
        dayHeaderFormat={
          // In month view, only show weekday name (no dates)
          // In day/week views, show weekday + date
          view === 'month'
            ? { weekday: 'short' }
            : { weekday: 'short', day: 'numeric', month: 'numeric' }
        }
        nowIndicator={true}
        selectable={false}
        editable={false}
        dragRevertDuration={0}
        dayMaxEvents={2} // Show at most 2 entries before "+ mehr"
        moreLinkContent={(arg) => (
          <>
            <span className="sm:hidden">+{arg.num}</span>
            <span className="hidden sm:inline">+{arg.num} mehr</span>
          </>
        )}
      />

      {selectedJob && (
        <JobEventPopover
          job={selectedJobDisplay ?? selectedJob.job}
          position={selectedJob.position}
          onClose={() => setSelectedJob(null)}
          memberNames={memberNameMap}
        />
      )}
    </div>
  );
}

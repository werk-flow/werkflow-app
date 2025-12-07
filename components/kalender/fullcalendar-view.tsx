'use client';

import { useMemo, useRef, useEffect } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventClickArg, EventContentArg } from '@fullcalendar/core';
import { Clock } from 'lucide-react';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import type { TimeEntry, WorkSession } from '@/lib/time-tracking/types';
import type { CalendarView } from './calendar-container';

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
  currentUserId: string;
  isAdminOrManager: boolean;
  onEventClick: (session: WorkSession) => void;
  onDateSelect: (date: Date) => void;
  onViewChange: (view: CalendarView) => void;
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
  currentUserId,
  isAdminOrManager,
  onEventClick,
  onDateSelect,
  onViewChange
}: FullCalendarViewProps) {
  const calendarRef = useRef<FullCalendar>(null);

  // Helper to get member name
  const getMemberName = (userId: string) => {
    const member = members.find((m) => m.user_id === userId);
    if (!member) return 'Arbeitszeit';
    return member.first_name || member.email.split('@')[0] || 'Arbeitszeit';
  };

  // Convert work sessions to FullCalendar events
  const events = useMemo(() => {
    // Filter entries for the current user (for employees) or all (for admin in month view)
    const relevantEntries = isAdminOrManager
      ? entries
      : entries.filter((e) => e.userId === currentUserId);

    const sessions = calculateWorkSessions(relevantEntries);

    return sessions.map((session, index) => {
      // Handle orphan clock_out (no clockIn)
      if (session.isOrphan && !session.clockIn && session.clockOut) {
        const orphanTime = new Date(session.clockOut.timestamp);
        const orphanEnd = new Date(orphanTime.getTime() + 15 * 60 * 1000); // 15 min duration for display
        const isPending = session.clockOut.status === 'pending';

        return {
          id: `orphan-out-${session.clockOut.id}-${index}`,
          title: '',
          start: orphanTime,
          end: orphanEnd,
          backgroundColor: isPending
            ? 'rgb(234 179 8 / 0.15)'
            : 'rgb(239 68 68 / 0.15)', // red-ish for orphan
          borderColor: isPending
            ? 'rgba(202, 138, 4, 0.5)'
            : 'rgba(220, 38, 38, 0.4)',
          textColor: 'inherit',
          extendedProps: {
            session,
            isPending,
            isOpen: false,
            isOrphan: true,
            isOrphanClockIn: false,
            durationText: 'Ausstempeln',
            memberName: getMemberName(session.clockOut.userId)
          },
          classNames: [
            'fc-event-custom',
            'fc-event-orphan',
            isPending ? 'fc-event-pending' : ''
          ].filter(Boolean)
        };
      }

      // Handle orphan clock_in (from previous day, no clockOut)
      if (session.isOrphan && session.clockIn && !session.clockOut) {
        const orphanTime = new Date(session.clockIn.timestamp);
        const orphanEnd = new Date(orphanTime.getTime() + 15 * 60 * 1000); // 15 min duration for display
        const isPending = session.clockIn.status === 'pending';

        return {
          id: `orphan-in-${session.clockIn.id}-${index}`,
          title: '',
          start: orphanTime,
          end: orphanEnd,
          backgroundColor: isPending
            ? 'rgb(234 179 8 / 0.15)'
            : 'rgb(239 68 68 / 0.15)', // red-ish for orphan
          borderColor: isPending
            ? 'rgba(202, 138, 4, 0.5)'
            : 'rgba(220, 38, 38, 0.4)',
          textColor: 'inherit',
          extendedProps: {
            session,
            isPending,
            isOpen: false,
            isOrphan: true,
            isOrphanClockIn: true,
            durationText: 'Einstempeln',
            memberName: getMemberName(session.clockIn.userId)
          },
          classNames: [
            'fc-event-custom',
            'fc-event-orphan',
            isPending ? 'fc-event-pending' : ''
          ].filter(Boolean)
        };
      }

      // Normal session with clockIn (paired or open/currently working)
      const start = new Date(session.clockIn!.timestamp);
      const end = session.clockOut
        ? new Date(session.clockOut.timestamp)
        : new Date(); // Open session extends to now

      const isPending =
        session.clockIn!.status === 'pending' ||
        (session.clockOut?.status === 'pending' ?? false);
      const isOpen = !session.clockOut && !session.isOrphan;

      // Calculate duration text
      const durationMs = end.getTime() - start.getTime();
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      const durationText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

      return {
        id: `${session.clockIn!.id}-${index}`,
        title: '', // Custom content will be used
        start,
        end,
        backgroundColor: isPending
          ? 'rgb(234 179 8 / 0.1)' // yellow bg
          : isOpen
          ? 'rgb(34 197 94 / 0.1)' // green bg
          : 'rgb(34 197 94 / 0.1)', // green bg
        borderColor: isPending
          ? 'rgba(202, 138, 4, 0.4)'
          : 'rgba(22, 163, 74, 0.35)',
        textColor: 'inherit',
        extendedProps: {
          session,
          isPending,
          isOpen,
          isOrphan: false,
          isOrphanClockIn: false,
          durationText,
          memberName: getMemberName(session.clockIn!.userId)
        },
        classNames: [
          'fc-event-custom',
          isPending ? 'fc-event-pending' : '',
          isOpen ? 'fc-event-open' : ''
        ].filter(Boolean)
      };
    });
  }, [entries, currentUserId, isAdminOrManager, members]);

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

  const handleEventClick = (info: EventClickArg) => {
    const session = info.event.extendedProps.session as WorkSession;
    if (session) {
      onEventClick(session);
    }
  };

  const renderEventContent = (eventInfo: EventContentArg) => {
    const {
      isPending,
      isOpen,
      isOrphan,
      isOrphanClockIn,
      durationText,
      memberName
    } = eventInfo.event.extendedProps;

    // Orphan entries show differently
    if (isOrphan) {
      const orphanLabel = isOrphanClockIn ? 'Einstempeln' : 'Ausstempeln';
      const orphanIcon = isOrphanClockIn ? '⬆' : '⬇';
      return (
        <div className="flex items-center gap-1.5 pl-1 pr-0.5 py-0.5 overflow-hidden w-full text-red-600 dark:text-red-400">
          <Clock className="h-3 w-3 shrink-0 opacity-70" />
          <span className="font-medium truncate text-[10px]">
            {orphanIcon} {isAdminOrManager ? memberName : orphanLabel}
          </span>
        </div>
      );
    }

    const label = isAdminOrManager ? memberName : 'Arbeitszeit';
    const activityText = isOpen
      ? isAdminOrManager
        ? 'arbeitet'
        : 'Du arbeitest'
      : durationText;

    return (
      <div className="flex items-center gap-1.5 pl-1 pr-0.5 py-0.5 overflow-hidden w-full">
        <Clock className="h-3 w-3 shrink-0 opacity-70" />
        <span className="font-medium truncate">{label}</span>
        <span className="opacity-70 truncate text-[10px]">{activityText}</span>
      </div>
    );
  };

  return (
    <div className="fullcalendar-wrapper p-4">
      <style jsx global>{`
        /* ===== BASE VARIABLES ===== */
        .fullcalendar-wrapper {
          border-radius: 1rem;
          background: var(--card);
          border: 1px solid color-mix(in srgb, var(--border), transparent 20%);
          box-shadow: 0 18px 40px rgb(15 23 42 / 0.18);
          --fc-border-color: var(--border);
          --fc-today-bg-color: color-mix(
            in srgb,
            var(--brand-purple),
            transparent 92%
          );
          --fc-page-bg-color: var(--background);
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
          border-radius: 0.75rem;
          border: none;
          overflow: hidden;
        }

        /* ===== RESET DEFAULT TABLE SPACING ===== */
        .fullcalendar-wrapper .fc table {
          border-collapse: separate;
          border-spacing: 0;
        }

        /* ===== HIDE DEFAULT TOOLBAR ===== */
        .fullcalendar-wrapper .fc-toolbar {
          display: none !important;
        }

        /* ===== HEADER STYLING ===== */
        .fullcalendar-wrapper .fc-col-header {
          background: color-mix(in srgb, var(--muted), transparent 50%);
        }

        .fullcalendar-wrapper .fc-col-header-cell {
          padding: 0.75rem 0.5rem;
          font-weight: 600;
          font-size: 0.875rem;
          border-bottom: 1px solid var(--border);
        }

        .fullcalendar-wrapper .fc-col-header-cell-cushion {
          color: var(--foreground);
          text-decoration: none;
        }

        /* ===== TIME GRID (Day & Week Views) ===== */
        .fullcalendar-wrapper .fc-timegrid {
          background: var(--card);
        }

        .fullcalendar-wrapper .fc-timegrid-slot {
          height: 2.75rem;
          border-top: 1px solid
            color-mix(in srgb, var(--border), transparent 70%) !important;
          border-bottom: none !important;
          background-color: color-mix(in srgb, var(--muted), transparent 97%);
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
        }

        .fullcalendar-wrapper .fc-timegrid-axis {
          border-color: var(--border);
          background: color-mix(in srgb, var(--muted), transparent 70%);
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
          border: 1px solid color-mix(in srgb, var(--border), transparent 30%);
          box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
        }

        /* ===== DAY GRID (Month View) ===== */
        .fullcalendar-wrapper .fc-daygrid {
          background: var(--card);
        }

        .fullcalendar-wrapper .fc-daygrid-body {
          border-top: 1px solid var(--border);
        }

        .fullcalendar-wrapper .fc-daygrid-day {
          border: 1px solid color-mix(in srgb, var(--border), transparent 40%) !important;
        }

        /* Fixed height for day cells */
        .fullcalendar-wrapper .fc-daygrid-day-frame {
          height: 120px; /* Fixed height */
          padding: 0.25rem;
          box-shadow: inset 0 0 0 1px
            color-mix(in srgb, var(--border), transparent 85%);
          background-color: color-mix(in srgb, var(--muted), transparent 95%);
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

        .fullcalendar-wrapper .fc-daygrid-day.fc-day-today {
          background: color-mix(in srgb, var(--brand-purple), transparent 90%);
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

        .fullcalendar-wrapper .fc-daygrid-day.fc-day-other {
          background: color-mix(
            in srgb,
            var(--muted),
            transparent 88%
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
          padding: 0 0.4rem;
          border-radius: 0.25rem;
          font-size: 0.7rem;
          border: 1px solid color-mix(in srgb, var(--border), transparent 60%);
          background: color-mix(in srgb, var(--card), transparent 10%);
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
          opacity: 0.9;
          transform: scale(1.01);
          z-index: 5;
        }

        .fullcalendar-wrapper .fc-event-pending {
          border-style: dashed !important;
        }

        .fullcalendar-wrapper .fc-event-open {
          animation: fc-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        .fullcalendar-wrapper .fc-event-custom {
          color: var(--foreground);
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
          background: var(--card);
        }

        .dark .fullcalendar-wrapper .fc-daygrid-day.fc-day-other {
          background: color-mix(in srgb, var(--muted), transparent 85%);
        }
      `}</style>

      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={VIEW_MAP[view]}
        initialDate={date}
        events={events}
        eventClick={handleEventClick}
        eventContent={renderEventContent}
        dateClick={(arg) => {
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
        height="auto"
        allDaySlot={false}
        slotMinTime="06:00:00"
        slotMaxTime="22:00:00"
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
        dayHeaderFormat={{
          weekday: 'short',
          day: 'numeric',
          month: 'numeric'
        }}
        nowIndicator={true}
        selectable={false}
        editable={false}
        dayMaxEvents={2} // Show at most 2 entries before "+ mehr"
        moreLinkContent={(arg) => `+${arg.num} mehr`}
      />
    </div>
  );
}

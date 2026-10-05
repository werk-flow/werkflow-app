'use client';

import { useCallback, useMemo, useState } from 'react';
import type { CalendarJob } from '@/lib/jobs/types';
import type { OrgRole } from '@/lib/members/actions';
import type { InteractiveCalendarSession, WorkSession } from '@/lib/time-tracking/types';
import type { CalendarSurfaceActions } from './board/types';
import type { OpenCard } from './job-event-popover';
import { memberDisplayName, type CalendarMember } from './members';

export type CalendarAddEntry = {
  date: string;
  time?: string | undefined;
  endTime?: string | undefined;
  userId?: string | undefined;
};

/** Which panel, popover or dialog of the calendar is open, and for what. */
export function useCalendarOverlays() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<InteractiveCalendarSession | null>(null);
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const [addEntry, setAddEntry] = useState<CalendarAddEntry | null>(null);
  const [parkplatzOpen, setParkplatzOpen] = useState(false);
  const [dispatchPanelOpen, setDispatchPanelOpen] = useState(false);
  const [parkedDispatchJob, setParkedDispatchJob] = useState<CalendarJob | null>(null);
  return {
    helpOpen,
    setHelpOpen,
    selectedSession,
    setSelectedSession,
    openCard,
    setOpenCard,
    addEntry,
    setAddEntry,
    parkplatzOpen,
    setParkplatzOpen,
    dispatchPanelOpen,
    setDispatchPanelOpen,
    parkedDispatchJob,
    setParkedDispatchJob,
  };
}

export type CalendarOverlays = ReturnType<typeof useCalendarOverlays>;

/** What a gesture on a calendar surface opens: the card popover, the entry dialog, the park flow or the session details. */
export function useCalendarSurfaceActions({
  overlays,
  isAdminOrManager,
  onPark,
  members,
}: {
  overlays: CalendarOverlays;
  isAdminOrManager: boolean;
  onPark: CalendarSurfaceActions['onPark'];
  members: CalendarMember[];
}): { surfaceActions: CalendarSurfaceActions; handleSessionClick: (session: WorkSession) => void } {
  const { setOpenCard, setAddEntry, setSelectedSession } = overlays;
  const surfaceActions = useMemo<CalendarSurfaceActions>(
    () => ({
      isManager: isAdminOrManager,
      onOpenCard: (job, element, row) => setOpenCard({ job, anchor: element, row }),
      onAddEntry: (input) => setAddEntry(input),
      onPark,
    }),
    [onPark, isAdminOrManager, setOpenCard, setAddEntry],
  );

  const handleSessionClick = useCallback(
    (session: WorkSession) => {
      const sessionUserId = session.clockIn?.userId || session.clockOut?.userId;
      const sessionMember = members.find((member) => member.user_id === sessionUserId);
      setSelectedSession({
        ...(session as InteractiveCalendarSession),
        employeeName: sessionMember ? memberDisplayName(sessionMember) : null,
        ...(sessionMember ? { employeeRole: sessionMember.role as OrgRole } : {}),
      });
    },
    [members, setSelectedSession],
  );
  return { surfaceActions, handleSessionClick };
}

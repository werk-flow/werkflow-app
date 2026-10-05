'use client';

import { useCallback, useMemo, useReducer, useState } from 'react';
import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';
import { calendarAnchorDate, getCalendarFetchRange, shiftCalendarDate } from '@/lib/calendar/navigation';
import type { CalendarPreferences } from '@/lib/calendar/preferences';
import type { CalendarView } from './calendar-container';
import { useCalendarPreferences } from './use-calendar-preferences';

/**
 * What the calendar shows: the saved preferences, the view (itself a
 * preference), the anchor date and the read window that follows them (PF-01),
 * the navigation handlers, the day zoom and the working-hours toggle. Opening
 * a day from the month highlights the member row it came from. "Heute" and
 * the fallback anchor use the container's one `todayIso`, never the clock.
 */
export function useCalendarViewState({
  organizationId,
  initialPreferences,
  initialView,
  initialDate,
  todayIso,
}: {
  organizationId: string;
  initialPreferences: CalendarPreferences;
  initialView: CalendarView;
  initialDate: string | undefined;
  /** The calendar's one "today" (`YYYY-MM-DD`), read once by the container. */
  todayIso: string;
}) {
  const { preferences, updatePreferences } = useCalendarPreferences(organizationId, initialPreferences);
  // A calendar left open overnight renders its container once at the date
  // change, so the container's `todayIso` read moves to the new day.
  const [, renderNewBusinessDay] = useReducer((day: number) => day + 1, 0);
  useBusinessDayRefresh(renderNewBusinessDay);
  const [currentDate, setCurrentDate] = useState(() => calendarAnchorDate(initialDate ?? todayIso));
  const [view, setViewState] = useState<CalendarView>(initialView);
  const setView = useCallback(
    (next: CalendarView) => {
      setViewState(next);
      updatePreferences({ view: next });
    },
    [updatePreferences],
  );
  const [showWorkingHours, setShowWorkingHours] = useState(false);
  const [dayZoom, setDayZoom] = useState(1);
  const [highlightMemberId, setHighlightMemberId] = useState<string | null>(null);

  // The read window follows the selected date, view and horizon (PF-01).
  const needed = useMemo(
    () => getCalendarFetchRange(currentDate, view, preferences.horizonWeeks),
    [currentDate, view, preferences.horizonWeeks],
  );

  const handlePrevious = useCallback(
    () => setCurrentDate((previous) => shiftCalendarDate(previous, view, -1, preferences.horizonWeeks)),
    [view, preferences.horizonWeeks],
  );
  const handleNext = useCallback(
    () => setCurrentDate((previous) => shiftCalendarDate(previous, view, 1, preferences.horizonWeeks)),
    [view, preferences.horizonWeeks],
  );
  const handleToday = useCallback(() => setCurrentDate(calendarAnchorDate(todayIso)), [todayIso]);
  const handleOpenDay = useCallback(
    (date: Date, memberId: string | null) => {
      setCurrentDate(date);
      setHighlightMemberId(memberId);
      setView('day');
    },
    [setView],
  );

  return {
    preferences,
    updatePreferences,
    currentDate,
    view,
    setView,
    needed,
    showWorkingHours,
    setShowWorkingHours,
    dayZoom,
    setDayZoom,
    highlightMemberId,
    setHighlightMemberId,
    handlePrevious,
    handleNext,
    handleToday,
    handleOpenDay,
  };
}

export type CalendarViewState = ReturnType<typeof useCalendarViewState>;

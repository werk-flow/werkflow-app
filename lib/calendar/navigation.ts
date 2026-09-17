export type CalendarNavigationView = "day" | "week" | "month";

/**
 * Inclusive local-time instants the calendar reads for one selected date and
 * view. `start` is the first millisecond, `end` the last millisecond of the
 * fetched window, so `end.getTime()` compares inclusively with row timestamps.
 */
export type CalendarFetchRange = { start: Date; end: Date };

export function shiftCalendarDate(
  currentDate: Date,
  view: CalendarNavigationView,
  direction: -1 | 1,
): Date {
  const shiftedDate = new Date(currentDate);

  if (view === "day") {
    shiftedDate.setDate(shiftedDate.getDate() + direction);
    return shiftedDate;
  }

  if (view === "week") {
    shiftedDate.setDate(shiftedDate.getDate() + direction * 7);
    return shiftedDate;
  }

  // Move from a stable day so the 29th to 31st cannot overflow a shorter
  // target month and silently skip it.
  shiftedDate.setDate(1);
  shiftedDate.setMonth(shiftedDate.getMonth() + direction);
  return shiftedDate;
}

function startOfLocalDay(date: Date, dayOffset: number): Date {
  const result = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + dayOffset,
  );
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfLocalDay(date: Date, dayOffset: number): Date {
  const result = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + dayOffset,
  );
  result.setHours(23, 59, 59, 999);
  return result;
}

function mondayOfWeek(date: Date): Date {
  const daysSinceMonday = (date.getDay() + 6) % 7;
  return startOfLocalDay(date, -daysSinceMonday);
}

/**
 * The read window for one view. The week and month fetch one extra day on
 * each side of their visible dates; the day view fetches only the previous
 * day (the same window as before the rewrite). Overnight sessions are keyed
 * by their start, so a session that begins on the visible day is inside the
 * window and one that began the day before still pairs.
 * Day and week offsets go through the Date constructor, never through
 * `setDate(start.getDate() + n)` on a second date object: that arithmetic
 * used the wrong month whenever the window started in the previous month
 * (PF-01).
 */
export function getCalendarFetchRange(
  currentDate: Date,
  view: CalendarNavigationView,
): CalendarFetchRange {
  if (view === "day") {
    return {
      start: startOfLocalDay(currentDate, -1),
      end: endOfLocalDay(currentDate, 0),
    };
  }
  if (view === "week") {
    const monday = mondayOfWeek(currentDate);
    return {
      start: startOfLocalDay(monday, -1),
      end: endOfLocalDay(monday, 7),
    };
  }
  return getCalendarMonthFetchRange(currentDate);
}

export function getCalendarMonthFetchRange(currentDate: Date): CalendarFetchRange {
  const firstOfMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1,
  );
  const firstVisibleMonday = mondayOfWeek(firstOfMonth);

  // FullCalendar renders six complete weeks. Fetch one extra day on either
  // side so overnight sessions crossing the visible boundary still pair.
  return {
    start: startOfLocalDay(firstVisibleMonday, -1),
    end: endOfLocalDay(firstVisibleMonday, 42),
  };
}

/** True when `coverage` contains every instant of `needed`. */
export function rangeCovers(
  coverage: CalendarFetchRange,
  needed: CalendarFetchRange,
): boolean {
  return (
    coverage.start.getTime() <= needed.start.getTime() &&
    coverage.end.getTime() >= needed.end.getTime()
  );
}

export function rangesEqual(
  left: CalendarFetchRange,
  right: CalendarFetchRange,
): boolean {
  return (
    left.start.getTime() === right.start.getTime() &&
    left.end.getTime() === right.end.getTime()
  );
}

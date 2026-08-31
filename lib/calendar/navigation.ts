export type CalendarNavigationView = "day" | "week" | "month";

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

  // Move from a stable day so the 29th–31st cannot overflow a shorter target
  // month and silently skip it.
  shiftedDate.setDate(1);
  shiftedDate.setMonth(shiftedDate.getMonth() + direction);
  return shiftedDate;
}

export function getCalendarMonthFetchRange(currentDate: Date): {
  start: Date;
  end: Date;
} {
  const firstOfMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1,
  );
  const daysSinceMonday = (firstOfMonth.getDay() + 6) % 7;
  const firstVisibleMonday = new Date(firstOfMonth);
  firstVisibleMonday.setDate(firstVisibleMonday.getDate() - daysSinceMonday);

  // FullCalendar renders six complete weeks. Fetch one extra day on either
  // side so overnight sessions crossing the visible boundary still pair.
  const start = new Date(firstVisibleMonday);
  start.setDate(start.getDate() - 1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(firstVisibleMonday);
  end.setDate(end.getDate() + 42);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

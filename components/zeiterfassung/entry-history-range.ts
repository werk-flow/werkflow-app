// The Verlauf's date range: the chosen dates and the window they span.
import { useState } from 'react';
import { addLocalDays, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { parseIsoLocalDate } from '@/lib/utils';

/** The window of the chosen dates: from the first day's start to the last day's end. */
export function historyRange(dateFrom: Date, dateTo: Date): { from: string; to: string } {
  const fromDate = new Date(dateFrom);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = new Date(dateTo);
  toDate.setHours(23, 59, 59, 999);
  return { from: fromDate.toISOString(), to: toDate.toISOString() };
}

/**
 * The chosen dates. The default range starts from the Berlin business date,
 * which the server render and the browser agree on; the runtime's local date
 * would differ around midnight and the date fields would not hydrate.
 */
export function useHistoryDates() {
  const [dateFrom, setDateFrom] = useState<Date | undefined>(() =>
    parseIsoLocalDate(addLocalDays(getBusinessTodayIso(), -30)),
  );
  const [dateTo, setDateTo] = useState<Date | undefined>(() =>
    parseIsoLocalDate(addLocalDays(getBusinessTodayIso(), 14)),
  );
  return { dateFrom, setDateFrom, dateTo, setDateTo };
}

// Berlin-local date and schedule formatting of the dispatch panel.

import type { DispatchOverviewOccurrence } from '@/lib/dispatch/types';
import { getBusinessTodayIso, toBusinessIsoDate } from '@/lib/personnel/types';
import { formatBerlinTime } from '@/lib/utils';

// Also formats the batch preview's old/new instants — keep the two surfaces
// visually identical so the preview reads like the panel rows it moves.
export function formatOccurrenceSchedule(entry: {
  startAt: string | null;
  startDate: string | null;
}): string {
  if (entry.startAt) {
    const start = new Date(entry.startAt);
    const dateText = start.toLocaleDateString('de-DE', {
      timeZone: 'Europe/Berlin',
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });
    const timeText = formatBerlinTime(start);
    return `${dateText}, ${timeText} Uhr`;
  }
  if (entry.startDate) {
    const [, month, day] = entry.startDate.split('-');
    return `${day}.${month}. (ganztägig)`;
  }
  return 'Ohne Termin';
}

export function berlinLocalDateOf(entry: DispatchOverviewOccurrence): string {
  if (entry.startAt) return toBusinessIsoDate(new Date(entry.startAt));
  return entry.startDate ?? getBusinessTodayIso();
}

import type { getTimeEntries, getChangeRequestsForEntries } from '@/lib/time-tracking/actions';
import type { TimeEntry, EntryChangeRequestMap } from '@/lib/time-tracking/types';
import { changeRequestEntryIds, toEntryChangeRequestMap } from '@/lib/time-tracking/change-request-map';

type CalendarEntryRead = { success: true; entries: TimeEntry[]; changeRequestMap: EntryChangeRequestMap } | { success: false; error: string };

/** A window is usable only when its entries and correction badges agree. */
export async function completeCalendarEntryRead(
  entriesPromise: ReturnType<typeof getTimeEntries>,
  readMetadata: typeof getChangeRequestsForEntries,
): Promise<CalendarEntryRead> {
  const entries = await entriesPromise;
  if (!entries.success) return entries;
  const ids = changeRequestEntryIds(entries.entries);
  const metadata = ids.length > 0 ? await readMetadata(ids) : { success: true as const, requests: [] };
  if (!metadata.success) return metadata;
  return { success: true, entries: [...entries.entries, ...(entries.provisionalEntries ?? [])], changeRequestMap: toEntryChangeRequestMap(metadata.requests) };
}

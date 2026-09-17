import type { ChangeRequest, EntryChangeRequestMap, TimeEntry } from './types';

/**
 * Pending change requests keyed by the entries they touch, shared by the
 * server-rendered calendar window and the client range owner so the first
 * paint carries the same correction badges as every later read.
 */
export function changeRequestEntryIds(entries: readonly TimeEntry[]): string[] {
  return entries
    .filter((entry) => !entry.canonicalSegmentId)
    .map((entry) => entry.id);
}

export function toEntryChangeRequestMap(
  requests: readonly ChangeRequest[]
): EntryChangeRequestMap {
  const map: EntryChangeRequestMap = {};
  for (const request of requests) {
    map[request.entryId] = request;
    if (request.pairedEntryId) map[request.pairedEntryId] = request;
  }
  return map;
}

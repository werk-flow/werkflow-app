import { compareTimeEntries } from '@/lib/time-tracking/entry-order';
import type { TimeEntry } from '@/lib/time-tracking/types';
import type { TimeActivityInterval } from './types';

/** Rebuild effective intervals, including the context preserved by audited corrections. */
export function buildLegacyIntervals(entries: TimeEntry[], employeeRecordId: string): TimeActivityInterval[] {
  const intervals: TimeActivityInterval[] = [];
  let active: Omit<TimeActivityInterval, 'endedAt'> | null = null;
  for (const entry of [...entries].sort(compareTimeEntries)) {
    if (entry.status !== 'approved') continue;
    if (active && entry.timestamp > active.startedAt) intervals.push({ ...active, endedAt: entry.timestamp });
    if (entry.entryType === 'clock_out') {
      active = null;
      continue;
    }
    const activity = entry.activitySelection;
    active = {
      sourceId: entry.id.startsWith('correction:') ? entry.id : `legacy:${employeeRecordId}:${entry.id}`,
      startedAt: entry.timestamp,
      activityKind: entry.entryType === 'break_start' ? 'break' : (entry.activityKind ?? 'work'),
      allocationKind: activity?.allocationKind ?? (entry.jobId ? 'job' : 'unallocated'),
      jobId: entry.jobId ?? undefined,
      ...(activity?.kind === 'travel'
        ? { travelRoute: activity.travelRoute, travelRole: activity.travelRole }
        : {}),
      ...(activity?.kind === 'standby' ? { standbyContext: activity.standbyContext } : {}),
    };
  }
  return intervals;
}

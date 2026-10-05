import type { TimeEntry } from '@/lib/time-tracking/types';
import type { CalendarCorrectionBoundary } from './validation';

export type CalendarTimeCorrectionDraft = {
  sourceEntries: TimeEntry[];
  updates: Array<{ entryId: string; newTimestamp: string; newUserId?: string }>;
};

export function calendarCorrectionBoundaries(
  draft: CalendarTimeCorrectionDraft,
  people: readonly { userId: string; employeeRecordId: string }[],
): CalendarCorrectionBoundary[] | null {
  const boundaries: CalendarCorrectionBoundary[] = [];
  for (const entry of draft.sourceEntries) {
    if (entry.status !== 'approved' || entry.pendingCorrectionRequestId || entry.isProvisionalCorrection)
      return null;
    const update = draft.updates.find((candidate) => candidate.entryId === entry.id);
    const person = people.find((candidate) => candidate.userId === (update?.newUserId ?? entry.userId));
    const kind = entry.correctionApplicationId ? 'correction_application' : entry.sourceKind;
    const id = entry.correctionApplicationId ?? entry.canonicalSegmentId ?? entry.id;
    const version = entry.correctionSourceFingerprint ?? entry.sourceVersion;
    if (!person || !kind || !version) return null;
    boundaries.push({
      source: { kind, id, version },
      entryType: entry.entryType,
      originalTimestamp: entry.timestamp,
      timestamp: update?.newTimestamp ?? entry.timestamp,
      employeeRecordId: person.employeeRecordId,
    });
  }
  return boundaries;
}

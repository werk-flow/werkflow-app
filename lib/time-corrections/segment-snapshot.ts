import {
  projectTimeSegmentsToLegacyTransitions,
  toTimeActivitySelection,
  type TimeSegmentFact,
} from '@/lib/time-tracking/segments';
import type { TimeCorrectionSnapshot } from './types';

/** Keep the same boundary ownership as the visible timeline, including adjacent breaks. */
export function createSegmentCorrectionSnapshot(
  segment: TimeSegmentFact,
  session: readonly TimeSegmentFact[],
  userId: string,
  referenceTime = new Date(),
): TimeCorrectionSnapshot {
  const from = new Date(Math.min(...session.map((entry) => Date.parse(entry.startedAt))));
  const to = new Date(
    Math.max(
      ...session.map((entry) => (entry.endedAt ? Date.parse(entry.endedAt) : referenceTime.getTime())),
    ),
  );
  const points = projectTimeSegmentsToLegacyTransitions([...session], from, to, referenceTime);
  return {
    schemaVersion: 1,
    facts: points
      .filter((point) => point.segmentId === segment.id)
      .map((point, index) => ({
        factId: `${segment.id}:${index}`,
        employeeRecordId: segment.employeeRecordId,
        userId,
        entryType: point.entryType,
        timestamp: point.timestamp,
        jobId: segment.jobId ?? null,
        activityKind: segment.kind,
        activity: toTimeActivitySelection(segment),
        isManual: false,
      })),
  };
}

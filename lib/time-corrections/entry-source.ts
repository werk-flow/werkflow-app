import type { TimeEntry } from '@/lib/time-tracking/types';

// The source a correction changes: the canonical segment, the applied
// correction, or the entry itself.
export function correctionSource(
  entry: TimeEntry | undefined,
): { kind: NonNullable<TimeEntry['sourceKind']>; id: string } | null {
  if (!entry) return null;
  const kind = entry.correctionApplicationId ? 'correction_application' : entry.sourceKind;
  const id = entry.correctionApplicationId ?? entry.canonicalSegmentId ?? entry.id;
  return kind && id ? { kind, id } : null;
}

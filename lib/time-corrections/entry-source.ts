import type { TimeEntry } from '@/lib/time-tracking/types';
import { correctionFactIdOf } from './types';

type EntrySource = { kind: NonNullable<TimeEntry['sourceKind']>; id: string };

// The source a correction changes: the canonical segment, the applied
// correction, or the entry itself.
export function correctionSource(entry: TimeEntry | undefined): EntrySource | null {
  if (!entry) return null;
  const kind = entry.correctionApplicationId ? 'correction_application' : entry.sourceKind;
  const id = entry.correctionApplicationId ?? entry.canonicalSegmentId ?? entry.id;
  return kind && id ? { kind, id } : null;
}

/**
 * The source a correction of one entry changes, and for an approved
 * correction the applied fact whose interval it changes. Null when an entry
 * of an approved correction does not name its fact.
 */
export function entryCorrectionTarget(
  entry: TimeEntry | undefined,
): (EntrySource & { factId?: string }) | null {
  const source = correctionSource(entry);
  if (!entry || source?.kind !== 'correction_application') return source;
  const factId = correctionFactIdOf(entry);
  return factId ? { ...source, factId } : null;
}

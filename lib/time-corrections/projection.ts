import { compareTimeEntries } from '@/lib/time-tracking/entry-order';
import type { TimeEntry } from '@/lib/time-tracking/types';

import { correctionFactToEntry, type TimeCorrectionApplicationProjection } from './types';

function isSuppressed(
  entry: TimeEntry,
  suppressedLegacyIds: ReadonlySet<string>,
  suppressedSegmentIds: ReadonlySet<string>,
  suppressedApplicationIds: ReadonlySet<string>,
): boolean {
  return (
    suppressedLegacyIds.has(entry.id) ||
    (entry.canonicalSegmentId ? suppressedSegmentIds.has(entry.canonicalSegmentId) : false) ||
    (entry.correctionApplicationId ? suppressedApplicationIds.has(entry.correctionApplicationId) : false)
  );
}

export function applyApprovedTimeCorrections(
  entries: readonly TimeEntry[],
  applications: readonly TimeCorrectionApplicationProjection[],
  organizationId: string,
): TimeEntry[] {
  const suppressedLegacyIds = new Set<string>();
  const suppressedSegmentIds = new Set<string>();
  const suppressedApplicationIds = new Set<string>();

  for (const application of applications) {
    for (const source of application.sources) {
      if (source.kind === 'legacy_entry') suppressedLegacyIds.add(source.id);
      if (source.kind === 'canonical_segment') suppressedSegmentIds.add(source.id);
      if (source.kind === 'correction_application') {
        suppressedApplicationIds.add(source.id);
      }
    }
  }

  const correctedEntries = applications.flatMap((application) =>
    suppressedApplicationIds.has(application.applicationId)
      ? []
      : application.snapshot.facts.map((fact) => ({
          ...correctionFactToEntry(fact, application),
          organizationId,
        })),
  );

  return [
    ...entries.filter(
      (entry) => !isSuppressed(entry, suppressedLegacyIds, suppressedSegmentIds, suppressedApplicationIds),
    ),
    ...correctedEntries,
  ].sort(compareTimeEntries);
}

/**
 * The entries with the approved corrections applied, then only those inside
 * the window, its ends included: a corrected fact outside it never pairs with
 * an entry inside.
 */
export function correctedEntriesInWindow(
  entries: readonly TimeEntry[],
  applications: readonly TimeCorrectionApplicationProjection[],
  organizationId: string,
  window: { fromMs: number; toMs: number },
): TimeEntry[] {
  return applyApprovedTimeCorrections(entries, applications, organizationId).filter((entry) => {
    const timestamp = Date.parse(entry.timestamp);
    return timestamp >= window.fromMs && timestamp <= window.toMs;
  });
}

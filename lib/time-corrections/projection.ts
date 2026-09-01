import type { TimeEntry } from '@/lib/time-tracking/types';

import {
  correctionFactToEntry,
  type TimeCorrectionApplicationProjection,
} from './types';

function isSuppressed(
  entry: TimeEntry,
  suppressedLegacyIds: ReadonlySet<string>,
  suppressedSegmentIds: ReadonlySet<string>,
  suppressedApplicationIds: ReadonlySet<string>
): boolean {
  return (
    suppressedLegacyIds.has(entry.id) ||
    (entry.canonicalSegmentId
      ? suppressedSegmentIds.has(entry.canonicalSegmentId)
      : false) ||
    (entry.correctionApplicationId
      ? suppressedApplicationIds.has(entry.correctionApplicationId)
      : false)
  );
}

export function applyApprovedTimeCorrections(
  entries: readonly TimeEntry[],
  applications: readonly TimeCorrectionApplicationProjection[],
  organizationId: string
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
        }))
  );

  return [...entries.filter((entry) => !isSuppressed(
    entry,
    suppressedLegacyIds,
    suppressedSegmentIds,
    suppressedApplicationIds
  )), ...correctedEntries].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id)
  );
}

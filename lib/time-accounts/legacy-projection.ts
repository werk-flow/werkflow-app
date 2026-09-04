import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import { applyApprovedTimeCorrections } from '@/lib/time-corrections/projection';
import type { TimeEntry } from '@/lib/time-tracking/types';

type ProjectLegacyEntriesForWindowInput = {
  entries: readonly TimeEntry[];
  applications: readonly TimeCorrectionApplicationProjection[];
  organizationId: string;
  startInstant: string;
  endInstant: string;
};

/**
 * Applies the complete correction chain, then restores the read window owned
 * by the caller. The second boundary is essential: an out-of-period corrected
 * fact must not pair with an in-period legacy entry.
 */
export function projectLegacyEntriesForWindow({
  entries,
  applications,
  organizationId,
  startInstant,
  endInstant,
}: ProjectLegacyEntriesForWindowInput): TimeEntry[] {
  const startTimestamp = Date.parse(startInstant);
  const endTimestamp = Date.parse(endInstant);
  if (
    !Number.isFinite(startTimestamp) ||
    !Number.isFinite(endTimestamp) ||
    startTimestamp >= endTimestamp
  ) {
    throw new Error('Invalid legacy time-entry projection window.');
  }

  return applyApprovedTimeCorrections(
    entries,
    applications,
    organizationId
  ).filter((entry) => {
    const timestamp = Date.parse(entry.timestamp);
    return timestamp >= startTimestamp && timestamp < endTimestamp;
  });
}

export function hasUnclosedLegacySequence(
  entries: readonly TimeEntry[]
): boolean {
  let active = false;
  for (const entry of [...entries].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
  )) {
    if (entry.status !== 'approved') continue;
    if (['clock_in', 'break_start', 'break_end'].includes(entry.entryType)) {
      active = true;
    }
    if (entry.entryType === 'clock_out') active = false;
  }
  return active;
}

import type { TimeEntry } from '@/lib/time-tracking/types';
import { getLocalDayKey, getLocalDayStart, getLocalDayEnd } from '@/lib/time-tracking/day-utils';
import { validateDayEntrySequence } from '@/lib/time-tracking/validation';
import { applyApprovedTimeCorrections } from './projection';
import type { TimeCorrectionApplicationProjection, TimeCorrectionFact } from './types';

function correctionDayOwner(entry: Pick<TimeEntry, 'timestamp' | 'entryType'>): Date {
  const timestamp = new Date(entry.timestamp);
  const closesAtMidnight =
    ['clock_out', 'break_end'].includes(entry.entryType) &&
    timestamp.getTime() === getLocalDayStart(timestamp).getTime();
  return closesAtMidnight ? new Date(timestamp.getTime() - 1) : timestamp;
}

export function correctionTimelineWindow(
  facts: readonly TimeCorrectionFact[],
): { affectedDays: Set<string>; from: string; to: string; userIds: string[] } | null {
  if (!facts.length) return null;
  const owners = facts.map(correctionDayOwner);
  return {
    affectedDays: new Set(facts.map((fact) => `${fact.userId}:${getLocalDayKey(correctionDayOwner(fact))}`)),
    from: getLocalDayStart(new Date(Math.min(...owners.map((date) => date.getTime())))).toISOString(),
    // The closing boundary belongs to this day even when it lands at the next midnight.
    to: new Date(
      getLocalDayEnd(new Date(Math.max(...owners.map((date) => date.getTime())))).getTime() + 1,
    ).toISOString(),
    userIds: [...new Set(facts.map((fact) => fact.userId))],
  };
}

/** Validate the composed result, including both employees of a reassignment. */
export function validateCorrectionTimeline(input: {
  entries: readonly TimeEntry[];
  applications: readonly TimeCorrectionApplicationProjection[];
  candidates: readonly TimeCorrectionApplicationProjection[];
  organizationId: string;
  affectedDays: ReadonlySet<string>;
}): boolean {
  const entries = applyApprovedTimeCorrections(
    input.entries,
    [...input.applications, ...input.candidates],
    input.organizationId,
  );
  const days = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const dayOwner = correctionDayOwner(entry);
    const key = `${entry.userId}:${getLocalDayKey(dayOwner)}`;
    if (!input.affectedDays.has(key)) continue;
    const day = days.get(key) ?? [];
    day.push(entry);
    days.set(key, day);
  }
  return [...days.values()].every((day) => validateDayEntrySequence(day).valid);
}

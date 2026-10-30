import type { TimeEntry, TimeEntryType } from '@/lib/time-tracking/types';
import { formatBerlinLocalDate, getLocalDayStart, getLocalDayEnd } from '@/lib/date-time/berlin';
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

function nextBerlinMidnight(instant: Date): number {
  return getLocalDayEnd(instant).getTime() + 1;
}

/** Whether `next` carries on the time that the opening `open` left running, rather than starting new time. */
function continuesOpenTime(open: TimeEntryType, next: TimeEntryType): boolean {
  return open === 'break_start'
    ? next === 'break_end' || next === 'clock_out'
    : next === 'clock_out' || next === 'break_start';
}

/**
 * Splits proposed time that runs past Berlin midnight into one piece per day,
 * as live capture projects an overnight session: the open time closes at
 * 00:00 and reopens at 00:00. Each day then validates, displays, counts and
 * meets the closed-period guard on its own facts.
 */
export function splitCorrectionFactsAtMidnight(facts: readonly TimeCorrectionFact[]): TimeCorrectionFact[] {
  const open = new Map<string, TimeCorrectionFact>();
  const split: TimeCorrectionFact[] = [];
  for (const fact of facts) {
    const opening = open.get(fact.userId);
    if (opening && continuesOpenTime(opening.entryType, fact.entryType)) {
      const types: TimeEntryType[] =
        opening.entryType === 'break_start'
          ? ['break_end', 'clock_out', 'clock_in', 'break_start']
          : ['clock_out', 'clock_in'];
      const until = correctionDayOwner(fact).getTime();
      for (
        let midnight = nextBerlinMidnight(correctionDayOwner(opening));
        midnight <= until;
        midnight = nextBerlinMidnight(new Date(midnight))
      ) {
        const timestamp = new Date(midnight).toISOString();
        split.push(
          ...types.map((entryType) => ({
            ...opening,
            factId: `${opening.factId}@${timestamp}:${entryType}`,
            entryType,
            timestamp,
          })),
        );
      }
    }
    split.push(fact);
    if (fact.entryType === 'clock_out') open.delete(fact.userId);
    else open.set(fact.userId, fact);
  }
  // Stable: another person's facts may fall between an opening and its close.
  return split.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

/**
 * Whether a candidate leaves time open on one Berlin day and closes it on a
 * later one. Only a correction that carries both its start and its end is
 * split at midnight, so this one cannot be applied.
 */
function closesAcrossMidnight(entries: readonly TimeEntry[], candidateIds: ReadonlySet<string>): boolean {
  const open = new Map<string, TimeEntry>();
  for (const entry of entries) {
    if (entry.status === 'rejected' || entry.status === 'pending_delete') continue;
    const opening = open.get(entry.userId);
    if (
      opening &&
      continuesOpenTime(opening.entryType, entry.entryType) &&
      formatBerlinLocalDate(correctionDayOwner(opening)) !==
        formatBerlinLocalDate(correctionDayOwner(entry)) &&
      [opening, entry].some(
        (boundary) => boundary.correctionApplicationId && candidateIds.has(boundary.correctionApplicationId),
      )
    )
      return true;
    if (entry.entryType === 'clock_out') open.delete(entry.userId);
    else open.set(entry.userId, entry);
  }
  return false;
}

export function correctionTimelineWindow(
  facts: readonly TimeCorrectionFact[],
): { affectedDays: Set<string>; from: string; to: string; userIds: string[] } | null {
  if (!facts.length) return null;
  const owners = facts.map(correctionDayOwner);
  return {
    affectedDays: new Set(
      facts.map((fact) => `${fact.userId}:${formatBerlinLocalDate(correctionDayOwner(fact))}`),
    ),
    // The day before is read too, so time left open the evening before meets the midnight rule.
    from: getLocalDayStart(
      new Date(getLocalDayStart(new Date(Math.min(...owners.map((date) => date.getTime())))).getTime() - 1),
    ).toISOString(),
    // The closing boundary belongs to this day even when it lands at the next midnight.
    to: new Date(
      getLocalDayEnd(new Date(Math.max(...owners.map((date) => date.getTime())))).getTime() + 1,
    ).toISOString(),
    userIds: [...new Set(facts.map((fact) => fact.userId))],
  };
}

type CorrectionTimelineRefusal = 'correction_timeline_conflict' | 'correction_crosses_midnight';

/**
 * Validate the composed result, including both employees of a reassignment.
 * Null when every affected day keeps a valid sequence, else the rule it breaks.
 */
export function validateCorrectionTimeline(input: {
  entries: readonly TimeEntry[];
  applications: readonly TimeCorrectionApplicationProjection[];
  candidates: readonly TimeCorrectionApplicationProjection[];
  organizationId: string;
  affectedDays: ReadonlySet<string>;
}): CorrectionTimelineRefusal | null {
  const entries = applyApprovedTimeCorrections(
    input.entries,
    [...input.applications, ...input.candidates],
    input.organizationId,
  );
  const days = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const dayOwner = correctionDayOwner(entry);
    const key = `${entry.userId}:${formatBerlinLocalDate(dayOwner)}`;
    if (!input.affectedDays.has(key)) continue;
    const day = days.get(key) ?? [];
    day.push(entry);
    days.set(key, day);
  }
  if ([...days.values()].every((day) => validateDayEntrySequence(day).valid)) return null;
  const candidateIds = new Set(input.candidates.map((candidate) => candidate.applicationId));
  return closesAcrossMidnight(entries, candidateIds)
    ? 'correction_crosses_midnight'
    : 'correction_timeline_conflict';
}

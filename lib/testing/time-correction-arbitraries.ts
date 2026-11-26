import fc from 'fast-check';
import type { TimeCorrectionFact } from '@/lib/time-corrections/types';
import { createActivitySelection } from '@/lib/time-tracking/segments';
import type { TimeEntry, TimeEntryType, TimeSegmentKind } from '@/lib/time-tracking/types';
import {
  berlinDateArbitrary,
  berlinMidnightMs,
  berlinMinuteInstantMsArbitrary,
  berlinOffsetMinutes,
} from './berlin-arbitraries';

/**
 * Inputs for property tests of time corrections (docs/features/time-tracking.md, "Approval and
 * corrections"): one person's open time as clock facts, with the minutes it holds known from how
 * it was drawn, so a property compares a module's result with the drawing, not with a formula of
 * the module.
 */

export const MINUTE_MS = 60_000;
export const DAY_MINUTES = 24 * 60;

/** The Berlin wall time `YYYY-MM-DDTHH:MM` of an instant by the EU rule, without Intl. */
export function oracleBerlinWallTime(instant: number): string {
  return new Date(instant + berlinOffsetMinutes(instant) * MINUTE_MS).toISOString().slice(0, 16);
}

/** The Berlin date of an instant by the EU rule, without Intl. */
export function oracleBerlinDate(instant: number): string {
  return oracleBerlinWallTime(instant).slice(0, 10);
}

/** Starts on a whole minute, with Berlin midnights of DST days, month and year turns drawn often. */
export const correctionStartArbitrary: fc.Arbitrary<number> = fc.oneof(
  berlinMinuteInstantMsArbitrary,
  fc
    .tuple(berlinDateArbitrary, fc.integer({ min: -12 * 60, max: DAY_MINUTES }))
    .map(([localDate, minutes]) => berlinMidnightMs(localDate) + minutes * MINUTE_MS),
);

/** Open time of one person: from `start` to `end`, with an optional break inside. */
export type OpenTime = {
  start: number;
  end: number;
  break: { start: number; end: number } | null;
  /** Minutes from start to end without the break. */
  workMinutes: number;
  breakMinutes: number;
};

/** Open time of 1 to `maxMinutes` minutes, a break of at least a minute inside it half the time. */
export function openTimeArbitrary(maxMinutes: number): fc.Arbitrary<OpenTime> {
  return fc
    .tuple(
      correctionStartArbitrary,
      fc.integer({ min: 1, max: maxMinutes }),
      fc.option(fc.tuple(fc.nat(), fc.nat()), { nil: null }),
    )
    .map(([start, minutes, breakDraw]): OpenTime => {
      const end = start + minutes * MINUTE_MS;
      if (!breakDraw || minutes < 3)
        return { start, end, break: null, workMinutes: minutes, breakMinutes: 0 };
      // The break starts after at least a minute of work and ends at least a minute before the end.
      const breakStart = 1 + (breakDraw[0] % (minutes - 2));
      const breakMinutes = 1 + (breakDraw[1] % (minutes - 1 - breakStart));
      return {
        start,
        end,
        break: {
          start: start + breakStart * MINUTE_MS,
          end: start + (breakStart + breakMinutes) * MINUTE_MS,
        },
        workMinutes: minutes - breakMinutes,
        breakMinutes,
      };
    });
}

/**
 * Work and break minutes of clock facts in time order, as the time account reads them: each fact
 * but a clock-out opens time until the next, a break start opens a break.
 */
export function clockMinutes(facts: readonly Pick<TimeCorrectionFact, 'entryType' | 'timestamp'>[]): {
  work: number;
  rest: number;
} {
  let work = 0;
  let rest = 0;
  let open: { onBreak: boolean; at: number } | null = null;
  for (const fact of facts) {
    const at = Date.parse(fact.timestamp);
    if (open?.onBreak) rest += (at - open.at) / MINUTE_MS;
    else if (open) work += (at - open.at) / MINUTE_MS;
    open = fact.entryType === 'clock_out' ? null : { onBreak: fact.entryType === 'break_start', at };
  }
  return { work, rest };
}

/** One clock fact of the person `person`, as a correction snapshot holds it. */
export function correctionFact(
  factId: string,
  entryType: TimeEntryType,
  instant: number,
  overrides: Partial<TimeCorrectionFact> = {},
): TimeCorrectionFact {
  const kind: TimeSegmentKind = entryType === 'break_start' ? 'break' : 'work';
  return {
    factId,
    employeeRecordId: 'person-record',
    userId: 'person',
    entryType,
    timestamp: new Date(instant).toISOString(),
    jobId: null,
    activityKind: kind,
    activity: createActivitySelection(kind),
    isManual: true,
    ...overrides,
  };
}

/** The clock facts of open time: clock-in, the break's start and end, clock-out. */
export function openTimeFacts(
  time: OpenTime,
  prefix: string,
  overrides: Partial<TimeCorrectionFact> = {},
): TimeCorrectionFact[] {
  return [
    correctionFact(`${prefix}-in`, 'clock_in', time.start, overrides),
    ...(time.break
      ? [
          correctionFact(`${prefix}-break`, 'break_start', time.break.start, {
            ...overrides,
            jobId: null,
            activityKind: 'break',
            activity: createActivitySelection('break'),
          }),
          correctionFact(`${prefix}-resume`, 'break_end', time.break.end, overrides),
        ]
      : []),
    correctionFact(`${prefix}-out`, 'clock_out', time.end, overrides),
  ];
}

/** An approved recorded entry of the person `person`, a legacy entry unless `overrides` say otherwise. */
export function recordedEntry(
  id: string,
  entryType: TimeEntryType,
  instant: number,
  overrides: Partial<TimeEntry> = {},
): TimeEntry {
  const timestamp = new Date(instant).toISOString();
  return {
    id,
    userId: 'person',
    organizationId: 'org',
    entryType,
    timestamp,
    isManual: false,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    activityKind: 'work',
    sourceKind: 'legacy_entry',
    sourceVersion: timestamp,
    ...overrides,
  };
}

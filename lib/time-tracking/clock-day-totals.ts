import {
  buildClockTimelineSegments,
  calculateBreakMinutes,
  calculateBreakSessions,
  calculateTotalMinutes,
  calculateWorkSessions,
} from './helpers';
import { calculateTimeActivityTotals, getSegmentDurationMinutes, type TimeSegmentFact } from './segments';
import type { ClockTimelineSegment, LiveClockState, TimeEntry } from './types';

/**
 * The minutes one capture model recorded today, the running activity
 * excluded: the client counts that one from its start. `breakMinutes` is the
 * tracked break before the organization's break mode applies.
 */
export type ClockDayTotals = Pick<
  LiveClockState,
  | 'breakMinutes'
  | 'travelMinutes'
  | 'standbyMinutes'
  | 'calloutMinutes'
  | 'internalMinutes'
  | 'timelineSegments'
> & { presenceMinutes: number };

/**
 * Today's totals of the canonical segments of every session that overlaps the
 * Berlin day, open or closed. A segment still running adds nothing.
 */
export function canonicalDayTotals(
  segments: readonly TimeSegmentFact[],
  dayStart: Date,
  dayEnd: Date,
): ClockDayTotals {
  const closed = segments.filter((segment) => segment.endedAt !== null);
  const totals = calculateTimeActivityTotals(closed, dayStart, dayEnd);
  const timelineSegments: ClockTimelineSegment[] = closed.map((segment) => ({
    type: segment.kind === 'break' ? 'break' : 'work',
    minutes: getSegmentDurationMinutes(segment, dayStart, dayEnd),
  }));
  return {
    presenceMinutes: totals.presenceMinutes,
    breakMinutes: totals.breakMinutes,
    travelMinutes: totals.travelMinutes,
    standbyMinutes: totals.standbyMinutes,
    calloutMinutes: totals.calloutMinutes,
    internalMinutes: totals.internalMinutes,
    timelineSegments,
  };
}

/** Today's totals of the legacy entries (manual entries and pre-segment captures). */
export function legacyDayTotals(entries: TimeEntry[], now: Date): ClockDayTotals {
  const workMinutes = calculateTotalMinutes(calculateWorkSessions(entries));
  const breakMinutes = calculateBreakMinutes(calculateBreakSessions(entries));
  return {
    presenceMinutes: workMinutes + breakMinutes,
    breakMinutes,
    travelMinutes: 0,
    standbyMinutes: 0,
    calloutMinutes: 0,
    internalMinutes: 0,
    timelineSegments: buildClockTimelineSegments(entries, now, {
      sameLocalDayOnly: true,
      includeOpenSegment: false,
    }),
  };
}

/**
 * Both capture models' minutes of the day. Neither carries its blocks' times,
 * so a day with blocks from both shows no block order: the ring falls back to
 * its aggregate view instead of placing one model's blocks first.
 */
export function combineClockDayTotals(legacy: ClockDayTotals, canonical: ClockDayTotals): ClockDayTotals {
  return {
    presenceMinutes: legacy.presenceMinutes + canonical.presenceMinutes,
    breakMinutes: legacy.breakMinutes + canonical.breakMinutes,
    travelMinutes: legacy.travelMinutes + canonical.travelMinutes,
    standbyMinutes: legacy.standbyMinutes + canonical.standbyMinutes,
    calloutMinutes: legacy.calloutMinutes + canonical.calloutMinutes,
    internalMinutes: legacy.internalMinutes + canonical.internalMinutes,
    timelineSegments:
      legacy.timelineSegments.length > 0 && canonical.timelineSegments.length > 0
        ? []
        : [...legacy.timelineSegments, ...canonical.timelineSegments],
  };
}

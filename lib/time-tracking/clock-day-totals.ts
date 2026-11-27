import {
  buildClockTimelineSegments,
  calculateBreakMinutes,
  calculateBreakSessions,
  calculateTotalMinutes,
  calculateWorkSessions,
  sessionActivityMinutes,
} from './helpers';
import type { LiveClockState, TimeEntry } from './types';

/**
 * The minutes recorded today, the running activity excluded: the client
 * counts that one from its start. `breakMinutes` is the tracked break before
 * the organization's break mode applies.
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
 * Today's totals of the day's entries, as the week counts them: the legacy
 * entries and the canonical segments' transitions with the approved
 * corrections applied. A start still open adds nothing.
 */
export function clockDayTotals(dayEntries: TimeEntry[], now: Date): ClockDayTotals {
  const workSessions = calculateWorkSessions(dayEntries);
  const breakMinutes = calculateBreakMinutes(calculateBreakSessions(dayEntries));
  return {
    presenceMinutes: calculateTotalMinutes(workSessions) + breakMinutes,
    breakMinutes,
    ...sessionActivityMinutes(workSessions),
    timelineSegments: buildClockTimelineSegments(dayEntries, now, {
      sameLocalDayOnly: true,
      includeOpenSegment: false,
    }),
  };
}

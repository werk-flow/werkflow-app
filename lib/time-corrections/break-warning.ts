import type { ResolvedTimelineSegment } from './timeline';

// The statutory rest of ArbZG § 4 for a forgotten day: more than six hours
// of work need 30 minutes of break, more than nine hours 45 minutes, in parts
// of at least 15 minutes. The form only warns; it never inserts a break, and
// the automatic break deduction stays with the break rule (werk-flow/werkflow-planning#161).
// Like the period warning „Pausenregel prüfen“, every activity but a break counts as work.

const BREAK_STEPS = [
  { workAboveMinutes: 9 * 60, breakMinutes: 45 },
  { workAboveMinutes: 6 * 60, breakMinutes: 30 },
] as const;

/** A shorter pause is no rest under the statute. */
const SHORTEST_COUNTED_REST_MINUTES = 15;

export type BreakShortfall = {
  workAboveHours: number;
  requiredBreakMinutes: number;
  countedBreakMinutes: number;
};

function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 60_000);
}

/**
 * The statutory step the timeline misses, or null when its breaks and the
 * gaps between its activities cover the step its work reaches.
 */
export function findBreakShortfall(segments: readonly ResolvedTimelineSegment[]): BreakShortfall | null {
  let workMinutes = 0;
  const rests: number[] = [];
  for (const [index, segment] of segments.entries()) {
    const minutes = minutesBetween(segment.startedAt, segment.endedAt);
    if (segment.row.kind === 'break') rests.push(minutes);
    else workMinutes += minutes;
    const previous = segments[index - 1];
    if (previous) rests.push(minutesBetween(previous.endedAt, segment.startedAt));
  }
  const countedBreakMinutes = rests
    .filter((minutes) => minutes >= SHORTEST_COUNTED_REST_MINUTES)
    .reduce((sum, minutes) => sum + minutes, 0);
  const step = BREAK_STEPS.find((candidate) => workMinutes > candidate.workAboveMinutes);
  if (!step || countedBreakMinutes >= step.breakMinutes) return null;
  return {
    workAboveHours: step.workAboveMinutes / 60,
    requiredBreakMinutes: step.breakMinutes,
    countedBreakMinutes,
  };
}

/** The warning's sentence: it states the rule and what the timeline holds, and asks to add a missing break. */
export function describeBreakShortfall(shortfall: BreakShortfall): string {
  return (
    `Bei mehr als ${shortfall.workAboveHours} Stunden Arbeit sieht das Arbeitszeitgesetz mindestens ` +
    `${shortfall.requiredBreakMinutes} Minuten Pause vor, in Abschnitten ab 15 Minuten. ` +
    `Eingetragen sind ${shortfall.countedBreakMinutes} Minuten. Fehlt eine Pause, trag sie ein.`
  );
}

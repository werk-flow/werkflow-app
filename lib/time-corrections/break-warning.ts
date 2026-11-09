import type { ResolvedTimelineSegment } from './timeline';

// The statutory rest of ArbZG § 4 for a forgotten day: more than six hours
// of work need 30 minutes of break, more than nine hours 45 minutes, in parts
// of at least 15 minutes, and nobody works more than six hours in a row
// without such a rest. The form only warns; it never inserts a break, and
// the automatic break deduction stays with the break rule (werk-flow/werkflow-planning#161).
// Like the period warning „Pausenregel prüfen“, every activity but a break counts as work.

const BREAK_STEPS = [
  { workAboveMinutes: 9 * 60, breakMinutes: 45 },
  { workAboveMinutes: 6 * 60, breakMinutes: 30 },
] as const;

/** A shorter pause is no rest under the statute. */
const SHORTEST_COUNTED_REST_MINUTES = 15;

/** The longest work a person may do in a row without a counted rest (§ 4 sentence 3). */
const LONGEST_STRETCH_MINUTES = 6 * 60;

export type BreakShortfall =
  | { kind: 'total'; workAboveHours: number; requiredBreakMinutes: number; countedBreakMinutes: number }
  | { kind: 'stretch'; stretchMinutes: number };

function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 60_000);
}

/** The longest run of work between counted rests: a break or a gap of at least 15 minutes. */
function longestWorkStretch(segments: readonly ResolvedTimelineSegment[]): number {
  let run = 0;
  let longest = 0;
  for (const [index, segment] of segments.entries()) {
    const previous = segments[index - 1];
    if (previous && minutesBetween(previous.endedAt, segment.startedAt) >= SHORTEST_COUNTED_REST_MINUTES)
      run = 0;
    const minutes = minutesBetween(segment.startedAt, segment.endedAt);
    if (segment.row.kind === 'break') {
      if (minutes >= SHORTEST_COUNTED_REST_MINUTES) run = 0;
      continue;
    }
    run += minutes;
    longest = Math.max(longest, run);
  }
  return longest;
}

/**
 * The statutory rest the timeline misses, or null when its breaks and the
 * gaps between its activities cover the step its work reaches and no stretch
 * of work runs past six hours without a rest.
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
  if (step && countedBreakMinutes < step.breakMinutes)
    return {
      kind: 'total',
      workAboveHours: step.workAboveMinutes / 60,
      requiredBreakMinutes: step.breakMinutes,
      countedBreakMinutes,
    };
  const stretchMinutes = longestWorkStretch(segments);
  return stretchMinutes > LONGEST_STRETCH_MINUTES ? { kind: 'stretch', stretchMinutes } : null;
}

function hoursAndMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} Stunden` : `${hours} Stunden ${rest} Minuten`;
}

/** The warning's sentence: it states the rule and what the timeline holds, and asks to add a missing break. */
export function describeBreakShortfall(shortfall: BreakShortfall): string {
  if (shortfall.kind === 'stretch')
    return (
      'Nach mehr als 6 Stunden Arbeit am Stück sieht das Arbeitszeitgesetz eine Pause von mindestens 15 Minuten vor. ' +
      `Eingetragen sind ${hoursAndMinutes(shortfall.stretchMinutes)} ohne Pause. Fehlt eine Pause, trag sie ein.`
    );
  return (
    `Bei mehr als ${shortfall.workAboveHours} Stunden Arbeit sieht das Arbeitszeitgesetz mindestens ` +
    `${shortfall.requiredBreakMinutes} Minuten Pause vor, in Abschnitten ab 15 Minuten. ` +
    `Eingetragen sind ${shortfall.countedBreakMinutes} Minuten. Fehlt eine Pause, trag sie ein.`
  );
}

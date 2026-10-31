import { TIME_ACTIVITY_LABELS, type LiveClockState, type TimeSegmentKind } from './types';

// What the Zeiterfassung overview says about today: the activity running now
// and the parts today's working time is made of.

export type ClockActivityTone = 'active' | 'break' | 'idle';

type ClockActivityStatus = {
  /** The hero's sentence, such as „Du bist gerade unterwegs.“ */
  sentence: string;
  /** The status card's short badge. */
  badge: string;
  tone: ClockActivityTone;
};

const ACTIVITY_STATUS = {
  work: { sentence: 'Du arbeitest gerade.', badge: 'arbeitet', tone: 'active' },
  travel: { sentence: 'Du bist gerade unterwegs.', badge: 'unterwegs', tone: 'active' },
  break: { sentence: 'Du machst gerade Pause.', badge: 'Pause', tone: 'break' },
  standby: { sentence: 'Du hast gerade Bereitschaft.', badge: 'Bereitschaft', tone: 'active' },
  callout: { sentence: 'Du bist gerade im Notdienst.', badge: 'Notdienst', tone: 'active' },
  internal_activity: {
    sentence: 'Du erledigst gerade interne Arbeit.',
    badge: 'intern',
    tone: 'active',
  },
} as const satisfies Record<TimeSegmentKind, ClockActivityStatus>;

const NOT_CLOCKED_IN: ClockActivityStatus = {
  sentence: 'Du bist nicht eingestempelt.',
  badge: 'inaktiv',
  tone: 'idle',
};

/**
 * The running activity in words. A legacy stream knows only work and breaks,
 * so a running state without an activity reads as its status.
 */
export function describeClockActivity(
  state: Pick<LiveClockState, 'isClockedIn' | 'status' | 'currentActivity'>,
): ClockActivityStatus {
  if (!state.isClockedIn) return NOT_CLOCKED_IN;
  const kind = state.currentActivity?.kind ?? (state.status === 'on_break' ? 'break' : 'work');
  return ACTIVITY_STATUS[kind];
}

type WorkTimePart = { kind: Exclude<TimeSegmentKind, 'break'>; label: string; minutes: number };

const OTHER_WORK_KINDS = ['travel', 'standby', 'callout', 'internal_activity'] as const;

/** Whole numbers that sum to `total`: each value floored, the rest to the largest remainders. */
function roundToTotal(values: readonly number[], total: number): number[] {
  const floors = values.map((value) => Math.floor(value));
  let rest = total - floors.reduce((sum, value) => sum + value, 0);
  const byRemainder = values
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder);
  for (const { index } of byRemainder) {
    if (rest <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    rest -= 1;
  }
  return floors;
}

/**
 * The parts of today's working time in whole minutes that add up to the
 * rounded total: travel, standby, callout and internal time as recorded, work
 * as the rest. An automatic break comes out of the work part; one longer than
 * the work comes out of the other parts evenly. Empty while the day holds work
 * only, so the total stands alone.
 */
function workTimeParts(
  workMinutes: number,
  minutes: Record<(typeof OTHER_WORK_KINDS)[number], number>,
): WorkTimePart[] {
  const otherMinutes = OTHER_WORK_KINDS.reduce((total, kind) => total + minutes[kind], 0);
  if (otherMinutes <= 0 || workMinutes <= 0) return [];
  const scale = Math.min(1, workMinutes / otherMinutes);
  const exact = [
    { kind: 'work' as const, minutes: workMinutes - otherMinutes * scale },
    ...OTHER_WORK_KINDS.map((kind) => ({ kind, minutes: minutes[kind] * scale })),
  ];
  const rounded = roundToTotal(
    exact.map((part) => part.minutes),
    Math.round(workMinutes),
  );
  const parts = exact
    .map((part, index) => ({
      kind: part.kind,
      label: TIME_ACTIVITY_LABELS[part.kind],
      minutes: rounded[index] ?? 0,
    }))
    .filter((part) => part.kind === 'work' || part.minutes > 0);
  return parts.length > 1 ? parts : [];
}

/**
 * Today's working time with its overtime, and the parts it is made of. The
 * parts cover the overtime too, so a recorded drive keeps its minutes on a day
 * past the target.
 */
export function todayWorkingTime(
  breakdown: { workMinutes: number; overtimeMinutes: number },
  minutes: Record<(typeof OTHER_WORK_KINDS)[number], number>,
): { workingMinutes: number; parts: WorkTimePart[] } {
  const workingMinutes = breakdown.workMinutes + breakdown.overtimeMinutes;
  return { workingMinutes, parts: workTimeParts(workingMinutes, minutes) };
}

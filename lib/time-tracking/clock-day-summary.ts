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

/**
 * The parts of today's working time, in whole minutes that add up to the
 * rounded total: travel, standby, callout and internal time as recorded, work
 * as the rest. Empty while the day holds work only, so the total stands alone.
 * An automatic break comes out of the work part.
 */
export function workTimeParts(
  workMinutes: number,
  minutes: Record<Exclude<TimeSegmentKind, 'work' | 'break'>, number>,
): WorkTimePart[] {
  const others = (['travel', 'standby', 'callout', 'internal_activity'] as const)
    .map((kind) => ({ kind, label: TIME_ACTIVITY_LABELS[kind], minutes: Math.round(minutes[kind]) }))
    .filter((part) => part.minutes > 0);
  if (others.length === 0) return [];
  const otherMinutes = others.reduce((total, part) => total + part.minutes, 0);
  const work = Math.max(0, Math.round(workMinutes) - otherMinutes);
  return [{ kind: 'work', label: TIME_ACTIVITY_LABELS.work, minutes: work }, ...others];
}

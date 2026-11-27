import { calculateWorkSessions } from './work-sessions';
import {
  calculateBreakMinutes,
  calculateBreakSessions,
  calculateTotalMinutes,
  deriveCurrentClockState,
  liveMinutes,
} from './helpers';
import { isEffectiveEntry } from './effective-entries';
import {
  computeDayBreakdown,
  type BreakPolicy,
  type BreakPolicyValues,
  type TimeBreakdown,
} from './settings';
import type { TimeEntry, WorkSession } from './types';
import { dayBreakPolicy } from './weekly';

// One member's day for the office's live views (the Mitarbeiter list and
// detail), from that member's entries of today, split by the same day rule
// as the week (`computeDayBreakdown`).

export type MemberStatus = {
  status: 'clocked_out' | 'working' | 'on_break';
  isClockedIn: boolean;
  isOnBreak: boolean;
  isPending: boolean;
  clockInTime: string | null;
  statusStartedAt: string | null;
  todayMinutes: number;
  /** Today's closed standby, part of `todayMinutes`; the running activity is not in it. */
  standbyMinutes: number;
  /** Whether the running activity is standby: its minutes grow the standby too. Never during a break. */
  isOnStandby: boolean;
  workMinutes: number;
  breakMinutes: number;
  /** The rule the day counts by (`dayBreakPolicy`): the current one while the clock runs. */
  breakPolicy: BreakPolicyValues;
};

/** The member's most recent clock-in that still counts: pending included, rejected and pending_delete excluded. */
function latestClockInEntry(memberEntries: TimeEntry[]): TimeEntry | undefined {
  return memberEntries
    .filter((e) => e.entryType === 'clock_in' && isEffectiveEntry(e))
    .sort((a, b) => {
      const diff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      if (diff !== 0) return diff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })[0];
}

/** A member without a status has recorded nothing today. */
const NO_TIME: TimeBreakdown = { workMinutes: 0, breakMinutes: 0, overtimeMinutes: 0 };

/** One member's status today, from that member's entries of the day. */
export function memberStatusOf(memberEntries: TimeEntry[], settings: BreakPolicy): MemberStatus {
  const currentState = deriveCurrentClockState(memberEntries);
  const breakPolicy = dayBreakPolicy(settings, memberEntries, currentState.isClockedIn);
  const workSessions = calculateWorkSessions(memberEntries);
  const breakSessions = calculateBreakSessions(memberEntries);
  const isStandby = (session: WorkSession) => session.clockIn?.activityKind === 'standby';
  const trackedWorkMinutes = calculateTotalMinutes(workSessions);
  const standbyMinutes = calculateTotalMinutes(workSessions.filter(isStandby));
  const trackedBreakMinutes = calculateBreakMinutes(breakSessions);
  const todayMinutes = trackedWorkMinutes + trackedBreakMinutes;
  // The status carries no target: its work minutes owe no overtime.
  const breakdown = computeDayBreakdown(
    { presenceMinutes: todayMinutes, standbyMinutes, trackedBreakMinutes },
    breakPolicy,
    undefined,
  );
  // The latest open session is the running one; an earlier unpaired start does not run.
  const runningSession = workSessions.findLast((session) => session.clockOut === null && !session.isOrphan);

  // If clocked in, find the last clock_in timestamp and check if it's pending
  let clockInTime: string | null = null;
  let isPending = false;

  if (currentState.isClockedIn) {
    const clockInEntry = latestClockInEntry(memberEntries);
    clockInTime = clockInEntry?.timestamp || null;
    isPending = clockInEntry?.status === 'pending';
  }

  return {
    status: currentState.status,
    isClockedIn: currentState.isClockedIn,
    isOnBreak: currentState.isOnBreak,
    isPending,
    clockInTime,
    statusStartedAt: currentState.statusStartedAt,
    todayMinutes,
    standbyMinutes,
    isOnStandby:
      currentState.status === 'working' && runningSession !== undefined && isStandby(runningSession),
    workMinutes: breakdown.workMinutes,
    breakMinutes: breakdown.breakMinutes,
    breakPolicy,
  };
}

/**
 * A member's day at `nowMs`: the recorded minutes and the running activity,
 * split under the status's rule as the week splits the day. A running standby grows the
 * standby, a running break the tracked break (which only a manual rule
 * reads: under the automatic one the status carries the deducted break). An unknown target
 * (`undefined`) owes no overtime. Before the client knows the time (`nowMs`
 * null) the day holds the recorded minutes only.
 */
export function memberLiveDay(
  status: MemberStatus | undefined,
  targetMinutes: number | undefined,
  nowMs: number | null,
): { presenceMinutes: number; breakdown: TimeBreakdown } {
  if (!status) return { presenceMinutes: 0, breakdown: NO_TIME };
  const runningSince = nowMs !== null && status.isClockedIn ? status.statusStartedAt : null;
  const runningAs = (running: boolean) => (running ? runningSince : null);
  const atMs = nowMs ?? 0;
  const presenceMinutes = liveMinutes(status.todayMinutes, runningSince, atMs);
  const breakdown = computeDayBreakdown(
    {
      presenceMinutes,
      standbyMinutes: liveMinutes(status.standbyMinutes, runningAs(status.isOnStandby), atMs),
      trackedBreakMinutes: liveMinutes(status.breakMinutes, runningAs(status.status === 'on_break'), atMs),
    },
    status.breakPolicy,
    targetMinutes,
  );
  return { presenceMinutes, breakdown };
}

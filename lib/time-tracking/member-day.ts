import { calculateWorkSessions } from './work-sessions';
import {
  calculateBreakMinutes,
  calculateBreakSessions,
  calculateTotalMinutes,
  deriveCurrentClockState,
  liveMinutes,
} from './helpers';
import { computeDayBreakdown, type BreakPolicyValues, type TimeBreakdown } from './settings';
import type { TimeEntry, WorkSession } from './types';

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
  /** Whether the running activity is standby: its minutes grow the standby too. */
  isOnStandby: boolean;
  workMinutes: number;
  breakMinutes: number;
};

/** The member's most recent clock-in that still counts: pending included, rejected and pending_delete excluded. */
function latestClockInEntry(memberEntries: TimeEntry[]): TimeEntry | undefined {
  return memberEntries
    .filter((e) => e.entryType === 'clock_in' && e.status !== 'rejected' && e.status !== 'pending_delete')
    .sort((a, b) => {
      const diff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      if (diff !== 0) return diff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })[0];
}

/** One member's status today, from that member's entries of the day. */
export function memberStatusOf(memberEntries: TimeEntry[], breakPolicy: BreakPolicyValues): MemberStatus {
  const currentState = deriveCurrentClockState(memberEntries);
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
  const runningSession = workSessions.find((session) => session.clockOut === null && !session.isOrphan);

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
    isOnStandby: currentState.isClockedIn && runningSession !== undefined && isStandby(runningSession),
    workMinutes: breakdown.workMinutes,
    breakMinutes: breakdown.breakMinutes,
  };
}

/**
 * A member's day at `nowMs`: the recorded minutes and the running activity,
 * split by the same day rule as the week. A running standby grows the
 * standby, a running break the tracked break (which only a manual rule
 * reads: under the automatic one the status carries the deducted break). An unknown target
 * (`undefined`) owes no overtime.
 */
export function memberLiveDay(
  status: MemberStatus | undefined,
  breakPolicy: BreakPolicyValues,
  targetMinutes: number | undefined,
  nowMs: number,
): { presenceMinutes: number; breakdown: TimeBreakdown } {
  const runningSince = status?.isClockedIn ? status.statusStartedAt : null;
  const runningAs = (running: boolean | undefined) => (running ? runningSince : null);
  const presenceMinutes = liveMinutes(status?.todayMinutes ?? 0, runningSince, nowMs);
  const breakdown = computeDayBreakdown(
    {
      presenceMinutes,
      standbyMinutes: liveMinutes(status?.standbyMinutes ?? 0, runningAs(status?.isOnStandby), nowMs),
      trackedBreakMinutes: liveMinutes(
        status?.breakMinutes ?? 0,
        runningAs(status?.status === 'on_break'),
        nowMs,
      ),
    },
    breakPolicy,
    targetMinutes,
  );
  return { presenceMinutes, breakdown };
}

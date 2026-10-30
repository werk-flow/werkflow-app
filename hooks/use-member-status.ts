'use client';

import {
  calculateBreakMinutes,
  calculateBreakSessions,
  deriveCurrentClockState,
  calculateTotalMinutes,
} from '@/lib/time-tracking/helpers';
import { logError } from '@/lib/logging';
import { calculateWorkSessions } from '@/lib/time-tracking/work-sessions';
import { readInBackground, type BackgroundReadFailure } from '@/lib/data/background-read-client';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { computeBreakdownForSettings, type OrgBreakMode } from '@/lib/time-tracking/settings';
import type { GetTimeEntriesParams, GetTimeEntriesResult, TimeEntry } from '@/lib/time-tracking/types';

export type MemberStatus = {
  breakMode: OrgBreakMode;
  autoBreakThresholdMinutes: number;
  autoBreakDurationMinutes: number;
  status: 'clocked_out' | 'working' | 'on_break';
  isClockedIn: boolean;
  isOnBreak: boolean;
  isPending: boolean;
  clockInTime: string | null;
  statusStartedAt: string | null;
  todayMinutes: number;
  workMinutes: number;
  breakMinutes: number;
};

type MemberStatusMap = Record<string, MemberStatus>;

const EMPTY_STATUS_MAP: MemberStatusMap = {};

function fetchTimeEntries(
  params: GetTimeEntriesParams,
  signal: AbortSignal,
): Promise<GetTimeEntriesResult | BackgroundReadFailure> {
  return readInBackground('time-entries', params, signal);
}

type BreakPolicy = Pick<MemberStatus, 'breakMode' | 'autoBreakThresholdMinutes' | 'autoBreakDurationMinutes'>;

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
function memberStatusOf(memberEntries: TimeEntry[], policy: BreakPolicy): MemberStatus {
  const { breakMode, autoBreakThresholdMinutes, autoBreakDurationMinutes } = policy;
  const currentState = deriveCurrentClockState(memberEntries);
  const workSessions = calculateWorkSessions(memberEntries);
  const breakSessions = calculateBreakSessions(memberEntries);
  const trackedWorkMinutes = calculateTotalMinutes(workSessions);
  const trackedBreakMinutes = calculateBreakMinutes(breakSessions);
  const todayMinutes = trackedWorkMinutes + trackedBreakMinutes;
  const breakdown = computeBreakdownForSettings(todayMinutes, trackedBreakMinutes, {
    breakMode,
    autoBreakThresholdMinutes,
    autoBreakDurationMinutes,
  });

  // If clocked in, find the last clock_in timestamp and check if it's pending
  let clockInTime: string | null = null;
  let isPending = false;

  if (currentState.isClockedIn) {
    const clockInEntry = latestClockInEntry(memberEntries);
    clockInTime = clockInEntry?.timestamp || null;
    isPending = clockInEntry?.status === 'pending';
  }

  return {
    breakMode,
    autoBreakThresholdMinutes,
    autoBreakDurationMinutes,
    status: currentState.status,
    isClockedIn: currentState.isClockedIn,
    isOnBreak: currentState.isOnBreak,
    isPending,
    clockInTime,
    statusStartedAt: currentState.statusStartedAt,
    todayMinutes,
    workMinutes: breakdown.workMinutes,
    breakMinutes: breakdown.breakMinutes,
  };
}

/** Today's status of every listed member, read through the background-read route. */
async function readMemberStatuses(
  organizationId: string,
  memberIds: string[],
  policy: BreakPolicy,
  signal: AbortSignal,
): Promise<LiveViewResult<MemberStatusMap>> {
  if (!organizationId || memberIds.length === 0) {
    return { ok: true, data: EMPTY_STATUS_MAP };
  }

  try {
    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Fetch all entries for today
    // A route handler keeps this live client read independent from the
    // current React Server Component tree. A server-action read can
    // complete after a link click and restore the page it started from.
    const result = await fetchTimeEntries(
      {
        organizationId,
        from: today.toISOString(),
        to: tomorrow.toISOString(),
      },
      signal,
    );

    if (!result.success) {
      return { ok: false, error: result.error };
    }

    // Group entries by user and calculate status
    const newStatusMap: MemberStatusMap = {};

    for (const memberId of memberIds) {
      const memberEntries = result.entries.filter((e) => e.userId === memberId);
      newStatusMap[memberId] = memberStatusOf(memberEntries, policy);
    }

    return { ok: true, data: newStatusMap };
  } catch (err) {
    logError('member_status.read_failed', err);
    return { ok: false, error: 'Failed to fetch status' };
  }
}

interface UseMemberStatusOptions {
  organizationId: string;
  memberIds: string[];
  breakMode?: OrgBreakMode;
  autoBreakThresholdMinutes?: number;
  autoBreakDurationMinutes?: number;
  /** Enable or disable fetching. Default: true */
  enabled?: boolean;
}

export function useMemberStatus({
  organizationId,
  memberIds,
  breakMode = 'manual',
  autoBreakThresholdMinutes = 360,
  autoBreakDurationMinutes = 30,
  enabled = true,
}: UseMemberStatusOptions): {
  statusMap: MemberStatusMap;
  isLoading: boolean;
  /** A refresh failed: the statuses are last-known. `error` stays null when the read threw. */
  isStale: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const view = useLiveView<MemberStatusMap>({
    tables: ['time_entries', 'time_sessions', 'time_segments', 'organization_settings'],
    read: ({ signal }) =>
      readMemberStatuses(
        organizationId,
        memberIds,
        { breakMode, autoBreakThresholdMinutes, autoBreakDurationMinutes },
        signal,
      ),
    enabled,
    // Membership or break-policy changes must discard the old map and read
    // fresh. The read then uses the current inputs through its closure.
    resetKey: `${organizationId}:${[...memberIds].sort().join(',')}:${breakMode}:${autoBreakThresholdMinutes}:${autoBreakDurationMinutes}`,
  });

  return {
    statusMap: view.data ?? EMPTY_STATUS_MAP,
    isLoading: view.isLoading,
    isStale: view.isStale,
    error: view.error,
    refetch: view.refresh,
  };
}

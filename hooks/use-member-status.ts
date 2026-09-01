'use client';

import { getTimeEntries } from '@/lib/time-tracking/actions';
import {
  calculateBreakMinutes,
  calculateBreakSessions,
  deriveCurrentClockState,
  calculateTotalMinutes
} from '@/lib/time-tracking/helpers';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import {
  computeBreakdownForSettings,
  type OrgBreakMode,
} from '@/lib/time-tracking/settings';

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
  enabled = true
}: UseMemberStatusOptions): {
  statusMap: MemberStatusMap;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const view = useLiveView<MemberStatusMap>({
    tables: [
      'time_entries',
      'time_sessions',
      'time_segments',
      'organization_settings',
    ],
    read: async (): Promise<LiveViewResult<MemberStatusMap>> => {
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
        const result = await getTimeEntries({
          organizationId,
          from: today.toISOString(),
          to: tomorrow.toISOString()
        });

        if (!result.success) {
          return { ok: false, error: result.error };
        }

        // Group entries by user and calculate status
        const newStatusMap: MemberStatusMap = {};

        for (const memberId of memberIds) {
          const memberEntries = result.entries.filter(
            (e) => e.userId === memberId
          );

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
            // Find the most recent clock_in entry (include pending since they now take effect)
            // Exclude rejected and pending_delete entries
            const clockInEntry = memberEntries
              .filter(
                (e) =>
                  e.entryType === 'clock_in' &&
                  e.status !== 'rejected' &&
                  e.status !== 'pending_delete'
              )
              .sort((a, b) => {
                const diff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
                if (diff !== 0) return diff;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
              })[0];

            clockInTime = clockInEntry?.timestamp || null;
            isPending = clockInEntry?.status === 'pending';
          }

          newStatusMap[memberId] = {
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
            breakMinutes: breakdown.breakMinutes
          };
        }

        return { ok: true, data: newStatusMap };
      } catch (err) {
        console.error('Error fetching member status:', err);
        return { ok: false, error: 'Failed to fetch status' };
      }
    },
    enabled,
    // Membership or break-policy changes must discard the old map and read
    // fresh. The read then uses the current inputs through its closure.
    resetKey: `${organizationId}:${[...memberIds].sort().join(',')}:${breakMode}:${autoBreakThresholdMinutes}:${autoBreakDurationMinutes}`,
  });

  return {
    statusMap: view.data ?? EMPTY_STATUS_MAP,
    isLoading: view.isLoading,
    error: view.error,
    refetch: view.refresh
  };
}

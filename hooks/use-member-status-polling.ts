'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import {
  calculateBreakMinutes,
  calculateBreakSessions,
  deriveCurrentClockState,
  calculateTotalMinutes
} from '@/lib/time-tracking/helpers';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
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

interface UseMemberStatusPollingOptions {
  organizationId: string;
  memberIds: string[];
  breakMode?: OrgBreakMode;
  autoBreakThresholdMinutes?: number;
  autoBreakDurationMinutes?: number;
  /** Enable or disable fetching. Default: true */
  enabled?: boolean;
}

export function useMemberStatusPolling({
  organizationId,
  memberIds,
  breakMode = 'manual',
  autoBreakThresholdMinutes = 360,
  autoBreakDurationMinutes = 30,
  enabled = true
}: UseMemberStatusPollingOptions): {
  statusMap: MemberStatusMap;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [statusMap, setStatusMap] = useState<MemberStatusMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!organizationId || memberIds.length === 0) {
      setIsLoading(false);
      return;
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
        setError(result.error);
        return;
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

      setStatusMap(newStatusMap);
      setError(null);
    } catch (err) {
      console.error('Error fetching member status:', err);
      setError('Failed to fetch status');
    } finally {
      setIsLoading(false);
    }
  }, [
    autoBreakDurationMinutes,
    autoBreakThresholdMinutes,
    breakMode,
    organizationId,
    memberIds,
  ]);

  const scheduleFetchStatus = useCallback(() => {
    if (!enabled) return;

    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void fetchStatus();
    }, 150);
  }, [enabled, fetchStatus]);

  // Initial fetch
  useEffect(() => {
    if (enabled) {
      void fetchStatus();
    }
  }, [fetchStatus, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleFetchStatus();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, scheduleFetchStatus]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  // Realtime: refetch when time entries change, but debounce bursts and
  // synthetic visibility events into a single repair fetch.
  useRealtimeEvent('time_entries', () => {
    scheduleFetchStatus();
  });

  return {
    statusMap,
    isLoading,
    error,
    refetch: fetchStatus
  };
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import {
  hasOpenSession,
  getLastEntry,
  calculateTotalMinutes
} from '@/lib/time-tracking/helpers';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';

export type MemberStatus = {
  isClockedIn: boolean;
  isPending: boolean;
  clockInTime: string | null;
  todayMinutes: number;
};

type MemberStatusMap = Record<string, MemberStatus>;

interface UseMemberStatusPollingOptions {
  organizationId: string;
  memberIds: string[];
  /** Enable or disable fetching. Default: true */
  enabled?: boolean;
}

export function useMemberStatusPolling({
  organizationId,
  memberIds,
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

        const isClockedIn = hasOpenSession(memberEntries);
        const lastEntry = getLastEntry(memberEntries);
        const sessions = calculateWorkSessions(memberEntries);
        const todayMinutes = calculateTotalMinutes(sessions);

        // If clocked in, find the last clock_in timestamp and check if it's pending
        let clockInTime: string | null = null;
        let isPending = false;

        if (isClockedIn) {
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
          isClockedIn,
          isPending,
          clockInTime,
          todayMinutes
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
  }, [organizationId, memberIds]);

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

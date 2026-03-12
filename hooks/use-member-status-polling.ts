'use client';

import { useState, useEffect, useCallback } from 'react';
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

  // Initial fetch
  useEffect(() => {
    if (enabled) {
      fetchStatus();
    }
  }, [fetchStatus, enabled]);

  // Realtime: refetch when time entries change
  useRealtimeEvent('time_entries', fetchStatus);

  return {
    statusMap,
    isLoading,
    error,
    refetch: fetchStatus
  };
}

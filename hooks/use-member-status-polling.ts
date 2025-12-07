'use client';

import { useState, useEffect, useCallback } from 'react';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import {
  hasOpenSession,
  getLastEntry,
  calculateTotalMinutes
} from '@/lib/time-tracking/helpers';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import { CLOCK_STATUS_REFRESH_EVENT } from '@/components/clock-fab';

export type MemberStatus = {
  isClockedIn: boolean;
  clockInTime: string | null;
  todayMinutes: number;
};

type MemberStatusMap = Record<string, MemberStatus>;

interface UseMemberStatusPollingOptions {
  organizationId: string;
  memberIds: string[];
  /** Polling interval in milliseconds. Default: 30000 (30 seconds) */
  interval?: number;
  /** Enable or disable polling. Default: true */
  enabled?: boolean;
}

export function useMemberStatusPolling({
  organizationId,
  memberIds,
  interval = 30000,
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

        // If clocked in, find the last clock_in timestamp
        let clockInTime: string | null = null;
        if (isClockedIn && lastEntry) {
          // Find the most recent clock_in entry
          const clockInEntry = memberEntries
            .filter(
              (e) => e.entryType === 'clock_in' && e.status === 'approved'
            )
            .sort(
              (a, b) =>
                new Date(b.timestamp).getTime() -
                new Date(a.timestamp).getTime()
            )[0];

          clockInTime = clockInEntry?.timestamp || null;
        }

        newStatusMap[memberId] = {
          isClockedIn,
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

  // Polling
  useEffect(() => {
    if (!enabled) return;

    const pollInterval = setInterval(fetchStatus, interval);
    return () => clearInterval(pollInterval);
  }, [fetchStatus, interval, enabled]);

  // Listen for clock status refresh events (e.g., from manual entry dialog)
  useEffect(() => {
    const handleRefresh = () => {
      fetchStatus();
    };

    window.addEventListener(CLOCK_STATUS_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(CLOCK_STATUS_REFRESH_EVENT, handleRefresh);
    };
  }, [fetchStatus]);

  return {
    statusMap,
    isLoading,
    error,
    refetch: fetchStatus
  };
}

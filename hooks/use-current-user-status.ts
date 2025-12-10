'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  hasOpenSession,
  getLastEntry,
  calculateTotalMinutes
} from '@/lib/time-tracking/helpers';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import { CLOCK_STATUS_REFRESH_EVENT } from '@/components/clock-fab';

export type CurrentUserStatus = {
  isClockedIn: boolean;
  clockInTime: string | null;
  todayMinutes: number;
};

interface UseCurrentUserStatusOptions {
  organizationId: string;
  userId: string;
  /** Polling interval in milliseconds. Default: 30000 (30 seconds) */
  interval?: number;
  /** Enable or disable polling. Default: true */
  enabled?: boolean;
}

export function useCurrentUserStatus({
  organizationId,
  userId,
  interval = 30000,
  enabled = true
}: UseCurrentUserStatusOptions): {
  status: CurrentUserStatus;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [status, setStatus] = useState<CurrentUserStatus>({
    isClockedIn: false,
    clockInTime: null,
    todayMinutes: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!organizationId || !userId) {
      setIsLoading(false);
      return;
    }

    try {
      // Get today's date range
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Fetch entries via server action (same as useMemberStatusPolling)
      const result = await getTimeEntries({
        organizationId,
        from: today.toISOString(),
        to: tomorrow.toISOString(),
        userId
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      const userEntries = result.entries || [];

      const isClockedIn = hasOpenSession(userEntries);
      const lastEntry = getLastEntry(userEntries);
      const sessions = calculateWorkSessions(userEntries);
      const todayMinutes = calculateTotalMinutes(sessions);

      // If clocked in, find the last active clock_in timestamp
      // Include both approved AND pending entries since pending entries take immediate effect
      let clockInTime: string | null = null;
      if (isClockedIn && lastEntry) {
        const clockInEntry = userEntries
          .filter(
            (e) =>
              e.entryType === 'clock_in' &&
              (e.status === 'approved' || e.status === 'pending')
          )
          .sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          )[0];

        clockInTime = clockInEntry?.timestamp || null;
      }

      setStatus({
        isClockedIn,
        clockInTime,
        todayMinutes
      });
      setError(null);
    } catch (err) {
      console.error('Error fetching user status:', err);
      setError('Failed to fetch status');
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, userId]);

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
    status,
    isLoading,
    error,
    refetch: fetchStatus
  };
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  calculateBreakMinutes,
  calculateBreakSessions,
  deriveCurrentClockState,
  calculateTotalMinutes
} from '@/lib/time-tracking/helpers';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';

export type CurrentUserStatus = {
  status: 'clocked_out' | 'working' | 'on_break';
  isClockedIn: boolean;
  isOnBreak: boolean;
  clockInTime: string | null;
  statusStartedAt: string | null;
  todayMinutes: number;
  workMinutes: number;
  breakMinutes: number;
};

interface UseCurrentUserStatusOptions {
  organizationId: string;
  userId: string;
  /** Enable or disable fetching. Default: true */
  enabled?: boolean;
}

export function useCurrentUserStatus({
  organizationId,
  userId,
  enabled = true
}: UseCurrentUserStatusOptions): {
  status: CurrentUserStatus;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [status, setStatus] = useState<CurrentUserStatus>({
    status: 'clocked_out',
    isClockedIn: false,
    isOnBreak: false,
    clockInTime: null,
    statusStartedAt: null,
    todayMinutes: 0,
    workMinutes: 0,
    breakMinutes: 0
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

      const currentState = deriveCurrentClockState(userEntries);
      const workSessions = calculateWorkSessions(userEntries);
      const breakSessions = calculateBreakSessions(userEntries);
      const workMinutes = calculateTotalMinutes(workSessions);
      const breakMinutes = calculateBreakMinutes(breakSessions);
      const todayMinutes = workMinutes + breakMinutes;

      setStatus({
        status: currentState.status,
        isClockedIn: currentState.isClockedIn,
        isOnBreak: currentState.isOnBreak,
        clockInTime: currentState.clockInTime,
        statusStartedAt: currentState.statusStartedAt,
        todayMinutes,
        workMinutes,
        breakMinutes
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

  // Realtime: refetch when time entries change
  useRealtimeEvent('time_entries', fetchStatus);

  return {
    status,
    isLoading,
    error,
    refetch: fetchStatus
  };
}

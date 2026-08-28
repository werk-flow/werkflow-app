'use client';

import {
  calculateBreakMinutes,
  calculateBreakSessions,
  deriveCurrentClockState,
  calculateTotalMinutes
} from '@/lib/time-tracking/helpers';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';

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

const CLOCKED_OUT_STATUS: CurrentUserStatus = {
  status: 'clocked_out',
  isClockedIn: false,
  isOnBreak: false,
  clockInTime: null,
  statusStartedAt: null,
  todayMinutes: 0,
  workMinutes: 0,
  breakMinutes: 0
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
  const view = useLiveView<CurrentUserStatus>({
    tables: ['time_entries'],
    read: async (): Promise<LiveViewResult<CurrentUserStatus>> => {
      if (!organizationId || !userId) {
        return { ok: true, data: CLOCKED_OUT_STATUS };
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const result = await getTimeEntries({
        organizationId,
        from: today.toISOString(),
        to: tomorrow.toISOString(),
        userId
      });

      if (!result.success) {
        return { ok: false, error: result.error };
      }

      const userEntries = result.entries || [];

      const currentState = deriveCurrentClockState(userEntries);
      const workSessions = calculateWorkSessions(userEntries);
      const breakSessions = calculateBreakSessions(userEntries);
      const workMinutes = calculateTotalMinutes(workSessions);
      const breakMinutes = calculateBreakMinutes(breakSessions);
      const todayMinutes = workMinutes + breakMinutes;

      return {
        ok: true,
        data: {
          status: currentState.status,
          isClockedIn: currentState.isClockedIn,
          isOnBreak: currentState.isOnBreak,
          clockInTime: currentState.clockInTime,
          statusStartedAt: currentState.statusStartedAt,
          todayMinutes,
          workMinutes,
          breakMinutes
        }
      };
    },
    enabled,
    resetKey: `${organizationId}:${userId}`
  });

  return {
    status: view.data ?? CLOCKED_OUT_STATUS,
    isLoading: view.isLoading,
    error: view.error,
    refetch: view.refresh
  };
}

'use client';

// P1-07: the one counting pipeline behind every attention badge. Replaces the
// former time-only PendingApprovalCountProvider; counts come from the same
// server-side derivation as the /aufgaben surface, so a badge can never count
// an item its viewer cannot act on.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { useOrganization } from '@/components/organization/organization-context';
import { getAttentionCounts } from '@/lib/attention/actions';
import type { AttentionCounts } from '@/lib/attention/types';
import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';

const ZERO_COUNTS: AttentionCounts = {
  actionableCount: 0,
  approvalsCount: 0,
  unreadNotificationCount: 0,
};

type AttentionCountContextValue = AttentionCounts & {
  refreshAttentionCounts: () => Promise<void>;
};

const AttentionCountContext =
  createContext<AttentionCountContextValue | null>(null);

export function AttentionCountProvider({
  children,
  initialCounts,
  initialOrganizationId,
}: {
  children: ReactNode;
  initialCounts?: AttentionCounts;
  initialOrganizationId?: string | null;
}) {
  const { activeOrgId } = useOrganization();
  const [counts, setCounts] = useState<AttentionCounts>(
    initialCounts ?? ZERO_COUNTS
  );
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshGenerationRef = useRef(0);
  const skippedInitialRefreshRef = useRef(false);
  const lastOrgIdRef = useRef<string | null | undefined>(
    initialOrganizationId
  );

  const refreshAttentionCounts = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    if (!activeOrgId) {
      setCounts(ZERO_COUNTS);
      return;
    }

    try {
      const result = await getAttentionCounts();
      // Keep the last-known counts on transient failures (documented rule
      // since P1-04/P1-05): a badge briefly showing stale numbers is better
      // than one that silently claims "nothing to do".
      if (result.success && generation === refreshGenerationRef.current) {
        setCounts(result.counts);
      }
    } catch (error) {
      console.error('Error fetching attention counts:', error);
    }
  }, [activeOrgId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshAttentionCounts();
    }, 150);
  }, [refreshAttentionCounts]);

  useEffect(() => {
    // A pending debounced refresh from the previous organization must never
    // fire into the new one.
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (
      activeOrgId &&
      activeOrgId === initialOrganizationId &&
      initialCounts !== undefined &&
      !skippedInitialRefreshRef.current
    ) {
      skippedInitialRefreshRef.current = true;
      return;
    }

    // Switching organizations resets to zero immediately: the previous
    // organization's numbers are wrong for the new one, and an honest zero
    // beats a stale claim while the fetch is in flight. Keep-last-known
    // stays reserved for transient failures within the SAME organization.
    if (lastOrgIdRef.current !== activeOrgId) {
      lastOrgIdRef.current = activeOrgId;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting on org change is the core responsibility of this provider effect
      setCounts(ZERO_COUNTS);
    }

    void refreshAttentionCounts();
  }, [
    activeOrgId,
    initialOrganizationId,
    initialCounts,
    refreshAttentionCounts,
  ]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [scheduleRefresh]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  useRealtimeEvent('time_entries', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('entry_change_requests', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('vacation_requests', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('sickness_reports', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('employee_capabilities', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('organization_capabilities', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('client_requests', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('client_follow_ups', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('planning_dispatches', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('planning_dispatch_acknowledgements', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('work_blockers', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('attention_read_states', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('organization_responsibility_configurations', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('organization_responsibility_assignments', () => {
    scheduleRefresh();
  });
  useRealtimeEvent('organization_responsibility_delegations', () => {
    scheduleRefresh();
  });
  useBusinessDayRefresh(scheduleRefresh);

  const value = useMemo<AttentionCountContextValue>(
    () => ({
      ...counts,
      refreshAttentionCounts,
    }),
    [counts, refreshAttentionCounts]
  );

  return (
    <AttentionCountContext.Provider value={value}>
      {children}
    </AttentionCountContext.Provider>
  );
}

export function useAttentionCounts() {
  const context = useContext(AttentionCountContext);
  if (!context) {
    throw new Error(
      'useAttentionCounts must be used within AttentionCountProvider'
    );
  }

  return context;
}

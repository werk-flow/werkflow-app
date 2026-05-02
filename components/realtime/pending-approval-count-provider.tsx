'use client';

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
import { getPendingApprovalCount } from '@/lib/time-tracking/actions';

type PendingApprovalCountContextValue = {
  pendingApprovalCount: number;
  refreshPendingApprovalCount: () => Promise<void>;
};

const PendingApprovalCountContext =
  createContext<PendingApprovalCountContextValue | null>(null);

export function PendingApprovalCountProvider({
  children,
  initialPendingApprovalCount,
  initialOrganizationId,
}: {
  children: ReactNode;
  initialPendingApprovalCount?: number;
  initialOrganizationId?: string | null;
}) {
  const { activeOrgId, activeOrg } = useOrganization();
  const [pendingApprovalCount, setPendingApprovalCount] = useState(
    initialPendingApprovalCount ?? 0
  );
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canViewPendingApprovals =
    activeOrg?.role === 'admin' || activeOrg?.role === 'buero';

  const refreshPendingApprovalCount = useCallback(async () => {
    if (!activeOrgId || !canViewPendingApprovals) {
      setPendingApprovalCount(0);
      return;
    }

    try {
      const nextCount = await getPendingApprovalCount(activeOrgId, activeOrg?.role === 'admin');
      setPendingApprovalCount(nextCount);
    } catch (error) {
      console.error('Error fetching pending approval count:', error);
    }
  }, [activeOrg?.role, activeOrgId, canViewPendingApprovals]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshPendingApprovalCount();
    }, 150);
  }, [refreshPendingApprovalCount]);

  useEffect(() => {
    if (
      activeOrgId &&
      activeOrgId === initialOrganizationId &&
      initialPendingApprovalCount !== undefined
    ) {
      setPendingApprovalCount(initialPendingApprovalCount);
      return;
    }

    void refreshPendingApprovalCount();
  }, [
    activeOrgId,
    initialOrganizationId,
    initialPendingApprovalCount,
    refreshPendingApprovalCount,
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

  const value = useMemo<PendingApprovalCountContextValue>(
    () => ({
      pendingApprovalCount,
      refreshPendingApprovalCount,
    }),
    [pendingApprovalCount, refreshPendingApprovalCount]
  );

  return (
    <PendingApprovalCountContext.Provider value={value}>
      {children}
    </PendingApprovalCountContext.Provider>
  );
}

export function usePendingApprovalCount() {
  const context = useContext(PendingApprovalCountContext);
  if (!context) {
    throw new Error(
      'usePendingApprovalCount must be used within PendingApprovalCountProvider'
    );
  }

  return context;
}

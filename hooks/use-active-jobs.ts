'use client';

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  createContext,
  useContext,
  useRef,
} from 'react';
import { getActiveJobIdsForOrg } from '@/lib/time-tracking/actions';
import { useOrganization } from '@/components/organization/organization-context';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';

type ActiveJobsContextValue = {
  activeJobIds: Set<string>;
  isLoading: boolean;
};

export const ActiveJobsContext = createContext<ActiveJobsContextValue>({
  activeJobIds: new Set(),
  isLoading: true,
});

export function useActiveJobs() {
  return useContext(ActiveJobsContext);
}

export function useActiveJobsProvider({
  initialActiveJobIds,
  initialOrganizationId,
}: {
  initialActiveJobIds?: string[];
  initialOrganizationId?: string | null;
} = {}) {
  const { activeOrgId } = useOrganization();
  const [activeJobIds, setActiveJobIds] = useState<Set<string>>(
    new Set(initialActiveJobIds ?? [])
  );
  const [isLoading, setIsLoading] = useState(!initialActiveJobIds);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchActiveJobs = useCallback(async () => {
    if (!activeOrgId) {
      setActiveJobIds(new Set());
      setIsLoading(false);
      return;
    }

    try {
      const result = await getActiveJobIdsForOrg(activeOrgId);
      if (result.success) {
        setActiveJobIds(new Set(result.activeJobIds));
      }
    } catch (err) {
      console.error('Error fetching active job ids:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId]);

  const scheduleFetchActiveJobs = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void fetchActiveJobs();
    }, 150);
  }, [fetchActiveJobs]);

  useEffect(() => {
    if (
      activeOrgId &&
      activeOrgId === initialOrganizationId &&
      initialActiveJobIds
    ) {
      setActiveJobIds(new Set(initialActiveJobIds));
      setIsLoading(false);
      return;
    }

    void fetchActiveJobs();
  }, [activeOrgId, fetchActiveJobs, initialActiveJobIds, initialOrganizationId]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleFetchActiveJobs();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [scheduleFetchActiveJobs]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  useRealtimeEvent('time_entries', () => {
    scheduleFetchActiveJobs();
  });

  return useMemo(() => ({ activeJobIds, isLoading }), [activeJobIds, isLoading]);
}

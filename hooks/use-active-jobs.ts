'use client';

import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
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

export function useActiveJobsProvider() {
  const { activeOrgId } = useOrganization();
  const [activeJobIds, setActiveJobIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

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

  useEffect(() => {
    fetchActiveJobs();
  }, [fetchActiveJobs]);

  useRealtimeEvent('time_entries', fetchActiveJobs);

  return useMemo(() => ({ activeJobIds, isLoading }), [activeJobIds, isLoading]);
}

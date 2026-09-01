'use client';

import { createContext, useContext, useMemo } from 'react';
import { getActiveJobIdsForOrg } from '@/lib/time-tracking/actions';
import { useOrganization } from '@/components/organization/organization-context';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';

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

  const view = useLiveView<string[]>({
    tables: ['time_entries', 'time_sessions', 'time_segments'],
    read: async (): Promise<LiveViewResult<string[]>> => {
      if (!activeOrgId) return { ok: true, data: [] };
      const result = await getActiveJobIdsForOrg(activeOrgId);
      return result.success
        ? { ok: true, data: result.activeJobIds }
        : { ok: false };
    },
    initialData:
      activeOrgId && activeOrgId === initialOrganizationId
        ? initialActiveJobIds
        : undefined,
    resetKey: activeOrgId,
  });

  const activeJobIds = useMemo(
    () => new Set(view.data ?? []),
    [view.data]
  );

  return useMemo(
    () => ({ activeJobIds, isLoading: view.isLoading }),
    [activeJobIds, view.isLoading]
  );
}

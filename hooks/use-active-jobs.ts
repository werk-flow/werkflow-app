'use client';

import { createContext, useContext, useMemo } from 'react';
import { getActiveJobIdsForOrg } from '@/lib/time-tracking/state-client';
import { useOrganization } from '@/components/organization/organization-context';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';

type ActiveJobsContextValue = {
  activeJobIds: Set<string>;
  activeProjectIds: Set<string>;
  isLoading: boolean;
};

export const ActiveJobsContext = createContext<ActiveJobsContextValue>({
  activeJobIds: new Set(),
  activeProjectIds: new Set(),
  isLoading: true,
});

export function useActiveJobs() {
  return useContext(ActiveJobsContext);
}

export function useActiveJobsProvider({
  initialActiveJobIds,
  initialActiveProjectIds,
  initialOrganizationId,
}: {
  initialActiveJobIds?: string[] | undefined;
  initialActiveProjectIds?: string[] | undefined;
  initialOrganizationId?: string | null | undefined;
} = {}) {
  const { activeOrgId } = useOrganization();

  const view = useLiveView<{ jobIds: string[]; projectIds: string[] }>({
    tables: ['time_entries', 'time_sessions', 'time_segments', 'jobs'],
    read: async ({ signal }): Promise<LiveViewResult<{ jobIds: string[]; projectIds: string[] }>> => {
      if (!activeOrgId) return { ok: true, data: { jobIds: [], projectIds: [] } };
      const result = await getActiveJobIdsForOrg(activeOrgId, signal);
      return result.success
        ? { ok: true, data: { jobIds: result.activeJobIds, projectIds: result.activeProjectIds } }
        : { ok: false };
    },
    initialData:
      activeOrgId && activeOrgId === initialOrganizationId
        ? { jobIds: initialActiveJobIds ?? [], projectIds: initialActiveProjectIds ?? [] }
        : undefined,
    resetKey: activeOrgId,
  });

  const activeJobIds = useMemo(
    () => new Set(view.data?.jobIds ?? []),
    [view.data]
  );

  const activeProjectIds = useMemo(() => new Set(view.data?.projectIds ?? []), [view.data]);
  return useMemo(
    () => ({ activeJobIds, activeProjectIds, isLoading: view.isLoading }),
    [activeJobIds, activeProjectIds, view.isLoading]
  );
}

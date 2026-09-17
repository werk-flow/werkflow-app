'use client';

import type { ReactNode } from 'react';
import { ActiveJobsContext, useActiveJobsProvider } from '@/hooks/use-active-jobs';

export function ActiveJobsProvider({
  children,
  initialActiveJobIds,
  initialActiveProjectIds,
  initialOrganizationId,
}: {
  children: ReactNode;
  initialActiveJobIds?: string[];
  initialActiveProjectIds?: string[];
  initialOrganizationId?: string | null;
}) {
  const value = useActiveJobsProvider({
    initialActiveJobIds,
    initialActiveProjectIds,
    initialOrganizationId,
  });

  return (
    <ActiveJobsContext.Provider value={value}>
      {children}
    </ActiveJobsContext.Provider>
  );
}

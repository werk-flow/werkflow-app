'use client';

import type { ReactNode } from 'react';
import { ActiveJobsContext, useActiveJobsProvider } from '@/hooks/use-active-jobs';

export function ActiveJobsProvider({
  children,
  initialActiveJobIds,
  initialOrganizationId,
}: {
  children: ReactNode;
  initialActiveJobIds?: string[];
  initialOrganizationId?: string | null;
}) {
  const value = useActiveJobsProvider({
    initialActiveJobIds,
    initialOrganizationId,
  });

  return (
    <ActiveJobsContext.Provider value={value}>
      {children}
    </ActiveJobsContext.Provider>
  );
}

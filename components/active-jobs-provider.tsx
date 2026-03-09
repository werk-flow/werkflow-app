'use client';

import type { ReactNode } from 'react';
import { ActiveJobsContext, useActiveJobsProvider } from '@/hooks/use-active-jobs';

export function ActiveJobsProvider({ children }: { children: ReactNode }) {
  const value = useActiveJobsProvider();

  return (
    <ActiveJobsContext.Provider value={value}>
      {children}
    </ActiveJobsContext.Provider>
  );
}

'use client';

import type { ReactElement, ReactNode } from 'react';

import { useRouterRefresh } from '@/components/ui/refresh-button';
import { SectionError } from '@/components/ui/section-error';

/**
 * `SectionError` for a region that a server component failed to load: the
 * retry re-reads the route, so the server component runs again while the rest
 * of the page stays on screen (loading canon: sections fail independently).
 */
export function RegionLoadError({
  title,
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: ReactNode;
}): ReactElement {
  const { refresh, isPending } = useRouterRefresh();
  return (
    <SectionError
      {...(title ? { title } : {})}
      {...(className ? { className } : {})}
      onRetry={refresh}
      retryPending={isPending}
    >
      {children}
    </SectionError>
  );
}

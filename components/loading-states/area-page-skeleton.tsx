import type { ReactElement, ReactNode } from 'react';

import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Org-switch overlay for an area with subpages (Zeiterfassung, Service): the
 * area `layout.tsx` shape (title, `h-9` route-tab strip, padded scroll body)
 * around the subpage's own content skeleton. Route `loading.tsx` files render
 * the content skeleton alone, because there the real layout stays mounted.
 */
export function AreaPageSkeleton({
  title,
  tabCount,
  children,
}: {
  title: string;
  tabCount: number;
  children: ReactNode;
}): ReactElement {
  return (
    <PageShell>
      <PageHeader
        title={title}
        nav={
          <div className="flex h-9 items-center gap-1">
            {Array.from({ length: tabCount }).map((_, index) => (
              <Skeleton key={index} className="mx-3 h-4 w-20" />
            ))}
          </div>
        }
      />
      <PageBody>{children}</PageBody>
    </PageShell>
  );
}

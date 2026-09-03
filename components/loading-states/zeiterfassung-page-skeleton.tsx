import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { ZeiterfassungOverviewSkeleton } from './zeiterfassung-content-skeleton';

/** Org-switch overlay for /zeiterfassung: the area header shape (title bar, `h-9` nav strip) over the overview content. */
export function ZeiterfassungPageSkeleton() {
  return (
    <PageShell>
      <header className="shrink-0 border-b px-4 pt-3 sm:px-6 sm:pt-4">
        <div className="pb-2">
          <Skeleton className="h-7 w-36 sm:h-8" />
        </div>
        <div className="flex h-9 items-center gap-1">
          <Skeleton className="mx-3 h-4 w-24" />
          <Skeleton className="mx-3 h-4 w-16" />
          <Skeleton className="mx-3 h-4 w-16" />
          <Skeleton className="mx-3 h-4 w-28" />
        </div>
      </header>

      <PageBody>
        <ZeiterfassungOverviewSkeleton />
      </PageBody>
    </PageShell>
  );
}

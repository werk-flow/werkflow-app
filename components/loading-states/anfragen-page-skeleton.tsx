import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export function AnfragenContentSkeleton() {
  return (
    <>
      {/* Filter strip: status tabs, then search and refresh; stacks below sm like the live strip. */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex h-9 w-fit max-w-full items-center gap-1 overflow-hidden rounded-md bg-muted/50 p-0.5">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-14" />
        </div>
        <div className="flex min-w-0 items-center gap-2 sm:flex-1 sm:justify-end">
          <Skeleton className="h-8 min-w-0 flex-1 sm:max-w-xs" />
          <Skeleton className="size-8 shrink-0" />
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-24" />
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    </>
  );
}

export function AnfragenPageSkeleton() {
  return (
    <PageShell>
      <PageHeader title="Anfragen" actions={<Skeleton className="h-9 w-32" />} />
      <PageBody>
        <AnfragenContentSkeleton />
      </PageBody>
    </PageShell>
  );
}

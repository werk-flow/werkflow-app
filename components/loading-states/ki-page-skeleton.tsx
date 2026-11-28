import { KiTimelineSkeleton } from '@/components/loading-states/ki-timeline-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { AI_PRODUCT_NAME } from '@/lib/ai/name';

// Mirrors `KiChat`: the thread list beside the timeline from the tablet
// breakpoint on, and the composer under it.
export function KiChatSkeleton() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="hidden w-64 shrink-0 flex-col gap-4 border-r p-4 md:flex">
        <Skeleton className="h-9 w-full rounded-md" />
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-5 w-40" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <PageBody maxWidth="content">
          <KiTimelineSkeleton />
        </PageBody>
        <div className="shrink-0 space-y-2 border-t p-4">
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      </div>
    </div>
  );
}

export function KiPageSkeleton() {
  return (
    <PageShell>
      <PageHeader title={AI_PRODUCT_NAME} />
      <KiChatSkeleton />
    </PageShell>
  );
}

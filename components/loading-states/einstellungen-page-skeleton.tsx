import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export function EinstellungenContentSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}

export function EinstellungenPageSkeleton() {
  return (
    <PageShell>
      <header className="border-b px-4 py-4 sm:px-6">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-2 h-8 w-64" />
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-56 shrink-0 space-y-2 border-r p-4 lg:block">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </aside>
        <PageBody>
          <div className="mx-auto w-full max-w-5xl">
            <EinstellungenContentSkeleton />
          </div>
        </PageBody>
      </div>
    </PageShell>
  );
}

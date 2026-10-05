import { AuftraegeTableSkeleton } from '@/components/auftraege/list/unified-auftraege-table';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function KundenDetailLoading() {
  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: 'Kunden', href: '/kunden' }]}
        title={<Skeleton className="h-7 w-48 sm:h-8" />}
        badges={<Skeleton className="h-5 w-24 rounded-full" />}
        subtitle={<Skeleton className="h-4 w-44" />}
        actions={<Skeleton className="size-8" />}
      />

      <PageBody>
        <div className="@container/detail">
          <div className="grid grid-cols-1 gap-6 @7xl/detail:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            {/* Cards: stacked, a row where the content is wide enough, stacked again beside the table */}
            <div className="grid grid-cols-1 gap-6 @3xl/detail:grid-cols-2 @7xl/detail:grid-cols-1">
              {/* Kundendetails card */}
              <div className="rounded-lg border bg-card p-4 sm:p-5">
                <Skeleton className="mb-3 h-4 w-28" />
                <div className="grid gap-3">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="grid gap-0.5">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-5 w-full max-w-[220px]" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Financial + Documents placeholder */}
              <div className="space-y-3">
                <div className="rounded-lg border bg-card p-4 sm:p-5">
                  <Skeleton className="mb-3 h-4 w-20" />
                  <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-16 rounded-lg" />
                    <Skeleton className="h-16 rounded-lg" />
                    <Skeleton className="h-16 rounded-lg" />
                    <Skeleton className="h-16 rounded-lg" />
                  </div>
                  <Skeleton className="mt-3 mx-auto h-3 w-48" />
                </div>

                <div className="rounded-lg border bg-card p-4 sm:p-5">
                  <Skeleton className="mb-3 h-4 w-24" />
                  <div className="flex flex-col items-center justify-center py-4">
                    <Skeleton className="size-8 rounded mb-2" />
                    <Skeleton className="h-3 w-48" />
                    <Skeleton className="mt-1 h-3 w-36" />
                  </div>
                </div>
              </div>
            </div>

            {/* Table: full width below the cards, right column where the content is wide enough */}
            <div className="min-w-0 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Skeleton className="size-4" />
                  <Skeleton className="h-4 w-56" />
                </div>
                <Skeleton className="h-8 w-32 rounded-md" />
              </div>
              {/* Status pills */}
              <div className="flex gap-1.5">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-28 rounded-full" />
              </div>
              {/* Search bar */}
              <Skeleton className="h-9 w-full rounded-md" />
              <AuftraegeTableSkeleton count={5} showActions />
            </div>
          </div>
        </div>
      </PageBody>
    </PageShell>
  );
}

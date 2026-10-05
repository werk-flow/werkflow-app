import { AuftraegeTableSkeleton } from '@/components/auftraege/list/unified-auftraege-table';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function MitarbeiterDetailLoading() {
  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: 'Mitarbeiter', href: '/mitarbeiter' }]}
        title={<Skeleton className="h-7 w-48 sm:h-8" />}
        badges={<Skeleton className="h-5 w-24 rounded-full" />}
        subtitle={<Skeleton className="h-4 w-40" />}
        actions={<Skeleton className="size-8" />}
      />

      <PageBody>
        <div className="@container/detail">
          <div className="grid grid-cols-1 gap-6 @7xl/detail:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            {/* Cards: stacked, a row where the content is wide enough, stacked again beside the table */}
            <div className="grid grid-cols-1 gap-6 @[70rem]/detail:grid-cols-3 @7xl/detail:grid-cols-1">
              {/* Profile card */}
              <div className="rounded-lg border bg-card p-4 sm:p-5">
                <Skeleton className="mb-3 h-4 w-16" />
                <div className="grid gap-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="grid gap-0.5">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-5 w-full max-w-[200px]" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Status card */}
              <div className="rounded-lg border bg-card p-4 sm:p-5">
                <Skeleton className="mb-3 h-4 w-32" />
                <div className="flex items-center gap-3">
                  <Skeleton className="h-5 w-28 rounded-full" />
                </div>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-2.5 w-full rounded-full" />
                  <Skeleton className="h-3 w-10 ml-auto" />
                </div>
              </div>

              {/* Anwesenheit placeholder card */}
              <div className="rounded-lg border bg-card p-4 sm:p-5">
                <Skeleton className="mb-3 h-4 w-36" />
                <div className="flex flex-col items-center justify-center py-4">
                  <Skeleton className="size-8 rounded mb-2" />
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="mt-1 h-3 w-36" />
                </div>
              </div>
            </div>

            {/* Table: full width below the cards, right column where the content is wide enough */}
            <div className="min-w-0 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Skeleton className="size-4" />
                  <Skeleton className="h-4 w-40" />
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

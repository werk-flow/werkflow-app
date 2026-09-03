import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList } from '@/components/ui/skeleton-table';

export default function ProjectDetailLoading() {
  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: 'Aufträge', href: '/auftraege' }]}
        title={<Skeleton className="h-7 w-48 sm:h-8" />}
        badges={
          <>
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </>
        }
        actions={<Skeleton className="h-9 w-36" />}
      />

      {/* Two-column layout skeleton */}
      <PageBody>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
          {/* Left column */}
          <div className="space-y-6">
            {/* Metadata card */}
            <div className="rounded-lg border bg-card p-4 sm:p-5">
              <Skeleton className="mb-3 h-4 w-20" />
              <div className="grid gap-3">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="grid gap-0.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-5 w-full max-w-[200px]" />
                  </div>
                ))}
              </div>
            </div>
            {/* Client card */}
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="size-5" />
                <div className="space-y-1">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Progress hero */}
            <div className="rounded-lg border bg-muted/30 p-6">
              <div className="flex items-center justify-between">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-8 w-14 rounded-full" />
              </div>
              <Skeleton className="mt-4 h-3 w-full rounded-full" />
              <div className="mt-3 flex gap-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-28" />
              </div>
            </div>
            {/* Child jobs: a list of link rows, so the placeholders hover too */}
            <div className="rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-7 w-20" />
              </div>
              <SkeletonList count={4} interactive className="p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Skeleton className="h-4 w-24 rounded-full" />
                    <Skeleton className="h-4 w-14 rounded-full" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              </SkeletonList>
            </div>
            {/* Placeholder sections */}
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
      </PageBody>
    </PageShell>
  );
}

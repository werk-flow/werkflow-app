import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

// Mirrors the manager job detail. Employees get the field work pack at the
// same route (one wider column instead of two), so for them this loading
// state is a deliberate approximation: the role is only known once the data
// boundary resolves.
export default function JobDetailLoading() {
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
        actions={<Skeleton className="size-8" />}
      />

      {/* Two-column layout skeleton */}
      <PageBody>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
          {/* Left column */}
          <div className="space-y-6">
            {/* Metadata card */}
            <div className="rounded-lg border bg-card p-4 sm:p-5">
              <Skeleton className="mb-3 h-4 w-20" />
              <div className="grid gap-3">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="grid gap-0.5">
                    <Skeleton className="h-3 w-24" />
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
            {/* Employees section */}
            <div className="rounded-lg border bg-card p-4">
              <Skeleton className="mb-3 h-5 w-40" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <Skeleton className="size-8 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
              ))}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Project link */}
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="size-5" />
                <div className="space-y-1">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </div>
            {/* Placeholders */}
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
      </PageBody>
    </PageShell>
  );
}

import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Mirrors `OwnQualificationOverview`: the team badge row and the two-column
// qualification cards. Nothing on that page is clickable, so nothing hovers.
export function QualifikationenContentSkeleton() {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-4" />
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-[22px] w-24 rounded-md" />
          <Skeleton className="h-[22px] w-20 rounded-md" />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-4" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index} className="gap-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-[22px] w-16 rounded-md" />
              </div>
              <Skeleton className="h-4 w-48 max-w-full" />
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

export function QualifikationenPageSkeleton() {
  return (
    <PageShell>
      <PageHeader
        title="Qualifikationen"
        subtitle="Deine Teams, Fähigkeiten und Zertifizierungen im Überblick."
      />
      <PageBody>
        <QualifikationenContentSkeleton />
      </PageBody>
    </PageShell>
  );
}

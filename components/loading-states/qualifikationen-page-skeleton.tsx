import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export function QualifikationenContentSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
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

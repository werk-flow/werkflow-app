import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export function AufgabenContentSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function AufgabenPageSkeleton() {
  return (
    <PageShell>
      <PageHeader title="Aufgaben" />
      <PageBody>
        <AufgabenContentSkeleton />
      </PageBody>
    </PageShell>
  );
}

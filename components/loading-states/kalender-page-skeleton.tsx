import { KalenderContentSkeleton } from '@/components/loading-states/kalender-content-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export function KalenderPageSkeleton() {
  return (
    <PageShell>
      <PageHeader title="Kalender" actions={<Skeleton className="h-9 w-32" />} />
      <PageBody className="p-0 pb-0 sm:p-0 sm:pb-0 overflow-hidden">
        <KalenderContentSkeleton />
      </PageBody>
    </PageShell>
  );
}

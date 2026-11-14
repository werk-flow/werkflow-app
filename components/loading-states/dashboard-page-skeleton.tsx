import { DashboardContentSkeleton } from '@/components/loading-states/dashboard-content-skeleton';
import { OnCallNowSkeleton } from '@/components/loading-states/on-call-skeletons';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';

export function DashboardPageSkeleton() {
  return (
    <PageShell>
      <PageHeader title="Dashboard" />
      <PageBody className="space-y-4">
        <OnCallNowSkeleton />
        <DashboardContentSkeleton />
      </PageBody>
    </PageShell>
  );
}

import { DashboardContentSkeleton } from '@/components/loading-states/dashboard-content-skeleton'
import { PageHeader } from '@/components/shared/page-header'
import { PageBody, PageShell } from '@/components/shared/page-shell'

export function DashboardPageSkeleton() {
  return (
    <PageShell>
      <PageHeader title="Dashboard" />
      <PageBody>
        <DashboardContentSkeleton />
      </PageBody>
    </PageShell>
  )
}

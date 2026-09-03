import { AuftraegeContentSkeleton } from '@/components/loading-states/auftraege-content-skeleton'
import { PageHeader } from '@/components/shared/page-header'
import { PageBody, PageShell } from '@/components/shared/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export function AuftraegePageSkeleton() {
  return (
    <PageShell>
      <PageHeader title="Aufträge" actions={<Skeleton className="h-9 w-32" />} />
      <PageBody>
        <AuftraegeContentSkeleton />
      </PageBody>
    </PageShell>
  )
}

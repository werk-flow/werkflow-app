import { KundenContentSkeleton } from '@/components/loading-states/kunden-content-skeleton'
import { PageHeader } from '@/components/shared/page-header'
import { PageBody, PageShell } from '@/components/shared/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export function KundenPageSkeleton() {
  return (
    <PageShell>
      <PageHeader title="Kunden" actions={<Skeleton className="h-9 w-32" />} />
      <PageBody>
        <KundenContentSkeleton />
      </PageBody>
    </PageShell>
  )
}

import { MitarbeiterContentSkeleton } from '@/components/loading-states/mitarbeiter-content-skeleton'
import { PageHeader } from '@/components/shared/page-header'
import { PageBody, PageShell } from '@/components/shared/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export function MitarbeiterPageSkeleton() {
  return (
    <PageShell>
      <PageHeader
        title="Mitarbeiter"
        actions={
          <>
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-32" />
          </>
        }
      />
      <PageBody>
        <MitarbeiterContentSkeleton />
      </PageBody>
    </PageShell>
  )
}

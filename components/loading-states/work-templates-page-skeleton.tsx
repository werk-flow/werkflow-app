import { PageHeader } from '@/components/shared/page-header'
import { PageBody, PageShell } from '@/components/shared/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export function WorkTemplatesContentSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-20 w-full rounded-lg" />)}
      </div>
    </div>
  )
}

export function WorkTemplatesPageSkeleton() {
  return (
    <PageShell>
      <PageHeader
        title="Arbeitsvorlagen"
        subtitle="Wiederverwendbare Aufgaben, Materialplanung und Anforderungen für Aufträge und Projekte."
        actions={<Skeleton className="h-9 w-32" />}
      />
      <PageBody>
        <WorkTemplatesContentSkeleton />
      </PageBody>
    </PageShell>
  )
}

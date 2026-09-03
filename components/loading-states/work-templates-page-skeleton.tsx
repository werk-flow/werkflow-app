import { PageHeader } from '@/components/shared/page-header'
import { PageBody, PageShell } from '@/components/shared/page-shell'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// Template cards are not clickable as a whole (the name button and "Öffnen"
// are), so the placeholders carry no hover.
export function WorkTemplatesContentSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Card key={index} className="gap-3 py-4"><CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-[22px] w-16 rounded-md" /><Skeleton className="h-[22px] w-20 rounded-md" /></div>
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
            <div className="flex shrink-0 gap-2"><Skeleton className="h-9 w-20" /><Skeleton className="size-9" /></div>
          </CardContent></Card>
        ))}
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

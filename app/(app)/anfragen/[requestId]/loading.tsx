import { ContextualDocumentsSkeleton } from '@/components/dokumente/contextual-documents-layout';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

function FactCardSkeleton({ lines }: { lines: number }) {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <Skeleton className="h-4 w-24" />
      <div className="mt-3 space-y-1.5">
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton key={index} className="h-5 w-full max-w-64" />
        ))}
      </div>
    </div>
  );
}

// Mirrors RequestDetailContent: customer and detail cards side by side, the
// contextual documents section, then the history card.
export default function AnfrageDetailLoading() {
  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: 'Anfragen', href: '/anfragen' }]}
        title={<Skeleton className="h-7 w-64 max-w-full sm:h-8" />}
        badges={<Skeleton className="h-5 w-20 rounded-full" />}
        subtitle={<Skeleton className="h-4 w-72 max-w-full" />}
        actions={<Skeleton className="h-9 w-32" />}
      />
      <PageBody maxWidth="content">
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <FactCardSkeleton lines={4} />
            <FactCardSkeleton lines={5} />
          </div>
          <ContextualDocumentsSkeleton
            description="Fotos, Nachrichten oder Unterlagen zur Anfrage. Bei einer Umwandlung werden sie automatisch mit dem Auftrag oder Projekt verknüpft."
            canUpload
          />
          <div className="rounded-lg border bg-card p-4 sm:p-5">
            <Skeleton className="h-4 w-24" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex items-baseline gap-2">
                  <Skeleton className="h-4 w-28 shrink-0" />
                  <Skeleton className="h-4 w-56 max-w-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </PageBody>
    </PageShell>
  );
}

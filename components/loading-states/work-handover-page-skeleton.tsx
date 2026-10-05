import type { ReactElement } from 'react';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Route loading state of every handover page: the shell, header and section card of `WorkHandoverPage`. */
export function WorkHandoverPageSkeleton(): ReactElement {
  return (
    <PageShell className="bg-muted/20">
      <DetailPageHeader
        breadcrumbs={[{ label: 'Aufträge', href: '/auftraege' }, { label: 'Übergabeprüfung' }]}
        title={<Skeleton className="h-7 w-64 max-w-full" />}
        subtitle="Übergabeprüfung"
      />
      <PageBody maxWidth="wide">
        <Card className="gap-0 border py-0 shadow-xs" role="status" aria-label="Übergabe wird geladen">
          <div className="space-y-5 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Übergabe an das Büro</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Kundenfähige Inhalte auswählen, prüfen und als unveränderliche Freigabe sichern.
                </p>
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-4 w-48" />
              <div className="divide-y rounded-md border">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="flex items-start gap-3 p-3">
                    <Skeleton className="size-4" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-56 max-w-full" />
                      <Skeleton className="h-4 w-80 max-w-full" />
                    </div>
                  </div>
                ))}
              </div>
              <Skeleton className="h-9 w-44" />
            </div>
          </div>
        </Card>
      </PageBody>
    </PageShell>
  );
}

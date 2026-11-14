'use client';

import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { SearchableListSkeleton } from '@/components/shared/searchable-list-skeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { INVOICE_COLUMNS } from './invoices-columns';

/** The list page's subtitle, which its route skeleton shows too. */
export const INVOICES_SUBTITLE = 'Jede Rechnung mit Kunde, Rechnungsempfänger und Betrag.';

/** Toolbar, count and rows of the list. */
export function InvoicesListSkeleton() {
  return <SearchableListSkeleton columns={INVOICE_COLUMNS} />;
}

export function InvoicesPageSkeleton() {
  return (
    <PageShell>
      <PageHeader
        title="Rechnungen"
        subtitle={INVOICES_SUBTITLE}
        actions={<Skeleton className="h-11 w-44 sm:h-9" />}
      />
      <PageBody>
        <div role="status" aria-label="Rechnungen werden geladen">
          <span className="sr-only">Rechnungen werden geladen.</span>
          <InvoicesListSkeleton />
        </div>
      </PageBody>
    </PageShell>
  );
}

/** The draft's facts, two lines and the totals. */
export function InvoiceEditorSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-label="Rechnung wird geladen">
      <span className="sr-only">Rechnung wird geladen.</span>
      <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-3 sm:p-5">
        {['Kunde', 'Rechnungsempfänger', 'Abrechnen für'].map((fact) => (
          <div key={fact} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-40 max-w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-4">
        <Skeleton className="h-5 w-28" />
        <div className="divide-y rounded-lg border">
          {[0, 1].map((line) => (
            <div key={line} className="space-y-3 p-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="ml-auto w-full max-w-sm space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-5 w-full" />
      </div>
    </div>
  );
}

export function InvoicePageSkeleton() {
  return (
    <PageShell>
      <PageHeader title="Rechnungsentwurf" breadcrumbs={[{ label: 'Rechnungen', href: '/rechnungen' }]} />
      <PageBody>
        <InvoiceEditorSkeleton />
      </PageBody>
    </PageShell>
  );
}

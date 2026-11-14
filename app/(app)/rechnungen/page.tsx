import { Plus } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { InvoicesContent } from '@/components/rechnungen/invoices-content';
import { INVOICES_SUBTITLE, InvoicesListSkeleton } from '@/components/rechnungen/invoices-skeleton';
import { PageActionButton, PageActionProvider, PageActionUnavailable } from '@/components/shared/page-action';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { UrlFlashBanner } from '@/components/ui/banner';
import { parseInvoiceListQuery } from '@/lib/invoices/list-page';
import { readInvoicePage } from '@/lib/invoices/reads';
import { logError } from '@/lib/logging';
import { resolvePageMembership } from '@/lib/org/page-context';
import { isManagerRole } from '@/lib/roles';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function InvoicesData({
  organizationId,
  searchParams,
}: {
  organizationId: string;
  searchParams: SearchParams;
}) {
  const query = parseInvoiceListQuery(await searchParams);
  const page = await readInvoicePage(organizationId, query).catch((error: unknown) => {
    logError('rechnungen.read_failed', error);
    return null;
  });
  if (!page) {
    // The create dialog lives in InvoicesContent, so „Rechnung erstellen“ hides with it.
    return (
      <>
        <PageActionUnavailable />
        <RegionLoadError title="Rechnungen konnten nicht geladen werden">
          Die Liste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
        </RegionLoadError>
      </>
    );
  }
  return <InvoicesContent {...page} query={query} />;
}

export default async function InvoicesPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: SearchParams;
}) {
  const { membership } = await resolvePageMembership();
  // Invoices are office records: a field worker never opens this page.
  if (!membership || !isManagerRole(membership.role)) redirect('/dashboard');

  return (
    <PageActionProvider>
      <PageShell>
        <Suspense fallback={null}>
          <UrlFlashBanner
            paramKey="deleted_invoice"
            messageTemplate="Der Entwurf für „{name}“ wurde gelöscht."
          />
        </Suspense>
        <PageHeader
          title="Rechnungen"
          subtitle={INVOICES_SUBTITLE}
          actions={
            <PageActionButton>
              <Plus className="size-4" />
              Rechnung erstellen
            </PageActionButton>
          }
        />
        <PageBody>
          <Suspense fallback={<InvoicesListSkeleton />}>
            <InvoicesData organizationId={membership.orgId} searchParams={searchParams} />
          </Suspense>
        </PageBody>
      </PageShell>
    </PageActionProvider>
  );
}

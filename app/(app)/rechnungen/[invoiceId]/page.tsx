import { redirect } from 'next/navigation';

import { InvoiceEditor } from '@/components/rechnungen/invoice-editor';
import { DeleteInvoiceDraftButton, InvoiceFacts } from '@/components/rechnungen/invoice-header';
import { InvoiceStatusBadge } from '@/components/rechnungen/invoices-list';
import { InvoicePageSkeleton } from '@/components/rechnungen/invoices-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { RouteRedirect } from '@/components/shared/route-redirect';
import { readInvoice } from '@/lib/invoices/reads';
import { logError } from '@/lib/logging';
import { resolvePageMembership } from '@/lib/org/page-context';
import { isManagerRole } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation/uuid';

const BREADCRUMBS = [{ label: 'Rechnungen', href: '/rechnungen' }];

/** One invoice on its own route, so two drafts open in two tabs. */
export default async function InvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { membership } = await resolvePageMembership();
  if (!membership || !isManagerRole(membership.role)) redirect('/dashboard');
  const invoiceId = uuidSchema.safeParse((await params).invoiceId);
  const invoice = !invoiceId.success
    ? null
    : await readInvoice(membership.orgId, invoiceId.data).catch((error: unknown) => {
        logError('rechnung.read_failed', error);
        return 'failed' as const;
      });
  // No invoice id, another organization's invoice, or one that is gone: back to the list.
  if (!invoice) {
    return (
      <RouteRedirect href="/rechnungen">
        <InvoicePageSkeleton />
      </RouteRedirect>
    );
  }

  return (
    <PageShell>
      {invoice === 'failed' ? (
        <>
          <PageHeader title="Rechnungsentwurf" breadcrumbs={BREADCRUMBS} />
          <PageBody>
            <RegionLoadError title="Die Rechnung konnte nicht geladen werden">
              Die Rechnung ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
            </RegionLoadError>
          </PageBody>
        </>
      ) : (
        <>
          <PageHeader
            title={invoice.invoiceNumber ?? 'Rechnungsentwurf'}
            badges={<InvoiceStatusBadge status={invoice.status} />}
            breadcrumbs={BREADCRUMBS}
            actions={
              invoice.status === 'entwurf' ? <DeleteInvoiceDraftButton invoice={invoice} /> : undefined
            }
          />
          <PageBody>
            <div className="space-y-8">
              <InvoiceFacts invoice={invoice} />
              <InvoiceEditor key={invoice.id} invoice={invoice} />
            </div>
          </PageBody>
        </>
      )}
    </PageShell>
  );
}

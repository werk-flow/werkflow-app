import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { CancelInvoiceButton } from '@/components/rechnungen/invoice-cancel';
import { InvoiceChain } from '@/components/rechnungen/invoice-chain';
import { InvoiceDeliverySection } from '@/components/rechnungen/invoice-delivery-section';
import { InvoiceEditor } from '@/components/rechnungen/invoice-editor';
import { DeleteInvoiceDraftButton, InvoiceFacts } from '@/components/rechnungen/invoice-header';
import { IssuedInvoiceOriginal } from '@/components/rechnungen/invoice-issue';
import { InvoiceStatusBadge } from '@/components/rechnungen/invoices-list';
import { InvoiceDeliverySkeleton, InvoicePageSkeleton } from '@/components/rechnungen/invoices-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { RouteRedirect } from '@/components/shared/route-redirect';
import { readInvoice } from '@/lib/invoices/reads';
import type { InvoiceDetail } from '@/lib/invoices/types';
import { logError } from '@/lib/logging';
import { resolvePageMembership } from '@/lib/org/page-context';
import { isManagerRole } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation/uuid';

const BREADCRUMBS = [{ label: 'Rechnungen', href: '/rechnungen' }];

/** One invoice on its own route, so two drafts open in two tabs. */
export default async function InvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { user, membership } = await resolvePageMembership();
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
            title={invoiceTitle(invoice)}
            badges={<InvoiceStatusBadge status={invoice.status} />}
            breadcrumbs={BREADCRUMBS}
            actions={invoiceActions(invoice)}
          />
          <PageBody>
            <div className="space-y-8">
              {invoice.status !== 'entwurf' && <IssuedInvoiceOriginal invoice={invoice} />}
              {invoice.status !== 'entwurf' && invoice.original?.filed && (
                <Suspense fallback={<InvoiceDeliverySkeleton />}>
                  <InvoiceDeliverySection
                    caller={{ userId: user.id, orgId: membership.orgId, isManagerOrAbove: true }}
                    invoice={invoice}
                  />
                </Suspense>
              )}
              <InvoiceChain invoice={invoice} />
              <InvoiceFacts invoice={invoice} />
              <InvoiceEditor invoice={invoice} />
            </div>
          </PageBody>
        </>
      )}
    </PageShell>
  );
}

function invoiceTitle(invoice: InvoiceDetail): string {
  if (!invoice.invoiceNumber) return 'Rechnungsentwurf';
  return `${invoice.cancels ? 'Stornorechnung' : 'Rechnung'} ${invoice.invoiceNumber}`;
}

/**
 * A draft is deleted; an issued invoice that is no Stornorechnung and no
 * credit (cancel_invoice refuses a negative total) is cancelled or corrected.
 */
function invoiceActions(invoice: InvoiceDetail): React.ReactNode {
  if (invoice.status === 'entwurf') return <DeleteInvoiceDraftButton invoice={invoice} />;
  if (
    invoice.status !== 'ausgestellt' ||
    invoice.cancels ||
    invoice.grossCents < 0 ||
    !invoice.invoiceNumber
  ) {
    return undefined;
  }
  const issued = { id: invoice.id, invoiceNumber: invoice.invoiceNumber };
  return (
    <>
      <CancelInvoiceButton invoice={issued} mode="correct" />
      <CancelInvoiceButton invoice={issued} mode="cancel" />
    </>
  );
}

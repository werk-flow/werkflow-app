import { SectionTitle } from '@/components/shared/section-title';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { readDocumentDeliveries } from '@/lib/delivery/reads';
import { readInvoiceMailDefaults } from '@/lib/invoices/delivery-defaults';
import type { InvoiceDetail } from '@/lib/invoices/types';
import { logError } from '@/lib/logging';
import type { ActionContext } from '@/lib/org/action-context';
import { InvoiceDeliveries } from './invoice-delivery';

/**
 * „Versand“ of an issued invoice whose original is filed, or of a cancelled
 * invoice: its deliveries, and for an issued one what the email form
 * proposes. A failed read fails this section alone.
 */
export async function InvoiceDeliverySection({
  caller,
  invoice,
}: {
  caller: Pick<ActionContext, 'userId' | 'orgId' | 'isManagerOrAbove'>;
  invoice: InvoiceDetail;
}) {
  const loaded = await Promise.all([
    readDocumentDeliveries(caller.orgId, { kind: 'invoice', id: invoice.id }),
    invoice.status === 'storniert' ? null : readInvoiceMailDefaults(caller, invoice),
  ]).catch((error: unknown) => {
    logError('rechnung.versand_read_failed', error);
    return null;
  });
  if (!loaded) {
    return (
      <section aria-labelledby="invoice-delivery-title" className="space-y-3">
        <SectionTitle as="h2" id="invoice-delivery-title">
          Versand
        </SectionTitle>
        <RegionLoadError title="Der Versand konnte nicht geladen werden">
          Die Versendungen dieser Rechnung sind gerade nicht erreichbar. Versuche es in einem Moment erneut.
        </RegionLoadError>
      </section>
    );
  }
  const [list, defaults] = loaded;
  return (
    <InvoiceDeliveries
      invoiceId={invoice.id}
      invoiceNumber={invoice.invoiceNumber ?? ''}
      list={list}
      defaults={defaults}
    />
  );
}

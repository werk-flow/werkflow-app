'use client';

import { useState } from 'react';
import { Download, ReceiptText } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { useBusyIds } from '@/hooks/use-busy-id';
import { describeFailure } from '@/lib/action-messages';
import { formatEuroCents } from '@/lib/document-rendering/format';
import { loadDocument } from '@/lib/navigation/document-load';
import { formatGermanDate, formatGermanDateRange } from '@/lib/utils';
import { openWerkflowInvoice } from '@/lib/werkflow-billing/billing-actions';
import { WERKFLOW_BILLING_MESSAGES } from '@/lib/werkflow-billing/billing-messages';
import type { WerkflowInvoiceView } from '@/lib/werkflow-billing/billing-view';

const DOWNLOAD_FAILED = 'Die Rechnung konnte nicht geöffnet werden. Versuche es erneut.';

/** What the invoice was for: its lines, as the original names them. */
function purposeOf(invoice: WerkflowInvoiceView): string {
  const lines = invoice.lineNames.length > 0 ? invoice.lineNames.join(', ') : 'WerkFlow';
  return invoice.isStorno ? `Storno: ${lines}` : lines;
}

/** Opens an original through a short-lived signed URL; a refusal stays on its row. */
function useInvoiceDownload(organizationId: string) {
  const downloads = useBusyIds();
  const [refusals, setRefusals] = useState<ReadonlyMap<string, string>>(new Map());
  const download = async (invoiceId: string) => {
    setRefusals((current) => new Map([...current].filter(([id]) => id !== invoiceId)));
    const result = await downloads
      .run(invoiceId, () => openWerkflowInvoice(organizationId, invoiceId))
      .catch(() => ({ success: false, error: 'invoice_download_failed' }) as const);
    if (result.success) {
      loadDocument(result.url);
      return;
    }
    const message = describeFailure(result.error, WERKFLOW_BILLING_MESSAGES, DOWNLOAD_FAILED);
    setRefusals((current) => new Map(current).set(invoiceId, message));
  };
  return { download, isDownloading: downloads.isBusy, refusals };
}

/** Every invoice WerkFlow issued to the organization, newest first, each with its PDF. */
export function BillingInvoicesCard({
  organizationId,
  invoices,
}: {
  organizationId: string;
  invoices: WerkflowInvoiceView[];
}) {
  const { download, isDownloading, refusals } = useInvoiceDownload(organizationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rechnungen</CardTitle>
        <CardDescription>
          Jede Rechnung ist eine E-Rechnung im ZUGFeRD-Format, als PDF zum Herunterladen.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {invoices.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="Noch keine Rechnungen"
            description="Sobald WerkFlow dir eine Rechnung stellt, findest du sie hier."
          />
        ) : (
          <ul className="divide-y border-t">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-col gap-3 px-6 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{purposeOf(invoice)}</p>
                    {invoice.isStorno && <Badge variant="outline">Stornorechnung</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Nr. {invoice.number} vom {formatGermanDate(invoice.issueDate)}
                    {invoice.servicePeriod &&
                      ` · Zeitraum ${formatGermanDateRange(invoice.servicePeriod.start, invoice.servicePeriod.end)}`}
                  </p>
                  <ErrorText>{refusals.get(invoice.id) ?? null}</ErrorText>
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <span className="text-sm font-medium tabular-nums">
                    {formatEuroCents(invoice.grossCents)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    pending={isDownloading(invoice.id)}
                    aria-label={`Rechnung ${invoice.number} als PDF herunterladen`}
                    onClick={() => void download(invoice.id)}
                  >
                    <Download aria-hidden="true" />
                    PDF
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

import Link from 'next/link';

import { SectionTitle } from '@/components/shared/section-title';
import type { InvoiceChainEntry, InvoiceChainKind, InvoiceDetail } from '@/lib/invoices/types';
import { formatGermanDate } from '@/lib/utils';
import { InvoiceStatusBadge } from './invoices-list';

const KIND_LABELS: Record<InvoiceChainKind, string> = {
  rechnung: 'Rechnung',
  storno: 'Stornorechnung',
  korrektur: 'Korrektur',
};

/** „Stornorechnung RE-2026-005“; a draft correction has no number yet. */
function entryLabel(entry: InvoiceChainEntry): string {
  return `${KIND_LABELS[entry.kind]} ${entry.invoiceNumber ?? 'ohne Nummer'}`;
}

/**
 * The invoices linked through Stornos and corrections, from the first
 * original on, each with its number and state; this invoice is marked, the
 * others open. A Stornorechnung also shows its reason. Nothing for a lone invoice.
 */
export function InvoiceChain({
  invoice,
}: {
  invoice: Pick<InvoiceDetail, 'id' | 'chain' | 'cancellationReason'>;
}) {
  if (invoice.chain.length < 2) return null;
  return (
    <section
      aria-labelledby="invoice-chain-title"
      className="space-y-3 rounded-lg border bg-card p-4 shadow-xs sm:p-5"
    >
      <SectionTitle id="invoice-chain-title">Storno und Korrektur</SectionTitle>
      {invoice.cancellationReason && (
        <p className="text-sm wrap-anywhere">
          <span className="text-muted-foreground">Grund der Stornierung: </span>
          {invoice.cancellationReason}
        </p>
      )}
      <ol className="divide-y text-sm">
        {invoice.chain.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
          >
            {entry.id === invoice.id ? (
              <span className="font-medium tabular-nums" aria-current="page">
                {entryLabel(entry)}
              </span>
            ) : (
              <Link
                href={`/rechnungen/${entry.id}`}
                className="font-medium text-primary-text tabular-nums hover:underline"
              >
                {entryLabel(entry)}
              </Link>
            )}
            <InvoiceStatusBadge status={entry.status} />
            <span className="text-muted-foreground tabular-nums">
              {entry.issueDate ? `vom ${formatGermanDate(entry.issueDate)}` : 'noch nicht ausgestellt'}
            </span>
            {entry.id === invoice.id && <span className="text-muted-foreground">(diese Rechnung)</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

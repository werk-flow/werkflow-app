import { formatEuroCents, formatTaxRate } from '@/lib/document-rendering/format';
import type { DraftAmounts } from '@/lib/invoices/amounts';
import { taxRateBasisPoints } from '@/lib/invoicing/calculate';

/**
 * Netto, the VAT per rate on the sum of that rate's lines, Brutto. Null
 * amounts while a line cannot be read: the editor then names the field.
 */
export function InvoiceTotals({ amounts }: { amounts: DraftAmounts | null }) {
  return (
    <section aria-label="Summen" className="ml-auto w-full max-w-sm space-y-1 text-sm tabular-nums">
      {amounts === null ? (
        <p className="text-muted-foreground">Die Summen erscheinen, sobald jede Position lesbar ist.</p>
      ) : (
        <dl className="space-y-1">
          <div className="flex justify-between gap-4">
            <dt>Summe netto</dt>
            <dd>{formatEuroCents(amounts.totals.lineNetCents)}</dd>
          </div>
          {amounts.taxSubtotals.map((row) => {
            const rate = taxRateBasisPoints(row.tax);
            return (
              <div
                key={`${row.tax.category}-${rate}`}
                className="flex justify-between gap-4 text-muted-foreground"
              >
                <dt>
                  USt. {formatTaxRate(rate)} auf {formatEuroCents(row.basisCents)}
                </dt>
                <dd>{formatEuroCents(row.taxCents)}</dd>
              </div>
            );
          })}
          <div className="flex justify-between gap-4 border-t pt-1 font-semibold">
            <dt>Gesamt brutto</dt>
            <dd>{formatEuroCents(amounts.totals.grossCents)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

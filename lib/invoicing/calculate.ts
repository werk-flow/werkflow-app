// The arithmetic of the invoice core, per EN 16931: each line amount is
// rounded once by the shared line rule, VAT is computed per category and rate
// on the sum of that rate's line amounts (BR-CO-17), and the totals are sums
// of those (BR-CO-10 to BR-CO-16). Integer cents throughout.

import { addLocalDays } from '@/lib/date-time/berlin';
import { lineAmountCents } from '@/lib/inventory/line-amount';

import type {
  CalculatedInvoice,
  InvoiceDraft,
  InvoicePayment,
  InvoiceTax,
  InvoiceTaxSubtotal,
} from './model';

/** The rate in basis points: zero for a zero rate and an exemption. */
export function taxRateBasisPoints(tax: InvoiceTax): number {
  return tax.category === 'S' ? tax.rateBasisPoints : 0;
}

/**
 * What an invoice's balance asks of the buyer: an amount `due`, nothing
 * because a recorded payment settled it (`paid`), nothing at all (`zero`), or
 * a `credit` such as a Storno. Only `paid` says that a payment was made.
 */
export function balanceOf({
  paidCents,
  dueCents,
}: CalculatedInvoice['totals']): 'due' | 'paid' | 'zero' | 'credit' {
  if (dueCents > 0) return 'due';
  if (dueCents < 0) return 'credit';
  return paidCents > 0 ? 'paid' : 'zero';
}

/** basis × rate ÷ 10 000, rounded half away from zero; the basis may be negative. */
function taxCentsOf(basisCents: number, rateBasisPoints: number): number {
  const doubled = Math.abs(basisCents) * rateBasisPoints * 2 + 10000;
  if (!Number.isSafeInteger(doubled)) throw new RangeError('The tax basis is too large.');
  const rounded = Math.floor(doubled / 20000);
  // A negative basis whose tax rounds to nothing owes 0, never -0.
  return basisCents < 0 && rounded > 0 ? -rounded : rounded;
}

/** One breakdown row per category and rate; an exemption keeps one reason. */
function taxKey(tax: InvoiceTax): string {
  return `${tax.category}:${taxRateBasisPoints(tax)}`;
}

/** The draft's payment: its `payment`, or its payee as a credit transfer. */
function paymentOf({ payee, payment }: Pick<InvoiceDraft, 'payee' | 'payment'>): InvoicePayment | null {
  if (payee && payment) throw new RangeError('A draft names a payee or a payment, not both.');
  if (payee) return { kind: 'credit-transfer', payee };
  return payment ?? null;
}

/**
 * Every amount of the draft, computed. A draft without lines, with a bad
 * quantity, with both a payee and a payment, or with a paid amount that is
 * negative, not whole cents or above the gross throws a RangeError.
 */
export function calculateInvoice(draft: InvoiceDraft): CalculatedInvoice {
  const { payee, payment: draftPayment, paidCents = 0, lines: draftLines, ...rest } = draft;
  if (draftLines.length === 0) throw new RangeError('An invoice has at least one line.');
  const payment = paymentOf({ payee, payment: draftPayment });
  const lines = draftLines.map((line) => ({
    ...line,
    netCents: lineAmountCents(line.quantity, line.unitPriceCents, line.priceQuantity),
  }));

  const subtotals = new Map<string, InvoiceTaxSubtotal>();
  for (const line of lines) {
    const key = taxKey(line.tax);
    const row = subtotals.get(key);
    if (!row) {
      subtotals.set(key, { tax: line.tax, basisCents: line.netCents, taxCents: 0 });
      continue;
    }
    if (
      row.tax.category === 'E' &&
      line.tax.category === 'E' &&
      row.tax.exemptionReason !== line.tax.exemptionReason
    ) {
      throw new RangeError('All exempt lines of one invoice share one exemption reason.');
    }
    row.basisCents += line.netCents;
  }
  const taxSubtotals = [...subtotals.values()].map((row) => ({
    ...row,
    taxCents: taxCentsOf(row.basisCents, taxRateBasisPoints(row.tax)),
  }));

  const lineNetCents = lines.reduce((sum, line) => sum + line.netCents, 0);
  const taxCents = taxSubtotals.reduce((sum, row) => sum + row.taxCents, 0);
  const grossCents = lineNetCents + taxCents;
  if (!Number.isSafeInteger(paidCents) || paidCents < 0 || paidCents > Math.max(grossCents, 0)) {
    throw new RangeError('The paid amount lies between zero and the gross amount.');
  }
  return {
    ...rest,
    payment,
    lines,
    dueDate: addLocalDays(draft.issueDate, draft.paymentTerms.dueInDays),
    taxSubtotals,
    totals: { lineNetCents, taxCents, grossCents, paidCents, dueCents: grossCents - paidCents },
  };
}

import 'server-only';

import { createHash } from 'node:crypto';

import { renderEInvoicePdf } from '@/lib/document-rendering/e-invoice';
import { invoiceDocument } from '@/lib/document-rendering/invoice-layout';
import type { BusinessDocument } from '@/lib/document-rendering/model';
import { calculateInvoice } from '@/lib/invoicing/calculate';
import { checkEn16931 } from '@/lib/invoicing/check-en16931';
import { readEmbeddedInvoiceXml } from '@/lib/invoicing/embedded-xml';
import type { CalculatedInvoice } from '@/lib/invoicing/model';
import { toEn16931 } from '@/lib/invoicing/to-en16931';
import type { StoredObject } from '@/lib/storage/r2';
import type { Database } from '@/lib/supabase/database.types';
import { WerkflowInvoiceFailure } from '@/lib/werkflow-billing/failure';
import { assertStripeAmounts, werkflowInvoiceDraft } from '@/lib/werkflow-billing/invoice-model';
import type { WerkflowSeller } from '@/lib/werkflow-billing/seller';
import type { StripeInvoiceForIssue } from '@/lib/werkflow-billing/stripe-invoice';

// A finalized Stripe invoice becomes WerkFlow's original
// (werk-flow/werkflow-planning#249): read back from Stripe, mapped into the
// invoice core, compared with Stripe's amounts, checked against EN 16931,
// rendered as ZUGFeRD PDF/A-3, read back, stored under `werkflow-billing/`
// and recorded once. Any failure throws a stable code before the record, so
// no row is issued and Stripe delivers the signal again.

/**
 * The row `issue_werkflow_invoice` records, in the function's own argument
 * names, with the domain types of the buyer snapshot and the payment means.
 */
type IssuedInvoiceRecord = Omit<
  Database['public']['Functions']['issue_werkflow_invoice']['Args'],
  'p_buyer' | 'p_payment_means'
> & {
  p_buyer: CalculatedInvoice['buyer'];
  p_payment_means: 'direct-debit' | 'card' | 'none';
};

export type IssueDependencies = {
  readInvoice(stripeInvoiceId: string): Promise<StripeInvoiceForIssue>;
  seller(): WerkflowSeller;
  /** Writes the original once under its key; a taken key keeps its object. */
  storeOriginal(key: string, pdf: Uint8Array): Promise<StoredObject>;
  isIssued(stripeInvoiceId: string): Promise<boolean>;
  record(row: IssuedInvoiceRecord): Promise<'issued' | 'already_issued'>;
};

type Letterhead = Pick<BusinessDocument, 'sender' | 'footerColumns' | 'stationery'>;

function werkflowLetterhead({ seller }: WerkflowSeller): Letterhead {
  const address = [...seller.address.lines, `${seller.address.postalCode} ${seller.address.city}`];
  const identifiers = [
    `Steuernummer ${seller.taxNumber ?? ''}`,
    ...(seller.vatId ? [`USt-IdNr. ${seller.vatId}`] : []),
    ...(seller.legalRegistrationId ? [seller.legalRegistrationId] : []),
  ];
  return {
    sender: { name: seller.name, addressLines: address, logo: null },
    footerColumns: [[seller.name, address.join(', ')], identifiers, [seller.email ?? '']],
    stationery: null,
  };
}

function calculated(stripe: StripeInvoiceForIssue, seller: WerkflowSeller): CalculatedInvoice {
  try {
    return calculateInvoice(werkflowInvoiceDraft(stripe, seller));
  } catch (error) {
    // A paid amount above the gross or a line the core refuses: Stripe's content is not the core's.
    if (error instanceof RangeError) throw new WerkflowInvoiceFailure('werkflow_invoice_amount_mismatch');
    throw error;
  }
}

/** Issues WerkFlow's original of one finalized Stripe invoice, at most once. */
export async function issueWerkflowInvoice(
  { stripeInvoiceId, stripeEventId }: { stripeInvoiceId: string; stripeEventId: string },
  dependencies: IssueDependencies,
): Promise<'issued' | 'already_issued'> {
  if (await dependencies.isIssued(stripeInvoiceId)) return 'already_issued';

  const stripe = await dependencies.readInvoice(stripeInvoiceId);
  if (stripe.id !== stripeInvoiceId) throw new WerkflowInvoiceFailure('werkflow_invoice_unreadable');
  const seller = dependencies.seller();
  const invoice = calculated(stripe, seller);
  assertStripeAmounts(stripe, invoice);

  const xml = toEn16931(invoice);
  const check = await checkEn16931(xml);
  if (!check.valid) throw new WerkflowInvoiceFailure('werkflow_invoice_rules_failed');
  const pdf = await renderEInvoicePdf(invoiceDocument(invoice, werkflowLetterhead(seller)), xml);
  if ((await readEmbeddedInvoiceXml(pdf)) !== xml) {
    throw new WerkflowInvoiceFailure('werkflow_invoice_readback_mismatch');
  }

  // The key names the bytes' hash, so a retry finds the same object or writes its own.
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  const key = `werkflow-billing/invoices/${stripe.id}/${sha256}.pdf`;
  const stored = await dependencies.storeOriginal(key, pdf);
  if (!stored.created && stored.sizeBytes !== pdf.byteLength) {
    throw new WerkflowInvoiceFailure('werkflow_invoice_storage_conflict');
  }

  return dependencies.record({
    p_organization_id: stripe.organizationId,
    p_stripe_invoice_id: stripe.id,
    p_stripe_customer_id: stripe.customerId,
    p_stripe_event_id: stripeEventId,
    p_number: invoice.number,
    p_issue_date: invoice.issueDate,
    p_buyer: invoice.buyer,
    p_payment_means:
      invoice.payment?.kind === 'direct-debit' || invoice.payment?.kind === 'card'
        ? invoice.payment.kind
        : 'none',
    p_net_cents: invoice.totals.lineNetCents,
    p_tax_cents: invoice.totals.taxCents,
    p_gross_cents: invoice.totals.grossCents,
    p_paid_cents: invoice.totals.paidCents,
    p_due_cents: invoice.totals.dueCents,
    p_file_key: key,
    p_file_sha256: sha256,
    p_file_size_bytes: pdf.byteLength,
    p_rules_release: check.rulesRelease,
  });
}

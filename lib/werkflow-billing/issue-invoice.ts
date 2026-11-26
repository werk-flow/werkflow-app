import 'server-only';

import { createHash } from 'node:crypto';

import { renderEInvoicePdf } from '@/lib/document-rendering/e-invoice';
import { invoiceDocument } from '@/lib/document-rendering/invoice-layout';
import type { BusinessDocument } from '@/lib/document-rendering/model';
import { calculateInvoice } from '@/lib/invoicing/calculate';
import { checkEn16931 } from '@/lib/invoicing/check-en16931';
import type { CalculatedInvoice, InvoiceDraft } from '@/lib/invoicing/model';
import { toEn16931 } from '@/lib/invoicing/to-en16931';
import type { StoredObject } from '@/lib/storage/r2';
import type { Database } from '@/lib/supabase/database.types';
import { billingFailure } from '@/lib/werkflow-billing/failure';
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
  p_payment_means: ReturnType<typeof paymentMeansOf>;
};

export type IssueDependencies = {
  readInvoice(stripeInvoiceId: string): Promise<StripeInvoiceForIssue>;
  seller(): WerkflowSeller;
  /** Writes the original once under its key; a taken key keeps its object. */
  storeOriginal(key: string, pdf: Uint8Array): Promise<StoredObject>;
  isIssued(stripeInvoiceId: string): Promise<boolean>;
  record(row: IssuedInvoiceRecord): Promise<'issued' | 'already_issued'>;
};

/** The payment means a record names: the debit or card Stripe collects with, else none. */
export function paymentMeansOf(invoice: CalculatedInvoice): 'direct-debit' | 'card' | 'none' {
  return invoice.payment?.kind === 'direct-debit' || invoice.payment?.kind === 'card'
    ? invoice.payment.kind
    : 'none';
}

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

/** The core's calculation of a draft; a draft the core refuses is not Stripe's content. */
export function calculatedDraft(draft: InvoiceDraft): CalculatedInvoice {
  try {
    return calculateInvoice(draft);
  } catch (error) {
    // A paid amount above the gross or a line the core refuses: Stripe's content is not the core's.
    if (error instanceof RangeError) throw billingFailure('werkflow_invoice_amount_mismatch');
    throw error;
  }
}

/** The stored original of a checked document, as the record names it. */
export type CheckedOriginal = {
  fileKey: string;
  sha256: string;
  sizeBytes: number;
  rulesRelease: string;
};

/**
 * Checks one calculated document against EN 16931, renders it as ZUGFeRD
 * PDF/A-3 with its XML read back by the renderer, and stores the bytes under the Stripe invoice's
 * prefix. Throws a stable code on every failure, before anything is recorded.
 */
export async function checkedOriginal(
  invoice: CalculatedInvoice,
  {
    seller,
    stripeInvoiceId,
    storeOriginal,
  }: {
    seller: WerkflowSeller;
    stripeInvoiceId: string;
    storeOriginal: IssueDependencies['storeOriginal'];
  },
): Promise<CheckedOriginal> {
  const xml = toEn16931(invoice);
  // A check that cannot run throws (check-en16931.ts): no document counts as checked that no check read.
  const check = await checkEn16931(xml).catch(() => {
    throw billingFailure('werkflow_invoice_check_unavailable');
  });
  if (!check.valid) throw billingFailure('werkflow_invoice_rules_failed');
  // The renderer reads its embedded XML back and throws unless it is `xml` (e-invoice.ts).
  const pdf = await renderEInvoicePdf(invoiceDocument(invoice, werkflowLetterhead(seller)), xml).catch(() => {
    throw billingFailure('werkflow_invoice_render_failed');
  });

  // The key names the bytes' hash, so a retry finds the same object or writes its own.
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  const fileKey = `werkflow-billing/invoices/${stripeInvoiceId}/${sha256}.pdf`;
  const stored = await storeOriginal(fileKey, pdf);
  if (!stored.created && stored.sizeBytes !== pdf.byteLength) {
    throw billingFailure('werkflow_invoice_storage_conflict');
  }
  return { fileKey, sha256, sizeBytes: pdf.byteLength, rulesRelease: check.rulesRelease };
}

/** Issues WerkFlow's original of one finalized Stripe invoice, at most once. */
export async function issueWerkflowInvoice(
  { stripeInvoiceId, stripeEventId }: { stripeInvoiceId: string; stripeEventId: string },
  dependencies: IssueDependencies,
): Promise<'issued' | 'already_issued'> {
  if (await dependencies.isIssued(stripeInvoiceId)) return 'already_issued';

  const stripe = await dependencies.readInvoice(stripeInvoiceId);
  if (stripe.id !== stripeInvoiceId) throw billingFailure('werkflow_invoice_unreadable');
  const seller = dependencies.seller();
  const invoice = calculatedDraft(werkflowInvoiceDraft(stripe, seller));
  assertStripeAmounts(stripe, invoice);
  const original = await checkedOriginal(invoice, {
    seller,
    stripeInvoiceId: stripe.id,
    storeOriginal: dependencies.storeOriginal,
  });

  return dependencies.record({
    p_organization_id: stripe.organizationId,
    p_stripe_invoice_id: stripe.id,
    p_stripe_customer_id: stripe.customerId,
    p_stripe_event_id: stripeEventId,
    p_number: invoice.number,
    p_issue_date: invoice.issueDate,
    p_buyer: invoice.buyer,
    p_payment_means: paymentMeansOf(invoice),
    p_net_cents: invoice.totals.lineNetCents,
    p_tax_cents: invoice.totals.taxCents,
    p_gross_cents: invoice.totals.grossCents,
    p_paid_cents: invoice.totals.paidCents,
    p_due_cents: invoice.totals.dueCents,
    p_file_key: original.fileKey,
    p_file_sha256: original.sha256,
    p_file_size_bytes: original.sizeBytes,
    p_rules_release: original.rulesRelease,
    // What the invoice was for, as the billing page lists it (werk-flow/werkflow-planning#252).
    p_line_names: invoice.lines.map((line) => line.name),
    p_service_start: invoice.delivery.kind === 'period' ? invoice.delivery.start : invoice.delivery.date,
    p_service_end: invoice.delivery.kind === 'period' ? invoice.delivery.end : invoice.delivery.date,
  });
}

import 'server-only';

import type { CalculatedInvoice } from '@/lib/invoicing/model';
import { billingFailure } from '@/lib/werkflow-billing/failure';
import { werkflowStornoDrafts } from '@/lib/werkflow-billing/invoice-model';
import {
  type CheckedOriginal,
  calculatedDraft,
  checkedOriginal,
  type IssueDependencies,
  paymentMeansOf,
} from '@/lib/werkflow-billing/issue-invoice';
import type { StripeRefund, StripeRefundForStorno } from '@/lib/werkflow-billing/stripe-credit-note';
import type { StripeInvoiceForIssue } from '@/lib/werkflow-billing/stripe-invoice';

// A refund of a paid WerkFlow invoice becomes a Stornorechnung
// (werk-flow/werkflow-planning#491, E2c's decision 7 on #17: Storno plus a
// new invoice). A Stripe credit note cancels the document that stands for its
// Stripe invoice: the original, or after an earlier partial refund that
// refund's replacement. The Storno (384) takes the credit note's number, names
// the cancelled document and negates its lines. When something stays, a
// replacement invoice (380) holds Stripe's lines and one line per refund,
// paid in full, numbered `<original number>-KR-<NN>` in the order of the
// refunds: a series of WerkFlow's own, gapless per original, that Stripe's
// numbers (`<prefix>-<NNNN>`, `-CN-<NN>`) never take, since Stripe's prefix
// holds no hyphen. Both pass the same checks as an original and are recorded
// in one call; any failure throws a stable code before the record, so Stripe
// delivers the signal again.

/** One recorded document of a Stripe invoice. */
type WerkflowDocument = {
  id: string;
  number: string;
  issueDate: string;
  typeCode: '380' | '384';
  grossCents: number;
  /** Null for the original; the issuing credit note for a Storno or replacement. */
  stripeCreditNoteId: string | null;
};

type StornoDocument = {
  number: string;
  issue_date: string;
  net_cents: number;
  tax_cents: number;
  gross_cents: number;
  paid_cents: number;
  file_key: string;
  file_sha256: string;
  file_size_bytes: number;
  rules_release: string;
};

/**
 * What a replacement was for, as the billing page lists it
 * (werk-flow/werkflow-planning#554). The Storno's come from the row it cancels.
 */
type ReplacementContent = {
  payment_means: ReturnType<typeof paymentMeansOf>;
  line_names: string[];
  service_start: string;
  service_end: string;
};

/** The arguments `issue_werkflow_storno` records, in the function's own names. */
type StornoRecord = {
  p_organization_id: string;
  p_cancels_invoice_id: string;
  p_stripe_credit_note_id: string;
  p_stripe_event_id: string;
  p_storno: StornoDocument;
  p_replacement: (StornoDocument & ReplacementContent) | null;
};

export type StornoDependencies = Pick<IssueDependencies, 'readInvoice' | 'seller' | 'storeOriginal'> & {
  readRefund(stripeCreditNoteId: string): Promise<StripeRefundForStorno>;
  /** Whether the credit note has its Storno. */
  isIssued(stripeCreditNoteId: string): Promise<boolean>;
  /** Every recorded document of the Stripe invoice. */
  documents(stripeInvoiceId: string): Promise<WerkflowDocument[]>;
  record(row: StornoRecord): Promise<'issued' | 'already_issued'>;
  /** Runs one step for a credit note; a failure a person must see raises the alarm for that credit note. */
  alarmed<Result>(stripeCreditNoteId: string, step: () => Promise<Result>): Promise<Result>;
};

function recordedDocument(invoice: CalculatedInvoice, original: CheckedOriginal): StornoDocument {
  return {
    number: invoice.number,
    issue_date: invoice.issueDate,
    net_cents: invoice.totals.lineNetCents,
    tax_cents: invoice.totals.taxCents,
    gross_cents: invoice.totals.grossCents,
    paid_cents: invoice.totals.paidCents,
    file_key: original.fileKey,
    file_sha256: original.sha256,
    file_size_bytes: original.sizeBytes,
    rules_release: original.rulesRelease,
  };
}

/** The replacement's own payment means, lines and service period, as `issue-invoice.ts` records an original's. */
function replacementContent(replacement: CalculatedInvoice): ReplacementContent {
  const { delivery } = replacement;
  return {
    payment_means: paymentMeansOf(replacement),
    line_names: replacement.lines.map((line) => line.name),
    service_start: delivery.kind === 'period' ? delivery.start : delivery.date,
    service_end: delivery.kind === 'period' ? delivery.end : delivery.date,
  };
}

/** Issues the Storno, and any replacement, of the refund at `index` of the invoice's refunds. */
async function issueRefund(
  {
    stripe,
    refunds,
    index,
    stripeEventId,
  }: {
    stripe: StripeInvoiceForIssue;
    refunds: readonly StripeRefund[];
    index: number;
    stripeEventId: string;
  },
  dependencies: StornoDependencies,
): Promise<'issued' | 'already_issued'> {
  const refund = refunds[index];
  if (!refund) throw billingFailure('werkflow_invoice_unreadable');
  const documents = await dependencies.documents(stripe.id);
  if (documents.some((entry) => entry.typeCode === '384' && entry.stripeCreditNoteId === refund.id)) {
    return 'already_issued';
  }
  // The original comes from invoice.finalized or invoice.paid; until then Stripe delivers this again.
  const original = documents.find((entry) => entry.stripeCreditNoteId === null);
  if (!original) throw billingFailure('werkflow_storno_original_missing');
  const previous = refunds[index - 1];
  const cancelled = previous
    ? documents.find((entry) => entry.typeCode === '380' && entry.stripeCreditNoteId === previous.id)
    : original;
  // An earlier refund took the whole invoice, yet Stripe credited more.
  if (!cancelled) throw billingFailure('werkflow_invoice_amount_mismatch');

  const seller = dependencies.seller();
  const drafts = werkflowStornoDrafts(stripe, seller, {
    cancelled: { number: cancelled.number, issueDate: cancelled.issueDate },
    earlier: refunds.slice(0, index),
    refund,
    replacementNumber: `${original.number}-KR-${String(index + 1).padStart(2, '0')}`,
  });
  const storno = calculatedDraft(drafts.storno);
  const replacement = drafts.replacement ? calculatedDraft(drafts.replacement) : null;
  // The Storno takes back exactly what the cancelled document billed, and what stays was paid.
  if (
    storno.totals.grossCents !== -cancelled.grossCents ||
    (replacement && replacement.totals.dueCents !== 0)
  ) {
    throw billingFailure('werkflow_invoice_amount_mismatch');
  }

  const checked = { seller, stripeInvoiceId: stripe.id, storeOriginal: dependencies.storeOriginal };
  const stornoOriginal = await checkedOriginal(storno, checked);
  const replacementOriginal = replacement ? await checkedOriginal(replacement, checked) : null;
  return dependencies.record({
    p_organization_id: stripe.organizationId,
    p_cancels_invoice_id: cancelled.id,
    p_stripe_credit_note_id: refund.id,
    p_stripe_event_id: stripeEventId,
    p_storno: recordedDocument(storno, stornoOriginal),
    p_replacement:
      replacement && replacementOriginal
        ? { ...recordedDocument(replacement, replacementOriginal), ...replacementContent(replacement) }
        : null,
  });
}

/**
 * Issues the Storno of one Stripe credit note, and its replacement for a
 * partial refund, at most once. An earlier refund of the same invoice without
 * its Storno yet is issued first, so the documents follow Stripe's order.
 */
export async function issueWerkflowStorno(
  { stripeCreditNoteId, stripeEventId }: { stripeCreditNoteId: string; stripeEventId: string },
  dependencies: StornoDependencies,
): Promise<'issued' | 'already_issued'> {
  if (await dependencies.isIssued(stripeCreditNoteId)) return 'already_issued';

  const { stripe, refunds } = await dependencies.alarmed(stripeCreditNoteId, async () => {
    const read = await dependencies.readRefund(stripeCreditNoteId);
    if (read.refund.id !== stripeCreditNoteId) throw billingFailure('werkflow_invoice_unreadable');
    const invoice = await dependencies.readInvoice(read.refund.invoiceId);
    if (invoice.id !== read.refund.invoiceId) throw billingFailure('werkflow_invoice_unreadable');
    // A refund of a paid invoice: Stripe collected all of it and keeps it paid.
    if (invoice.remainingCents !== 0 || invoice.paidCents !== invoice.totalCents) {
      throw billingFailure('werkflow_storno_unsupported');
    }
    return { stripe: invoice, refunds: read.refunds };
  });

  const position = refunds.findIndex((entry) => entry.id === stripeCreditNoteId);
  let outcome: 'issued' | 'already_issued' = 'already_issued';
  // Each refund's failure alarms under its own credit note, so its own signal later adds no second alarm.
  for (const [index, refund] of refunds.slice(0, position + 1).entries()) {
    outcome = await dependencies.alarmed(refund.id, () =>
      issueRefund({ stripe, refunds, index, stripeEventId }, dependencies),
    );
  }
  return outcome;
}

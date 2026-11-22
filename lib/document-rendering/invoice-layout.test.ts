import { describe, expect, test } from 'bun:test';

import { calculateInvoice } from '@/lib/invoicing/calculate';
import {
  CARD_INVOICE,
  DIRECT_DEBIT_INVOICE,
  STORNO_INVOICE,
} from '@/lib/invoicing/fixtures/reference-invoices';
import type { InvoiceDraft } from '@/lib/invoicing/model';

import { invoiceDocument } from './invoice-layout';

// The printed payment says what the invoice's balance and recorded payment
// support: a collection or a card payment is done only with a paid amount.

const LETTERHEAD = {
  sender: { name: 'Musterfirma Software, Erika Musterfrau', addressLines: [], logo: null },
  footerColumns: [],
  stationery: null,
};

const closingTextOf = (draft: InvoiceDraft) =>
  invoiceDocument(calculateInvoice(draft), LETTERHEAD).closingText;

const [subscriptionLine] = DIRECT_DEBIT_INVOICE.lines;
if (!subscriptionLine) throw new Error('fixture without lines');

describe('the printed payment of an invoice', () => {
  test('a debit with an amount due is announced; a recorded payment makes it collected', () => {
    expect(closingTextOf(DIRECT_DEBIT_INVOICE)).toContain(
      'Der Betrag wird per SEPA-Lastschrift eingezogen. Mandatsreferenz MUSTERMANDAT0001, Gläubiger-ID DE98ZZZ09999999999.',
    );
    expect(closingTextOf({ ...DIRECT_DEBIT_INVOICE, paidCents: 49900 })).toContain(
      'Per SEPA-Lastschrift eingezogen. Mandatsreferenz MUSTERMANDAT0001',
    );
    expect(closingTextOf(CARD_INVOICE)).toContain('Bezahlt mit der Karte mit der Endung 4242.');
  });

  test('a zero invoice under a debit or a card asks for nothing and claims no payment', () => {
    const zeroLines = [{ ...subscriptionLine, unitPriceCents: 0 }];
    for (const draft of [
      { ...DIRECT_DEBIT_INVOICE, lines: zeroLines },
      { ...CARD_INVOICE, paidCents: 0, lines: zeroLines },
    ]) {
      const text = closingTextOf(draft);
      expect(text).toContain('Es ist nichts zu zahlen.');
      expect(text).not.toContain('eingezogen');
      expect(text).not.toContain('Bezahlt');
    }
  });

  test('a Storno under a debit names the cancelled amount and claims no collection', () => {
    const storno: InvoiceDraft = {
      ...DIRECT_DEBIT_INVOICE,
      typeCode: '384',
      precedingInvoice: { number: 'MUSTER-0001', issueDate: '2026-11-15' },
      lines: [{ ...subscriptionLine, quantity: '-1' }],
    };
    const text = closingTextOf(storno);
    expect(text).toContain('Storniert werden 499,00 €. Es ist nichts zu zahlen.');
    expect(text).not.toContain('eingezogen');
    expect(closingTextOf(STORNO_INVOICE)).toContain('Storniert werden');
  });

  test('a credit that is no Storno is a Guthaben', () => {
    const credit = { ...DIRECT_DEBIT_INVOICE, lines: [{ ...subscriptionLine, quantity: '-1' }] };
    expect(closingTextOf(credit)).toContain('Guthaben: 499,00 €. Es ist nichts zu zahlen.');
  });
});

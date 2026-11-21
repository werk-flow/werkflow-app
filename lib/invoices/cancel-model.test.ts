import { describe, expect, mock, test } from 'bun:test';

import { EMPTY_COMPANY_PROFILE_DETAILS } from '@/lib/company-profile/profile';
import { calculateInvoice } from '@/lib/invoicing/calculate';
import { toEn16931 } from '@/lib/invoicing/to-en16931';
import { cancelInvoiceSchema, cancellationReasonProblem, negatedQuantity, stornoOf } from './cancel-model';
import { invoiceDraftOf, type IssueSnapshot } from './issue-model';
import { INVOICE_REFERENCE_MAX_LENGTH, type InvoiceLineValues } from './types';

mock.module('server-only', () => ({}));
// SaxonJS loads only with Bun's own stack traces; see lib/invoicing/check-en16931.test.ts.
const prepareStackTrace = Error.prepareStackTrace;
Reflect.set(Error, 'prepareStackTrace', undefined);
const { checkEn16931 } = await import('@/lib/invoicing/check-en16931').finally(() => {
  Reflect.set(Error, 'prepareStackTrace', prepareStackTrace);
});
const { calculatedInvoiceOf, renderInvoicePdf } = await import('./original');

// The Stornorechnung cancel_invoice stores: every line negated by its
// quantity. The database negates the stored amounts instead of computing them
// (supabase/migrations/20261219130000_cancel_and_correct_issued_invoices.sql);
// this proves the invoice core, run on the negated lines, computes exactly
// those amounts, and that the result passes the EN 16931 rules as a 384.

const SNAPSHOT: IssueSnapshot = {
  organizationName: 'Haustechnik Sonnenberg',
  profile: {
    ...EMPTY_COMPANY_PROFILE_DETAILS,
    companyName: 'Haustechnik Sonnenberg GmbH',
    street: 'Sonnenweg 1',
    postalCode: '01234',
    city: 'Sonnenstadt',
    vatId: 'DE123456789',
    iban: 'DE00 1111 1111 1111 1111 11',
  },
  files: { logo: null, stationery_first: null, stationery_following: null },
  buyer: {
    name: 'Hausverwaltung Lindenhof GmbH',
    address: { lines: ['Hofweg 1'], postalCode: '10117', city: 'Berlin', countryCode: 'DE' },
  },
};

const line = (
  quantity: string,
  unit: string,
  unitPriceCents: number,
  taxRateBasisPoints: InvoiceLineValues['taxRateBasisPoints'],
  priceQuantity: InvoiceLineValues['priceQuantity'] = 1,
): InvoiceLineValues => ({
  name: 'Position',
  description: '',
  quantity,
  unit,
  unitPriceCents,
  priceQuantity,
  taxRateBasisPoints,
});

/** An issued invoice of these lines, its amounts computed by the core as at issue. */
function issued(lines: InvoiceLineValues[], buyerReference = '', orderReference = 'BE-4711') {
  const facts = {
    serviceStart: '2037-11-02',
    serviceEnd: '2037-11-06',
    paymentDueDays: 14,
    discountDays: 7,
    discountBasisPoints: 200,
    orderReference,
    buyerReference,
    openingText: 'Vielen Dank.',
    closingText: '',
    cancels: null,
    cancellationReason: null,
  };
  const draft = invoiceDraftOf(
    { ...facts, lines: lines.map((entry) => ({ ...entry, netCents: 0 })) },
    SNAPSHOT,
    {
      number: 'RE-2037-001',
      issueDate: '2037-11-10',
    },
  );
  if (!draft) throw new Error('no Leistungsdatum');
  const calculated = calculateInvoice(draft);
  return {
    ...facts,
    id: '98300000-0000-4000-8000-000000000001',
    invoiceNumber: 'RE-2037-001',
    issueDate: '2037-11-10',
    lines: lines.map((entry, index) => ({ ...entry, netCents: calculated.lines[index]?.netCents ?? 0 })),
    ...calculated.totals,
  };
}

describe('negatedQuantity', () => {
  test.each([
    ['1.500', '-1.500'],
    ['-1', '1'],
    ['12.125', '-12.125'],
    ['0', '0'],
    ['0.000', '0.000'],
  ])('%p negates to %p', (quantity, negated) => {
    expect(negatedQuantity(quantity)).toBe(negated);
  });
});

describe('the reason', () => {
  const input = (reason: string) => ({
    invoiceId: '98300000-0000-4000-8000-000000000001',
    attemptKey: '98300000-0000-4000-8000-000000000002',
    reason,
    correct: false,
  });

  test.each([
    ['a line break and a tab', 'Falsche Menge\nZeile 2\tabgerechnet', true],
    ['a form feed', 'Falsche\fMenge', false],
    ['a lone surrogate', 'Falsche Menge \uD800', false],
    ['only spaces', '   ', false],
  ])('with %s: the schema accepts it only when the invoice XML can carry it', (_case, reason, accepted) => {
    expect(cancelInvoiceSchema.safeParse(input(reason)).success).toBe(accepted);
    expect(cancellationReasonProblem(reason) === null).toBe(accepted);
  });

  test('the field names a control character in German', () => {
    expect(cancellationReasonProblem('Falsche\u0007Menge')).toContain('Steuerzeichen');
  });
});

describe('stornoOf', () => {
  test.each([
    ['one 19 % line with three decimals', [line('1.500', 'hour', 7200, 1900)]],
    [
      'a price per 100, a negative line, 19 %, 7 % and a zero rate',
      [
        line('12.125', 'meter', 1234, 1900, 100),
        line('-1', 'flat_rate', 3500, 1900),
        line('3.333', 'hour', 6799, 700),
        line('2', 'piece', 999, 0),
      ],
    ],
    [
      'amounts that round half away from zero',
      [line('0.005', 'piece', 100, 1900), line('0.015', 'liter', 100, 700)],
    ],
  ])('%s: the core computes the negated amounts, and the 384 passes the rules', async (_case, lines) => {
    const original = issued(lines);
    const storno = stornoOf(original, 'Falscher Rechnungsempfänger');
    const draft = invoiceDraftOf(storno, SNAPSHOT, { number: 'RE-2037-002', issueDate: '2037-11-20' });
    if (!draft) throw new Error('no Leistungsdatum');
    const calculated = calculateInvoice(draft);

    expect(calculated.lines.map((entry) => entry.netCents)).toEqual(
      storno.lines.map((entry) => entry.netCents),
    );
    expect(calculated.totals).toEqual({
      lineNetCents: storno.lineNetCents,
      taxCents: storno.taxCents,
      grossCents: storno.grossCents,
      paidCents: 0,
      dueCents: storno.grossCents,
    });
    expect(calculated.totals.dueCents).toBeLessThan(0);
    // The seller has an IBAN, but a Stornorechnung asks for no payment.
    expect(calculated.payment).toBeNull();
    expect([storno.lineNetCents, storno.taxCents, storno.grossCents]).toEqual(
      [original.lineNetCents, original.taxCents, original.grossCents].map((cents) =>
        cents === 0 ? 0 : -cents,
      ),
    );
    expect(draft.typeCode).toBe('384');
    expect(draft.precedingInvoice).toEqual({ number: 'RE-2037-001', issueDate: '2037-11-10' });
    expect(draft.notes).toEqual(['Grund der Stornierung: Falscher Rechnungsempfänger']);
    expect(draft.paymentTerms).toEqual({ dueInDays: 0, discount: null });
    expect(draft.delivery).toEqual({ kind: 'period', start: '2037-11-02', end: '2037-11-06' });
    expect(draft.orderReference).toBe('BE-4711');
    const xml = toEn16931(calculated);
    expect(xml).toContain(
      `<ram:DuePayableAmount>${(storno.grossCents / 100).toFixed(2)}</ram:DuePayableAmount>`,
    );
    expect(xml).not.toContain('<ram:SpecifiedTradeSettlementPaymentMeans>');
    expect(xml).not.toContain('<ram:DueDateDateTime>');
    const check = await checkEn16931(xml);
    expect(check.errors).toEqual([]);
  });
});

describe("a Stornorechnung's head", () => {
  const lines = [line('1.500', 'hour', 7200, 1900)];
  const units = lines.map((entry) => entry.unit);

  /** Whether the invoice's head leaves room for its lines, as the issue's and the cancel's render check it. */
  async function headFits(
    invoice: Parameters<typeof calculatedInvoiceOf>[0],
    issue: { number: string; issueDate: string },
  ): Promise<boolean> {
    const calculated = calculatedInvoiceOf(invoice, SNAPSHOT, issue);
    if (!calculated) throw new Error('no Leistungsdatum');
    return renderInvoicePdf(
      '98300000-0000-4000-8000-0000000000aa',
      { calculated, units, snapshot: SNAPSHOT },
      null,
    ).then(
      () => true,
      (error: unknown) => {
        if (error instanceof RangeError) return false;
        throw error;
      },
    );
  }

  // A series whose ten-character prefix (invoice_settings takes 20) nearly fills the number's row
  // rolls from 99 to 100 between the original and its Stornorechnung: the longer number takes a
  // second row. References of one-letter lines, each within INVOICE_REFERENCE_MAX_LENGTH, fill
  // the head up to its limit.
  const prefix = 'WWWWWWWWII';
  const ORIGINAL_ISSUE = { number: `${prefix}2037-99`, issueDate: '2037-11-10' };
  const NEXT_ISSUE = { number: `${prefix}2037-100`, issueDate: '2037-11-20' };
  const referenceOf = (rows: number) => Array.from({ length: rows }, () => 'A').join('\n');
  const originalOf = (rows: number) =>
    issued(lines, referenceOf(Math.floor(rows / 2)), referenceOf(Math.ceil(rows / 2)));

  test('a Stornorechnung under a longer number fits wherever its original fit', async () => {
    let rows = 2;
    while (await headFits(originalOf(rows + 1), ORIGINAL_ISSUE)) rows += 1;
    const original = originalOf(rows);
    expect(original.orderReference.length).toBeLessThanOrEqual(INVOICE_REFERENCE_MAX_LENGTH);
    // The original's head is at its limit, and the next number alone would push it over.
    expect(await headFits(original, NEXT_ISSUE)).toBe(false);

    const storno = stornoOf(
      { ...original, invoiceNumber: ORIGINAL_ISSUE.number },
      'Falscher Rechnungsempfänger',
    );
    expect(await headFits(storno, NEXT_ISSUE)).toBe(true);
  });
});

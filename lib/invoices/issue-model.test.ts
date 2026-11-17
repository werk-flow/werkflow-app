import { describe, expect, mock, test } from 'bun:test';

import { offerLetterhead } from '@/lib/company-profile/letterhead';
import { EMPTY_COMPANY_PROFILE_DETAILS } from '@/lib/company-profile/profile';
import { invoiceDocument } from '@/lib/document-rendering/invoice-layout';
import { calculateInvoice } from '@/lib/invoicing/calculate';
import { toEn16931 } from '@/lib/invoicing/to-en16931';
import { INVENTORY_UNITS } from '@/lib/inventory/units';
import { invoiceDraftOf, issueFindingsOf, postalAddressOf, type IssueSnapshot } from './issue-model';
import { INVOICE_REFERENCE_MAX_LENGTH, type InvoiceDetail } from './types';

mock.module('server-only', () => ({}));
// SaxonJS loads only with Bun's own stack traces; see lib/invoicing/check-en16931.test.ts.
const prepareStackTrace = Error.prepareStackTrace;
Reflect.set(Error, 'prepareStackTrace', undefined);
const { checkEn16931 } = await import('@/lib/invoicing/check-en16931').finally(() => {
  Reflect.set(Error, 'prepareStackTrace', prepareStackTrace);
});
const { renderBusinessDocument } = await import('@/lib/document-rendering/render');

// The mapping of a stored invoice and its issue snapshot into the invoice
// core: address, units, Leistungsdatum, Skonto, texts, tax; the findings in
// the office's words; and the longest references still leave room on the page.

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

const line = (unit: string, taxRateBasisPoints: 1900 | 700 | 0) => ({
  name: 'Position',
  description: '',
  quantity: '1.000',
  unit,
  unitPriceCents: 1000,
  priceQuantity: 1 as const,
  taxRateBasisPoints,
  netCents: 1000,
});

const INVOICE: Parameters<typeof invoiceDraftOf>[0] = {
  serviceStart: '2037-11-02',
  serviceEnd: '2037-11-06',
  paymentDueDays: 14,
  discountDays: 7,
  discountBasisPoints: 200,
  orderReference: 'BE-4711',
  buyerReference: '',
  openingText: 'Vielen Dank für deinen Auftrag.',
  closingText: '',
  lines: [line('hour', 1900), line('coil', 0)],
  cancels: null,
  cancellationReason: null,
};

describe('postalAddressOf', () => {
  test.each([
    ['Hofweg 1, 10117 Berlin', { lines: ['Hofweg 1'], postalCode: '10117', city: 'Berlin' }],
    [
      'c/o Lindenhof\nHofweg 1\n10117 Berlin',
      { lines: ['c/o Lindenhof', 'Hofweg 1'], postalCode: '10117', city: 'Berlin' },
    ],
    ['Hofweg 1, D-10117 Berlin-Mitte', { lines: ['Hofweg 1'], postalCode: '10117', city: 'Berlin-Mitte' }],
  ])('%p reads as a German postal address', (text, expected) => {
    expect(postalAddressOf(text)).toEqual({ ...expected, countryCode: 'DE' });
  });

  test.each([[null], [''], ['Berlin'], ['Hofweg 1, Berlin'], ['10117 Berlin'], ['Hofweg 1, 1011 Berlin']])(
    '%p is no address an invoice can name',
    (text) => {
      expect(postalAddressOf(text)).toBeNull();
    },
  );
});

describe('invoiceDraftOf', () => {
  test('maps the stored invoice and the snapshot into the core, and the result passes the EN 16931 rules', async () => {
    const draft = invoiceDraftOf(INVOICE, SNAPSHOT, { number: 'RE-2037-001', issueDate: '2037-11-20' });
    expect(draft).not.toBeNull();
    if (!draft) return;
    expect(draft.delivery).toEqual({ kind: 'period', start: '2037-11-02', end: '2037-11-06' });
    expect(draft.paymentTerms).toEqual({ dueInDays: 14, discount: { days: 7, percentBasisPoints: 200 } });
    expect(draft.lines.map((entry) => [entry.unitCode, entry.tax])).toEqual([
      ['HUR', { category: 'S', rateBasisPoints: 1900 }],
      ['XRG', { category: 'Z' }],
    ]);
    expect(draft.notes).toEqual(['Vielen Dank für deinen Auftrag.']);
    expect(draft.orderReference).toBe('BE-4711');
    expect(draft.buyerReference).toBeNull();
    expect(draft.payee).toEqual({ iban: 'DE00111111111111111111', bic: null, accountName: null });
    expect(draft.seller.name).toBe('Haustechnik Sonnenberg GmbH');
    expect(draft.buyer.name).toBe('Hausverwaltung Lindenhof GmbH');
    const check = await checkEn16931(toEn16931(calculateInvoice(draft)));
    expect(check.errors).toEqual([]);
  });

  test('every unit of the list has a code the EN 16931 rules accept', async () => {
    const draft = invoiceDraftOf(
      { ...INVOICE, lines: INVENTORY_UNITS.map((unit) => line(unit.code, 1900)) },
      SNAPSHOT,
      { number: 'RE-2037-001', issueDate: '2037-11-20' },
    );
    if (!draft) throw new Error('no draft');
    expect(draft.lines.every((entry) => /^[A-Z0-9]{2,3}$/.test(entry.unitCode))).toBe(true);
    expect((await checkEn16931(toEn16931(calculateInvoice(draft)))).errors).toEqual([]);
  });

  test('one day is a Leistungsdatum; without one there is no invoice to issue', () => {
    const oneDay = invoiceDraftOf({ ...INVOICE, serviceEnd: '2037-11-02' }, SNAPSHOT, {
      number: 'X',
      issueDate: '2037-11-20',
    });
    expect(oneDay?.delivery).toEqual({ kind: 'date', date: '2037-11-02' });
    expect(
      invoiceDraftOf({ ...INVOICE, serviceStart: null, serviceEnd: null }, SNAPSHOT, {
        number: 'X',
        issueDate: '2037-11-20',
      }),
    ).toBeNull();
  });

  test('the longest references still leave room for the lines on the first page', async () => {
    const reference = 'A'.repeat(INVOICE_REFERENCE_MAX_LENGTH);
    const draft = invoiceDraftOf(
      { ...INVOICE, orderReference: reference, buyerReference: reference },
      SNAPSHOT,
      { number: 'RE-2037-000001', issueDate: '2037-11-20' },
    );
    if (!draft) throw new Error('no draft');
    const letterhead = offerLetterhead(SNAPSHOT.profile, {}, SNAPSHOT.organizationName);
    const bytes = await renderBusinessDocument(invoiceDocument(calculateInvoice(draft), letterhead));
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

describe('issueFindingsOf', () => {
  test('names the company detail, the recipient or the line at fault, once each', () => {
    const findings = issueFindingsOf(
      [
        { ruleId: 'BR-S-02', field: 'seller.vatId', message: '' },
        { ruleId: 'BR-S-02', field: 'seller.taxNumber', message: '' },
        { ruleId: 'BR-11', field: 'buyer.address', message: '' },
        { ruleId: 'BR-25', field: 'lines[1].name', message: '' },
      ],
      'client-1',
    );
    expect(findings).toEqual([
      {
        label: 'Firmenangaben: USt-IdNr. oder Steuernummer fehlt oder passt nicht (Regel BR-S-02)',
        href: '/einstellungen/dokumente',
      },
      { label: 'Rechnungsempfänger: Name oder Anschrift (Regel BR-11)', href: '/kunden/client-1' },
      { label: 'Position 2 (Regel BR-25)', href: null },
    ]);
  });
});

// Keeps the type of a stored invoice in step with what the mapping reads.
const _stored: Pick<InvoiceDetail, keyof typeof INVOICE> = INVOICE;
void _stored;

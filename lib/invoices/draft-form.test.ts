import { describe, expect, test } from 'bun:test';

import { draftAmounts } from './amounts';
import {
  draftFormOf,
  emptyLine,
  lineFieldId,
  parseDraftForm,
  TERM_FIELD_IDS,
  type DraftForm,
} from './draft-form';
import type { InvoiceDetail } from './types';

const TERMS = {
  serviceStart: '',
  serviceEnd: '',
  paymentDueDays: '14',
  discountPercent: '',
  discountDays: '',
  orderReference: '',
  buyerReference: '',
  openingText: '',
  closingText: '',
};

function form(overrides: Partial<DraftForm>): DraftForm {
  return { ...TERMS, lines: [], ...overrides };
}

describe('a draft totals its lines through the invoice core', () => {
  test('VAT per rate on the sum of that rate, a credit line, three decimals, a price per 100 and a zero rate', () => {
    const amounts = draftAmounts([
      // 1,5 h × 72,00 € = 108,00 €
      {
        name: 'Monteurstunde',
        description: '',
        quantity: '1.5',
        unit: 'hour',
        unitPriceCents: 7200,
        priceQuantity: 1,
        taxRateBasisPoints: 1900,
      },
      // 0,125 × 40,00 € ÷ 100 = 0,05 €
      {
        name: 'Dichtung',
        description: '',
        quantity: '0.125',
        unit: 'piece',
        unitPriceCents: 4000,
        priceQuantity: 100,
        taxRateBasisPoints: 700,
      },
      // 3 × 0,03 €: the 19 % basis is 108,09 €, its VAT 20,54 €
      {
        name: 'Kleinteil',
        description: '',
        quantity: '3',
        unit: 'piece',
        unitPriceCents: 3,
        priceQuantity: 1,
        taxRateBasisPoints: 1900,
      },
      // A credit line at the zero rate
      {
        name: 'Gutschrift',
        description: '',
        quantity: '-1',
        unit: 'flat_rate',
        unitPriceCents: 4500,
        priceQuantity: 1,
        taxRateBasisPoints: 0,
      },
    ]);
    expect(amounts.lineNetCents).toEqual([10800, 5, 9, -4500]);
    expect(amounts.taxSubtotals).toEqual([
      { tax: { category: 'S', rateBasisPoints: 1900 }, basisCents: 10809, taxCents: 2054 },
      { tax: { category: 'S', rateBasisPoints: 700 }, basisCents: 5, taxCents: 0 },
      { tax: { category: 'Z' }, basisCents: -4500, taxCents: 0 },
    ]);
    expect(amounts.totals).toEqual({ lineNetCents: 6314, taxCents: 2054, grossCents: 8368 });
  });

  test('lines whose amounts cancel out lose no cent: a line beyond ten billion euros is refused', () => {
    const line = (quantity: string) => ({
      name: 'Posten',
      description: '',
      quantity,
      unit: 'piece',
      unitPriceCents: 100_000_000,
      priceQuantity: 1 as const,
      taxRateBasisPoints: 0 as const,
    });
    // 90 000 000 × 1 000 000 € each: their running sum would leave the safe integer range.
    const huge = [
      line('90000000'),
      line('90000000'),
      { ...line('1'), unitPriceCents: 1 },
      line('-90000000'),
      line('-90000000'),
    ];
    expect(() => draftAmounts(huge)).toThrow(RangeError);
    expect(
      draftAmounts([line('10000'), line('-10000'), { ...line('1'), unitPriceCents: 1 }]).totals.lineNetCents,
    ).toBe(1);
  });

  test('a draft without lines totals zero', () => {
    expect(draftAmounts([]).totals).toEqual({ lineNetCents: 0, taxCents: 0, grossCents: 0 });
  });
});

describe('the editor parses what the office types', () => {
  test('a German decimal, a negative quantity, a Leistungsdatum and Skonto', () => {
    const parsed = parseDraftForm(
      form({
        serviceStart: '2026-11-02',
        discountPercent: '2,5',
        discountDays: '7',
        lines: [{ ...emptyLine('a'), name: ' Rohr ', quantity: '-1,125', price: '1.234,50' }],
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      terms: {
        serviceStart: '2026-11-02',
        serviceEnd: '2026-11-02',
        paymentDueDays: 14,
        discountDays: 7,
        discountBasisPoints: 250,
        orderReference: '',
        buyerReference: '',
        openingText: '',
        closingText: '',
      },
      lines: [
        {
          name: 'Rohr',
          description: '',
          quantity: '-1.125',
          unit: 'piece',
          unitPriceCents: 123450,
          priceQuantity: 1,
          taxRateBasisPoints: 1900,
        },
      ],
    });
  });

  test('each field at fault gets its sentence', () => {
    const parsed = parseDraftForm(
      form({
        serviceStart: '2026-11-06',
        serviceEnd: '2026-11-02',
        paymentDueDays: '7',
        discountPercent: '2',
        discountDays: '10',
        lines: [{ ...emptyLine('a'), name: ' ', quantity: '1,2345', price: '-3' }],
      }),
    );
    expect(parsed.ok).toBe(false);
    expect(Object.keys(parsed.ok ? {} : parsed.errors).sort()).toEqual(
      [
        TERM_FIELD_IDS.serviceEnd,
        TERM_FIELD_IDS.discountDays,
        lineFieldId(0, 'name'),
        lineFieldId(0, 'quantity'),
        lineFieldId(0, 'price'),
      ].sort(),
    );
  });

  test('a stored draft reads back into the same values', () => {
    const stored: InvoiceDetail = {
      id: 'i',
      invoiceNumber: null,
      status: 'entwurf',
      version: 2,
      serviceStart: '2026-11-02',
      serviceEnd: '2026-11-06',
      paymentDueDays: 14,
      discountDays: 7,
      discountBasisPoints: 200,
      orderReference: 'BE-4711',
      buyerReference: '',
      openingText: '',
      closingText: '',
      lineNetCents: 4,
      taxCents: 0,
      grossCents: 4,
      client: { id: 'c', name: 'Erika Musterfrau' },
      recipient: { id: 'c', name: 'Erika Musterfrau', address: null },
      work: null,
      lines: [
        {
          name: 'Rohr',
          description: '',
          quantity: '10.000',
          unit: 'meter',
          unitPriceCents: 40,
          priceQuantity: 100,
          taxRateBasisPoints: 700,
          netCents: 4,
        },
      ],
    };
    const parsed = parseDraftForm(draftFormOf(stored));
    expect(parsed.ok && parsed.lines).toEqual([
      {
        name: 'Rohr',
        description: '',
        quantity: '10',
        unit: 'meter',
        unitPriceCents: 40,
        priceQuantity: 100,
        taxRateBasisPoints: 700,
      },
    ]);
    expect(parsed.ok && parsed.terms.discountBasisPoints).toBe(200);
    expect(parsed.ok && parsed.terms.serviceEnd).toBe('2026-11-06');
  });
});

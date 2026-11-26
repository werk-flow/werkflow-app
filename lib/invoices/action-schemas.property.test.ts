import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  draftLineValuesArbitrary,
  invoiceLineSourceArbitrary,
  invoiceTermsArbitrary,
  quantityThousandthsArbitrary,
} from '@/lib/testing/invoice-arbitraries';
import { saveInvoiceDraftSchema } from './action-schemas';
import { draftFormOf, parseDraftForm } from './draft-form';
import type { InvoiceDetail, InvoiceTerms } from './types';

// Property tests (docs/technical/testing.md, "Property tests"). The save parses the server's own
// limits again (docs/features/commercial-and-finance.md, "Invoice drafts"): a quantity with at most
// three decimals, a net price in whole cents up to one million euros, VAT 19, 7 or 0 %, a
// Zahlungsziel of 0 to 365 days, a Skonto with both percent and days within the Zahlungsziel, and
// a service end on or after its start.

const DETAIL: Omit<InvoiceDetail, keyof InvoiceTerms | 'lines'> = {
  id: '00000000-0000-4000-8000-000000000001',
  invoiceNumber: null,
  status: 'entwurf',
  version: 1,
  issueDate: null,
  original: null,
  cancels: null,
  cancellationReason: null,
  chain: [],
  client: { id: '00000000-0000-4000-8000-000000000003', name: 'Kunde' },
  recipient: { id: '00000000-0000-4000-8000-000000000003', name: 'Kunde', address: null },
  work: null,
  lineNetCents: 0,
  taxCents: 0,
  grossCents: 0,
};

const IDS = {
  invoiceId: '00000000-0000-4000-8000-000000000001',
  attemptKey: '00000000-0000-4000-8000-000000000002',
};

/** What the editor sends: its parse of a stored draft's text, within the server's 500 lines. */
const saveArbitrary = fc
  .tuple(
    invoiceTermsArbitrary,
    fc.array(fc.tuple(draftLineValuesArbitrary(quantityThousandthsArbitrary), invoiceLineSourceArbitrary), {
      maxLength: 500,
    }),
  )
  .map(([terms, lines]) => {
    const form = draftFormOf({
      ...DETAIL,
      ...terms,
      lines: lines.map(([line, source]) => ({ ...line, netCents: 0, source })),
    });
    const parsed = parseDraftForm(form);
    if (!parsed.ok) throw new Error(`the editor refuses its own draft: ${JSON.stringify(parsed.errors)}`);
    return { ...IDS, expectedVersion: 1, terms: parsed.terms, lines: parsed.lines };
  });

type Save = typeof saveArbitrary extends fc.Arbitrary<infer T> ? T : never;

/** One broken rule at a time, each on a valid save. */
const violations: Array<[string, (save: Save) => Save | null]> = [
  [
    'a price in fractions of a cent',
    (save) =>
      withFirstLine(save, (line) => ({
        ...line,
        unitPriceCents: Math.min(line.unitPriceCents, 99_999_999) + 0.5,
      })),
  ],
  [
    'a price above one million euros',
    (save) => withFirstLine(save, (line) => ({ ...line, unitPriceCents: 100_000_001 })),
  ],
  ['a negative price', (save) => withFirstLine(save, (line) => ({ ...line, unitPriceCents: -1 }))],
  [
    'a fourth decimal',
    (save) =>
      withFirstLine(save, (line) => ({ ...line, quantity: `${line.quantity.split('.')[0] ?? '0'}.0001` })),
  ],
  ['a tenth digit', (save) => withFirstLine(save, (line) => ({ ...line, quantity: '1234567890' }))],
  ['another VAT rate', (save) => withFirstLine(save, (line) => ({ ...line, taxRateBasisPoints: 1600 }))],
  [
    'a source of an unknown kind',
    (save) =>
      withFirstLine(save, (line) => ({
        ...line,
        source: { kind: 'material', id: '00000000-0000-4000-8000-000000000004' },
      })),
  ],
  ['a Zahlungsziel beyond a year', (save) => ({ ...save, terms: { ...save.terms, paymentDueDays: 366 } })],
  [
    'a Skonto period past the Zahlungsziel',
    (save) =>
      save.terms.paymentDueDays >= 365
        ? null
        : {
            ...save,
            terms: { ...save.terms, discountDays: save.terms.paymentDueDays + 1, discountBasisPoints: 200 },
          },
  ],
  [
    'Skonto days without a percentage',
    (save) =>
      save.terms.paymentDueDays < 1
        ? null
        : { ...save, terms: { ...save.terms, discountDays: 1, discountBasisPoints: null } },
  ],
  [
    'a service end before its start',
    (save) =>
      save.terms.serviceStart === null || save.terms.serviceStart <= '2000-01-01'
        ? null
        : { ...save, terms: { ...save.terms, serviceEnd: '2000-01-01' } },
  ],
];

function withFirstLine(save: Save, change: (line: Save['lines'][number]) => object): Save | null {
  const [first, ...rest] = save.lines;
  // The variant changes the line's type on purpose: the schema, not TypeScript, must refuse it.
  return first ? { ...save, lines: [{ ...first, ...change(first) }, ...rest] } : null;
}

describe('The save of a draft', () => {
  test('accepts every draft the editor sends, up to the server’s 500 lines', () => {
    fc.assert(
      fc.property(saveArbitrary, (save) => {
        expect(saveInvoiceDraftSchema.safeParse(save).success).toBe(true);
      }),
    );
  });

  test('accepts a draft of 500 lines from the editor, the most the server takes', () => {
    const terms: InvoiceTerms = {
      serviceStart: '2026-11-02',
      serviceEnd: '2026-11-20',
      paymentDueDays: 14,
      discountDays: 7,
      discountBasisPoints: 200,
      orderReference: '',
      buyerReference: '',
      openingText: '',
      closingText: '',
    };
    const line = {
      name: 'Position',
      description: '',
      quantity: '999999999.999',
      unit: 'piece',
      unitPriceCents: 100_000_000,
      priceQuantity: 1000 as const,
      taxRateBasisPoints: 1900 as const,
      netCents: 0,
      source: null,
    };
    const parsed = parseDraftForm(
      draftFormOf({ ...DETAIL, ...terms, lines: Array.from({ length: 500 }, () => line) }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const save = { ...IDS, expectedVersion: 1, terms: parsed.terms, lines: parsed.lines };
    expect(saveInvoiceDraftSchema.safeParse(save).success).toBe(true);
  });

  test('refuses each broken rule on its own', () => {
    fc.assert(
      fc.property(saveArbitrary, fc.constantFrom(...violations), (save, [, violate]) => {
        const broken = violate(save);
        fc.pre(broken !== null);
        expect(saveInvoiceDraftSchema.safeParse(broken).success).toBe(false);
      }),
    );
  });
});

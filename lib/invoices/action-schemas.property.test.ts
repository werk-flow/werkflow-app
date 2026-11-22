import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  draftLineValuesArbitrary,
  invoiceTermsArbitrary,
  quantityThousandthsArbitrary,
} from '@/lib/testing/invoice-arbitraries';
import { saveInvoiceDraftSchema } from './action-schemas';

// Property tests (docs/technical/testing.md, "Property tests"). The save parses the server's own
// limits again (docs/features/commercial-and-finance.md, "Invoice drafts"): a quantity with at most
// three decimals, a net price in whole cents up to one million euros, VAT 19, 7 or 0 %, a
// Zahlungsziel of 0 to 365 days, a Skonto with both percent and days within the Zahlungsziel, and
// a service end on or after its start.

const IDS = {
  invoiceId: '00000000-0000-4000-8000-000000000001',
  attemptKey: '00000000-0000-4000-8000-000000000002',
};

const saveArbitrary = fc
  .tuple(
    invoiceTermsArbitrary,
    fc.array(draftLineValuesArbitrary(quantityThousandthsArbitrary), { maxLength: 20 }),
  )
  .map(([terms, lines]) => ({ ...IDS, expectedVersion: 1, terms, lines }));

type Save = typeof saveArbitrary extends fc.Arbitrary<infer T> ? T : never;

/** One broken rule at a time, each on a valid save. */
const violations: Array<[string, (save: Save) => Save | null]> = [
  [
    'a price in fractions of a cent',
    (save) => withFirstLine(save, (line) => ({ ...line, unitPriceCents: line.unitPriceCents + 0.5 })),
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
    (save) => ({ ...save, terms: { ...save.terms, discountDays: 1, discountBasisPoints: null } }),
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
  test('accepts every draft the editor can send', () => {
    fc.assert(
      fc.property(saveArbitrary, (save) => {
        expect(saveInvoiceDraftSchema.safeParse(save).success).toBe(true);
      }),
    );
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

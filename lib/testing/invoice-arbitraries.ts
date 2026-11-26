import fc from 'fast-check';
import type { PriceQuantity } from '@/lib/inventory/line-amount';
import { EMPTY_COMPANY_PROFILE_DETAILS } from '@/lib/company-profile/profile';
import { addLocalDays } from '@/lib/date-time/berlin';
import type { InvoiceDraft, InvoiceTax } from '@/lib/invoicing/model';
import { STANDARD_RATE_INVOICE } from '@/lib/invoicing/fixtures/reference-invoices';
import type { IssueSnapshot } from '@/lib/invoices/issue-model';
import { INVOICE_LINE_SOURCE_KINDS, type InvoiceLineSource } from '@/lib/invoices/line-sources';
import { INVOICE_TAX_RATES, type InvoiceLineValues, type InvoiceTerms } from '@/lib/invoices/types';
import { berlinDateArbitrary } from './berlin-arbitraries';

/**
 * Inputs for property tests of invoice amounts, and an oracle for the one rounding rule of the
 * invoice core: an exact quotient rounded half away from zero to the cent. The oracle works on the
 * quotient and its remainder, never on the module's formula.
 */

type InvoiceLine = InvoiceDraft['lines'][number];

const ZERO = BigInt(0);
const TWO = BigInt(2);

/** `numerator ÷ denominator` (denominator > 0) rounded half away from zero, by quotient and remainder. */
export function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const magnitude = numerator < ZERO ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const rounded = remainder * TWO >= denominator ? quotient + BigInt(1) : quotient;
  return numerator < ZERO ? -rounded : rounded;
}

/** A quantity's thousandths as the decimal string a line stores: 1500 → `1.5`, -125 → `-0.125`. */
export function quantityText(thousandths: bigint): string {
  const sign = thousandths < ZERO ? '-' : '';
  const magnitude = thousandths < ZERO ? -thousandths : thousandths;
  const whole = magnitude / BigInt(1000);
  const fraction = String(magnitude % BigInt(1000))
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Thousandths of a quantity a craftsman types: mostly small, sometimes the column's limit. */
export const quantityThousandthsArbitrary: fc.Arbitrary<bigint> = fc.oneof(
  { arbitrary: fc.bigInt({ min: BigInt(-100_000), max: BigInt(1_000_000) }), weight: 4 },
  { arbitrary: fc.bigInt({ min: BigInt(-999_999_999_999), max: BigInt(999_999_999_999) }), weight: 1 },
);

/** A net price in cents up to the catalog's one million euros. */
export const priceCentsArbitrary: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 100_000 }), weight: 4 },
  { arbitrary: fc.integer({ min: 0, max: 100_000_000 }), weight: 1 },
);

export const priceQuantityArbitrary: fc.Arbitrary<PriceQuantity> = fc.constantFrom(1, 10, 100, 1000);

const EXEMPTION = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';

/** The German rates, any other standard rate, a zero rate and one exemption. */
const invoiceTaxArbitrary: fc.Arbitrary<InvoiceTax> = fc.oneof(
  fc.constantFrom(1900, 700).map((rateBasisPoints): InvoiceTax => ({ category: 'S', rateBasisPoints })),
  fc
    .integer({ min: 1, max: 9999 })
    .map((rateBasisPoints): InvoiceTax => ({ category: 'S', rateBasisPoints })),
  fc.constant<InvoiceTax>({ category: 'Z' }),
  fc.constant<InvoiceTax>({ category: 'E', exemptionReason: EXEMPTION }),
);

/**
 * A line of up to 150 pieces. With at most 30 lines, a price up to one million euros and a rate
 * below 100 %, every VAT product stays a safe integer, so a property that expects amounts never
 * meets the overflow of werk-flow/werkflow-planning#520.
 */
const invoiceLineArbitrary: fc.Arbitrary<InvoiceLine> = fc
  .record({
    thousandths: fc.bigInt({ min: BigInt(-50_000), max: BigInt(150_000) }),
    unitPriceCents: priceCentsArbitrary,
    priceQuantity: priceQuantityArbitrary,
    tax: invoiceTaxArbitrary,
  })
  .map(({ thousandths, unitPriceCents, priceQuantity, tax }) => ({
    id: '1',
    name: 'Position',
    description: '',
    quantity: quantityText(thousandths),
    unitCode: 'H87',
    unitPriceCents,
    priceQuantity,
    tax,
  }));

/** A draft of the reference seller and buyer with 1 to 30 drawn lines, numbered in order. */
export const invoiceDraftArbitrary: fc.Arbitrary<InvoiceDraft> = fc
  .tuple(fc.array(invoiceLineArbitrary, { minLength: 1, maxLength: 30 }), fc.integer({ min: 0, max: 365 }))
  .map(([lines, dueInDays]) => ({
    ...STANDARD_RATE_INVOICE,
    paymentTerms: { dueInDays, discount: null },
    lines: lines.map((line, index) => ({ ...line, id: String(index + 1) })),
  }));

/** A draft line as the editor and the save send it, with quantities drawn from `thousandths`. */
export function draftLineValuesArbitrary(thousandths: fc.Arbitrary<bigint>): fc.Arbitrary<InvoiceLineValues> {
  return fc
    .record({
      thousandths,
      unitPriceCents: priceCentsArbitrary,
      priceQuantity: priceQuantityArbitrary,
      taxRateBasisPoints: fc.constantFrom(...INVOICE_TAX_RATES),
    })
    .map(({ thousandths: quantity, ...line }) => ({
      ...line,
      name: 'Heizkörper tauschen',
      description: '',
      quantity: quantityText(quantity),
      unit: 'piece',
    }));
}

/** A stored line's catalog source: none for a free line, else a Leistung or an article, current or archived. */
export const invoiceLineSourceArbitrary: fc.Arbitrary<InvoiceLineSource | null> = fc.option(
  fc.record({
    kind: fc.constantFrom(...INVOICE_LINE_SOURCE_KINDS),
    id: fc.uuid(),
    number: fc.option(fc.constantFrom('L-0001', 'A-1042'), { nil: null }),
    name: fc.constant('Heizkörper tauschen'),
    archived: fc.boolean(),
  }),
  { nil: null },
);

/** Draft terms the save accepts: an open, one-day or longer service, and a Skonto within the Zahlungsziel. */
export const invoiceTermsArbitrary: fc.Arbitrary<InvoiceTerms> = fc
  .record({
    serviceStart: fc.option(berlinDateArbitrary, { nil: null }),
    serviceLength: fc.integer({ min: 0, max: 60 }),
    paymentDueDays: fc.integer({ min: 0, max: 365 }),
    discount: fc.option(
      fc.record({
        basisPoints: fc.integer({ min: 1, max: 9999 }),
        share: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
      { nil: null },
    ),
  })
  .filter(({ discount, paymentDueDays }) => discount === null || paymentDueDays >= 1)
  .map(({ serviceStart, serviceLength, paymentDueDays, discount }) => ({
    serviceStart,
    serviceEnd: serviceStart === null ? null : addLocalDays(serviceStart, serviceLength),
    paymentDueDays,
    discountDays: discount === null ? null : Math.max(1, Math.floor(discount.share * paymentDueDays)),
    discountBasisPoints: discount === null ? null : discount.basisPoints,
    orderReference: '',
    buyerReference: '',
    openingText: '',
    closingText: '',
  }));

/** A complete issue snapshot of the made-up seller and buyer: the EN 16931 rules pass with it. */
export const ISSUE_SNAPSHOT: IssueSnapshot = {
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

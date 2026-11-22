import fc from 'fast-check';
import type { PriceQuantity } from '@/lib/inventory/line-amount';
import type { InvoiceDraft, InvoiceTax } from '@/lib/invoicing/model';
import { STANDARD_RATE_INVOICE } from '@/lib/invoicing/fixtures/reference-invoices';

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

/** A line whose amount stays within the draft's ten billion euros. */
const invoiceLineArbitrary: fc.Arbitrary<InvoiceLine> = fc
  .record({
    thousandths: fc.bigInt({ min: BigInt(-50_000), max: BigInt(500_000) }),
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

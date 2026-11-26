import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { saveInvoiceSettingsSchema, type InvoiceSettingsValues } from './settings';

// Property tests (docs/technical/testing.md, "Property tests"). The settings are those of
// docs/features/commercial-and-finance.md, "Invoice settings"; their limits are the save's own
// (settings.ts, checked again by the invoice_settings table): a prefix of up to 20 letters, digits and
// . _ / -, the year or not, 1 to 10 minimum digits and a next number from 1; a Zahlungsziel of 0 to
// 365 days; a Skonto with both percent and days, its days within the Zahlungsziel.

const settingsArbitrary: fc.Arbitrary<InvoiceSettingsValues> = fc
  .record({
    numberPrefix: fc.stringMatching(/^[A-Za-z0-9._/-]{0,20}$/),
    numberWithYear: fc.boolean(),
    numberMinDigits: fc.integer({ min: 1, max: 10 }),
    nextNumber: fc.integer({ min: 1, max: 999_999_998 }),
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
  .map(({ discount, ...settings }) => ({
    ...settings,
    discountDays:
      discount === null ? null : Math.max(1, Math.floor(discount.share * settings.paymentDueDays)),
    discountBasisPoints: discount === null ? null : discount.basisPoints,
  }));

const save = (settings: object) => ({
  organizationId: '00000000-0000-4000-8000-000000000001',
  expectedVersion: 0,
  settings,
});

/** One broken rule at a time, each on valid settings; null where the rule cannot break them. */
const violations: Array<[string, (settings: InvoiceSettingsValues) => object | null]> = [
  ['a space in the prefix', (settings) => ({ ...settings, numberPrefix: 'RE 2037' })],
  ['a prefix of 21 characters', (settings) => ({ ...settings, numberPrefix: 'R'.repeat(21) })],
  ['no minimum digit', (settings) => ({ ...settings, numberMinDigits: 0 })],
  ['eleven minimum digits', (settings) => ({ ...settings, numberMinDigits: 11 })],
  ['a next number of 0', (settings) => ({ ...settings, nextNumber: 0 })],
  ['a fractional next number', (settings) => ({ ...settings, nextNumber: 1.5 })],
  ['a Zahlungsziel beyond a year', (settings) => ({ ...settings, paymentDueDays: 366 })],
  ['a negative Zahlungsziel', (settings) => ({ ...settings, paymentDueDays: -1 })],
  [
    'Skonto days without a percentage',
    (settings) =>
      settings.paymentDueDays < 1 ? null : { ...settings, discountDays: 1, discountBasisPoints: null },
  ],
  [
    'a Skonto percentage without days',
    (settings) => ({ ...settings, discountDays: null, discountBasisPoints: 200 }),
  ],
  [
    'Skonto days past the Zahlungsziel',
    (settings) =>
      settings.paymentDueDays >= 365
        ? null
        : { ...settings, discountDays: settings.paymentDueDays + 1, discountBasisPoints: 200 },
  ],
  [
    'a Skonto of 100 %',
    (settings) => ({ ...settings, discountDays: 1, paymentDueDays: 14, discountBasisPoints: 10_000 }),
  ],
];

describe('The save of the invoice settings', () => {
  test('accepts every valid number series, Zahlungsziel and Skonto', () => {
    fc.assert(
      fc.property(settingsArbitrary, (settings) => {
        expect(saveInvoiceSettingsSchema.safeParse(save(settings)).success).toBe(true);
      }),
    );
  });

  test('refuses each broken rule on its own', () => {
    fc.assert(
      fc.property(settingsArbitrary, fc.constantFrom(...violations), (settings, [, violate]) => {
        const broken = violate(settings);
        fc.pre(broken !== null);
        expect(saveInvoiceSettingsSchema.safeParse(save(broken)).success).toBe(false);
      }),
    );
  });
});

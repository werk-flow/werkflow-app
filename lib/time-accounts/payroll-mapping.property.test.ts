import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  invalidPayrollCodeKeys,
  PAYROLL_CODE_MAX_LENGTH,
  PAYROLL_CODE_ROWS,
  payrollCodesByKey,
  toPayrollCodeMappings,
} from './payroll-mapping';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Payroll export": an Admin sets the Lohnart code of every classification before confirming, and
// an export is built from that mapping version. A saved version has a code for every row, and the
// form shows a saved version back exactly as it was saved.

const KEYS = PAYROLL_CODE_ROWS.map((row) => row.key);

/** A typed code: a usable one, blank, padded, or too long. */
const typedCodeArbitrary = fc.oneof(
  fc.stringMatching(/^[A-Z0-9]{1,8}$/),
  fc.constantFrom('', ' ', '\t'),
  fc.stringMatching(/^[A-Z0-9]{1,8}$/).map((code) => `  ${code} `),
  fc
    .string({ minLength: PAYROLL_CODE_MAX_LENGTH + 1, maxLength: PAYROLL_CODE_MAX_LENGTH + 5 })
    .map((code) => `X${code}`),
);

/** Typed codes for the form, some rows left out. */
const typedCodesArbitrary = fc
  .array(fc.option(typedCodeArbitrary, { nil: undefined, freq: 8 }), {
    minLength: KEYS.length,
    maxLength: KEYS.length,
  })
  .map((codes) => Object.fromEntries(KEYS.map((key, index) => [key, codes[index]])));

/** Every row typed with a usable code. */
const completeCodesArbitrary = fc
  .array(fc.stringMatching(/^ ?[A-Z0-9]{1,12} ?$/), { minLength: KEYS.length, maxLength: KEYS.length })
  .map((codes) => Object.fromEntries(KEYS.map((key, index) => [key, codes[index] ?? 'X'])));

describe('A payroll code mapping', () => {
  test('refuses exactly the rows whose code is empty or longer than allowed, in table order', () => {
    fc.assert(
      fc.property(typedCodesArbitrary, (codes) => {
        const refused = KEYS.filter((key) => {
          const code = (codes[key] ?? '').trim();
          return code.length === 0 || code.length > PAYROLL_CODE_MAX_LENGTH;
        });
        expect(invalidPayrollCodeKeys(codes)).toEqual(refused);
        expect(toPayrollCodeMappings(codes) === null).toBe(refused.length > 0);
      }),
    );
  });

  test('saves one trimmed code per classification and shows the saved version back unchanged', () => {
    fc.assert(
      fc.property(completeCodesArbitrary, (codes) => {
        const mappings = toPayrollCodeMappings(codes);
        expect(mappings).not.toBeNull();
        expect(mappings?.length).toBe(PAYROLL_CODE_ROWS.length);
        const shown = payrollCodesByKey(mappings);
        expect(shown).toEqual(Object.fromEntries(KEYS.map((key) => [key, (codes[key] ?? '').trim()])));
        expect(toPayrollCodeMappings(shown)).toEqual(mappings);
      }),
    );
  });

  test('shows a row a saved version lacks as empty, so the form refuses it instead of guessing', () => {
    fc.assert(
      fc.property(completeCodesArbitrary, fc.subarray(KEYS, { minLength: 1 }), (codes, dropped) => {
        const mappings = toPayrollCodeMappings(codes) ?? [];
        const stored = mappings.filter((_, index) => !dropped.includes(KEYS[index] ?? ''));
        const shown = payrollCodesByKey(stored);
        for (const key of dropped) expect(shown[key]).toBe('');
        expect(invalidPayrollCodeKeys(shown)).toEqual(KEYS.filter((key) => dropped.includes(key)));
      }),
    );
  });
});

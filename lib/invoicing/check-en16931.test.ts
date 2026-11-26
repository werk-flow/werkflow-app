import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { calculateInvoice } from './calculate';
import { BROKEN_INVOICES } from './fixtures/broken-invoices';
import { importLoadingSaxon } from './fixtures/saxon-import';
import { REFERENCE_INVOICES } from './fixtures/reference-invoices';
import { EN16931_CII_RULES } from './rules/manifest';
import { toEn16931 } from './to-en16931';

// The core's output against the CEN EN 16931 rules, run without Java. Every
// reference invoice passes; every broken copy is refused with the rule and the
// model field at fault, so the office sees what to fix.

const sha256 = (path: string) =>
  createHash('sha256')
    .update(readFileSync(new URL(path, import.meta.url)))
    .digest('hex');

const { checkEn16931 } = await importLoadingSaxon(() => import('./check-en16931'));

describe('checkEn16931', () => {
  test('the compiled rules are the recorded compilation of the vendored CEN release', () => {
    expect(sha256('./rules/EN16931-CII-validation.xslt')).toBe(EN16931_CII_RULES.xsltSha256);
    expect(sha256('./rules/en16931-cii.sef.json.gz')).toBe(EN16931_CII_RULES.sefGzipSha256);
  });

  for (const [name, draft] of Object.entries(REFERENCE_INVOICES)) {
    test(`the reference invoice ${name} passes every EN 16931 rule`, async () => {
      const check = await checkEn16931(toEn16931(calculateInvoice(draft)));
      expect(check.errors).toEqual([]);
      expect(check.valid).toBe(true);
      expect(check.rulesRelease).toBe(EN16931_CII_RULES.release);
    });
  }

  for (const broken of BROKEN_INVOICES) {
    test(`refuses ${broken.case} with ${broken.expected.ruleId} at ${broken.expected.field}`, async () => {
      const xml = toEn16931(calculateInvoice(broken.draft));
      const tampered = broken.tamper ? broken.tamper(xml) : xml;
      expect(tampered).not.toBe(broken.tamper ? xml : '');
      const check = await checkEn16931(tampered);
      expect(check.valid).toBe(false);
      expect(check.errors.map(({ ruleId, field }) => ({ ruleId, field }))).toContainEqual(broken.expected);
    });
  }

  test('XML the rules cannot read is never valid', async () => {
    await expect(checkEn16931('<Invoice xmlns="urn:example:not-cii"/>')).rejects.toThrow();
    await expect(checkEn16931('<rsm:CrossIndustryInvoice')).rejects.toThrow();
    // A fragment fires element rules but is no invoice.
    await expect(
      checkEn16931(
        '<ram:ChargeAmount xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">1.00</ram:ChargeAmount>',
      ),
    ).rejects.toThrow();
  });
});

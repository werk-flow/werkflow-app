// A downloaded original passes only as a PDF whose embedded ZUGFeRD XML names its number and type and
// passes the EN 16931 rules; a changed or missing XML is a finding. The invoices are the made-up
// reference invoices.
import { expect, test } from 'bun:test';

import { calculateInvoice } from '../../invoicing/calculate';
import { withChangedEmbeddedXml } from '../../invoicing/fixtures/broken-e-invoice-pdfs';
import { pdfCarrying } from '../../invoicing/fixtures/e-invoice-pdf';
import { STANDARD_RATE_INVOICE, STORNO_INVOICE } from '../../invoicing/fixtures/reference-invoices';
import { importLoadingSaxon } from '../../invoicing/fixtures/saxon-import';
import { toEn16931 } from '../../invoicing/to-en16931';

const { readOriginal } = await importLoadingSaxon(() => import('./original'));

test('an original names its number and type, passes the EN 16931 rules and is a ZUGFeRD container', async () => {
  const facts = await readOriginal(
    await pdfCarrying(toEn16931(calculateInvoice(STANDARD_RATE_INVOICE)), { zugferd: true }),
  );
  expect(facts).toMatchObject({
    number: STANDARD_RATE_INVOICE.number,
    typeCode: '380',
    failedRules: [],
    missingContainerMarks: [],
  });
  expect(facts.rulesRelease).toMatch(/^\d+\.\d+\.\d+$/);
  const storno = await readOriginal(await pdfCarrying(toEn16931(calculateInvoice(STORNO_INVOICE))));
  expect(storno).toMatchObject({ number: STORNO_INVOICE.number, typeCode: '384' });
});

test('intact XML in a bare PDF lacks the PDF/A-3 and Factur-X container marks', async () => {
  const facts = await readOriginal(await pdfCarrying(toEn16931(calculateInvoice(STANDARD_RATE_INVOICE))));
  expect(facts.failedRules).toEqual([]);
  expect(facts.missingContainerMarks).toEqual(['PDF/A-3', 'Factur-X', 'OutputIntent']);
});

test('a number in a comment never stands in for the document number', async () => {
  const xml = toEn16931(calculateInvoice(STANDARD_RATE_INVOICE)).replace(
    `<ram:ID>${STANDARD_RATE_INVOICE.number}</ram:ID>`,
    '<!--<ram:ID>RE-FAKE</ram:ID>--><ram:ID>RE-REAL</ram:ID>',
  );
  expect((await readOriginal(await pdfCarrying(xml))).number).toBe('RE-REAL');
});

test('XML changed after embedding names the rule it breaks', async () => {
  const changed = await withChangedEmbeddedXml(
    await pdfCarrying(toEn16931(calculateInvoice(STANDARD_RATE_INVOICE))),
  );
  expect((await readOriginal(changed)).failedRules).toContain('BR-CO-15');
});

test('a PDF without the embedded invoice, or XML without a document number, is a finding', async () => {
  await expect(readOriginal(await pdfCarrying(null))).rejects.toThrow(/no readable factur-x\.xml/);
  await expect(readOriginal(await pdfCarrying('<rsm:CrossIndustryInvoice/>'))).rejects.toThrow(
    /no readable CII invoice/,
  );
});

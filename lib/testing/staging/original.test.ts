// A downloaded original passes only as a PDF whose embedded ZUGFeRD XML names its number and type and
// passes the EN 16931 rules; a changed or missing XML is a finding. The invoices are the made-up
// reference invoices.
import { expect, test } from 'bun:test';
import { AFRelationship, PDFDocument } from 'pdf-lib';

import { calculateInvoice } from '../../invoicing/calculate';
import { E_INVOICE_FILE_NAME } from '../../invoicing/embedded-xml';
import { withChangedEmbeddedXml } from '../../invoicing/fixtures/broken-e-invoice-pdfs';
import { STANDARD_RATE_INVOICE, STORNO_INVOICE } from '../../invoicing/fixtures/reference-invoices';
import { toEn16931 } from '../../invoicing/to-en16931';
import { readOriginal } from './original';

async function originalOf(xml: string | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.addPage();
  if (xml !== null)
    await pdf.attach(new TextEncoder().encode(xml), E_INVOICE_FILE_NAME, {
      mimeType: 'text/xml',
      afRelationship: AFRelationship.Alternative,
    });
  return pdf.save();
}

test('an original names its number and type and passes the EN 16931 rules', async () => {
  const facts = await readOriginal(await originalOf(toEn16931(calculateInvoice(STANDARD_RATE_INVOICE))));
  expect(facts).toMatchObject({ number: STANDARD_RATE_INVOICE.number, typeCode: '380', failedRules: [] });
  expect(facts.rulesRelease).toMatch(/^\d+\.\d+\.\d+$/);
  const storno = await readOriginal(await originalOf(toEn16931(calculateInvoice(STORNO_INVOICE))));
  expect(storno).toMatchObject({ number: STORNO_INVOICE.number, typeCode: '384' });
});

test('XML changed after embedding names the rule it breaks', async () => {
  const changed = await withChangedEmbeddedXml(
    await originalOf(toEn16931(calculateInvoice(STANDARD_RATE_INVOICE))),
  );
  expect((await readOriginal(changed)).failedRules).toContain('BR-CO-15');
});

test('a PDF without the embedded invoice, or XML without a document number, is a finding', async () => {
  await expect(readOriginal(await originalOf(null))).rejects.toThrow(/no readable factur-x\.xml/);
  await expect(readOriginal(await originalOf('<rsm:CrossIndustryInvoice/>'))).rejects.toThrow(
    /no document number/,
  );
});

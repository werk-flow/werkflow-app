import { describe, expect, test } from 'bun:test';
import { AFRelationship, PDFDocument } from 'pdf-lib';

import { calculateInvoice } from './calculate';
import { E_INVOICE_FILE_NAME, readEmbeddedInvoiceXml } from './embedded-xml';
import { withChangedEmbeddedXml } from './fixtures/broken-e-invoice-pdfs';
import { STANDARD_RATE_INVOICE } from './fixtures/reference-invoices';
import { toEn16931 } from './to-en16931';

const xml = toEn16931(calculateInvoice(STANDARD_RATE_INVOICE));

/** A one-page PDF carrying `xml` as its embedded invoice, as the renderer attaches it. */
async function pdfWith(embedded: string | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.addPage();
  if (embedded !== null) {
    await pdf.attach(new TextEncoder().encode(embedded), E_INVOICE_FILE_NAME, {
      mimeType: 'text/xml',
      afRelationship: AFRelationship.Alternative,
    });
  }
  return pdf.save();
}

describe('reading the invoice XML back out of a finished PDF', () => {
  test('the embedded XML reads back exactly as written, umlauts included', async () => {
    const bytes = await pdfWith(xml);
    expect(await readEmbeddedInvoiceXml(bytes)).toBe(xml);
    expect(xml).toContain('Heizkörperventil');
  });

  test('XML changed after embedding reads back as the changed XML, never as what the core wrote', async () => {
    const changed = await withChangedEmbeddedXml(await pdfWith(xml));
    const readBack = await readEmbeddedInvoiceXml(changed);
    expect(readBack).not.toBe(xml);
    expect(readBack).toContain('<ram:GrandTotalAmount>281.45</ram:GrandTotalAmount>');
  });

  test('a PDF without the embedded invoice is a failure, never an empty match', async () => {
    const bytes = await pdfWith(null);
    await expect(readEmbeddedInvoiceXml(bytes)).rejects.toThrow('e_invoice_xml_missing');
  });
});

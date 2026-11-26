import { describe, expect, test } from 'bun:test';

import { calculateInvoice } from './calculate';
import { readEmbeddedInvoiceXml } from './embedded-xml';
import { withChangedEmbeddedXml } from './fixtures/broken-e-invoice-pdfs';
import { pdfCarrying } from './fixtures/e-invoice-pdf';
import { STANDARD_RATE_INVOICE } from './fixtures/reference-invoices';
import { toEn16931 } from './to-en16931';

const xml = toEn16931(calculateInvoice(STANDARD_RATE_INVOICE));

describe('reading the invoice XML back out of a finished PDF', () => {
  test('the embedded XML reads back exactly as written, umlauts included', async () => {
    const bytes = await pdfCarrying(xml);
    expect(await readEmbeddedInvoiceXml(bytes)).toBe(xml);
    expect(xml).toContain('Heizkörperventil');
  });

  test('XML changed after embedding reads back as the changed XML, never as what the core wrote', async () => {
    const changed = await withChangedEmbeddedXml(await pdfCarrying(xml));
    const readBack = await readEmbeddedInvoiceXml(changed);
    expect(readBack).not.toBe(xml);
    expect(readBack).toContain('<ram:GrandTotalAmount>281.45</ram:GrandTotalAmount>');
  });

  test('a PDF without the embedded invoice is a failure, never an empty match', async () => {
    const bytes = await pdfCarrying(null);
    await expect(readEmbeddedInvoiceXml(bytes)).rejects.toThrow('e_invoice_xml_missing');
  });
});

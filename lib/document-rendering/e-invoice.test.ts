import { describe, expect, mock, test } from 'bun:test';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  StandardFonts,
  decodePDFRawStream,
} from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

import { calculateInvoice } from '@/lib/invoicing/calculate';
import { readEmbeddedInvoiceXml } from '@/lib/invoicing/embedded-xml';
import {
  EXEMPT_INVOICE,
  REFERENCE_INVOICES,
  STANDARD_RATE_INVOICE,
  STORNO_INVOICE,
} from '@/lib/invoicing/fixtures/reference-invoices';
import type { InvoiceDraft } from '@/lib/invoicing/model';
import { toEn16931 } from '@/lib/invoicing/to-en16931';

import { invoiceDocument } from './invoice-layout';
import type { BusinessDocument } from './model';

mock.module('server-only', () => ({}));
const { renderEInvoicePdf } = await import('./e-invoice');

const LETTERHEAD = {
  sender: { name: 'Haustechnik Sonnenberg GmbH & Co. KG', addressLines: ['Sonnenweg 1'], logo: null },
  footerColumns: [['Haustechnik Sonnenberg GmbH & Co. KG', 'Sonnenweg 1, 01234 Sonnenstadt']],
  stationery: null,
};

async function rendered(draft: InvoiceDraft, letterhead: typeof LETTERHEAD | Letterhead = LETTERHEAD) {
  const invoice = calculateInvoice(draft);
  const xml = toEn16931(invoice);
  return { xml, bytes: await renderEInvoicePdf(invoiceDocument(invoice, letterhead), xml) };
}

type Letterhead = Pick<BusinessDocument, 'sender' | 'footerColumns' | 'stationery'>;

/** The first page's drawn images and forms (logo, stationery) and its font names. */
async function firstPageResources(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = pdf.getPage(0);
  const resources = page.node.Resources();
  const xObjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  const fonts = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const baseFonts = (fonts?.values() ?? []).map((ref) =>
    String(pdf.context.lookup(ref, PDFDict).get(PDFName.of('BaseFont'))),
  );
  return { xObjects: xObjects?.keys().length ?? 0, baseFonts };
}

/** The header of a CMYK JPEG: start of image and a frame with four components, enough for the embed check. */
const CMYK_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x14, 0x08, 0x00, 0x01, 0x00, 0x01, 0x04, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00,
  0x03, 0x11, 0x00, 0x04, 0x11, 0x00, 0xff, 0xd9,
]);
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP49OlHAwAJEwNdDFqrdgAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
);
const MARGINS = { topMm: 45, rightMm: 20, bottomMm: 30, leftMm: 25 };

async function textOf(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true });
  return text;
}

describe('the ZUGFeRD invoice PDF', () => {
  test('every reference invoice carries exactly the XML the core wrote, and renders to the same bytes again', async () => {
    for (const draft of Object.values(REFERENCE_INVOICES)) {
      const { xml, bytes } = await rendered(draft);
      expect(await readEmbeddedInvoiceXml(bytes)).toBe(xml);
      expect(Buffer.from((await rendered(draft)).bytes).equals(Buffer.from(bytes))).toBe(true);
    }
  });

  test('it declares PDF/A-3b and Factur-X EN 16931, an sRGB output intent and the XML as the alternative of the pages', async () => {
    const { bytes } = await rendered(STANDARD_RATE_INVOICE);
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const { catalog, context } = pdf;

    const metadata = catalog.lookup(PDFName.of('Metadata'));
    if (!(metadata instanceof PDFRawStream)) throw new Error('no metadata stream');
    expect(metadata.dict.has(PDFName.of('Filter'))).toBe(false);
    const xmp = new TextDecoder().decode(metadata.getContents());
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp).toContain('<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>');
    expect(xmp).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>');
    expect(xmp).toContain('<pdfaSchema:prefix>fx</pdfaSchema:prefix>');
    // Text from the profile is escaped, and the XMP agrees with the info dictionary.
    expect(xmp).toContain('<rdf:li>Haustechnik Sonnenberg GmbH &amp; Co. KG</rdf:li>');
    expect(pdf.getAuthor()).toBe('Haustechnik Sonnenberg GmbH & Co. KG');
    expect(xmp).toContain(`<rdf:li xml:lang="x-default">${pdf.getTitle()}</rdf:li>`);
    expect(xmp).toContain('<xmp:CreateDate>2026-11-14T00:00:00Z</xmp:CreateDate>');

    const [intent] = catalog.lookup(PDFName.of('OutputIntents'), PDFArray).asArray();
    const intentDict = context.lookup(intent, PDFDict);
    expect(intentDict.get(PDFName.of('S'))).toBe(PDFName.of('GTS_PDFA1'));
    const profile = intentDict.lookup(PDFName.of('DestOutputProfile'), PDFStream);
    expect(profile.dict.get(PDFName.of('N'))?.toString()).toBe('3');
    const icc = profile instanceof PDFRawStream ? decodePDFRawStream(profile).decode() : new Uint8Array();
    expect(new TextDecoder().decode(icc.slice(16, 20))).toBe('RGB ');

    const [spec] = catalog.lookup(PDFName.of('AF'), PDFArray).asArray();
    const specDict = context.lookup(spec, PDFDict);
    expect(specDict.get(PDFName.of('AFRelationship'))).toBe(PDFName.of('Alternative'));
    const file = specDict.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'), PDFStream);
    expect(file.dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('text/xml'));
    expect(file.dict.lookup(PDFName.of('Params'), PDFDict).has(PDFName.of('ModDate'))).toBe(true);

    expect(context.trailerInfo.ID?.toString()).toMatch(/^\[ <[0-9a-f]{32}> <[0-9a-f]{32}> \]$/);
  });

  test('the pages show number, dates, the period of service, lines, VAT per rate, Zahlungsziel and Skonto', async () => {
    const text = await textOf((await rendered(STANDARD_RATE_INVOICE)).bytes);
    for (const expected of [
      'Rechnung RE-2026-0001',
      'Rechnungsnummer RE-2026-0001',
      'Rechnungsdatum 14.11.2026',
      'Leistungszeitraum 03.11.2026 – 07.11.2026',
      'Bestellnummer B-4711',
      'USt-IdNr. DE123456789',
      'Hausverwaltung Lindenhof GmbH',
      '12,125 m',
      '12,34 €/100',
      '-35,00 €',
      '19 % 236,50 € 44,94 € 281,44 €',
      'Zahlbar ohne Abzug bis 28.11.2026. Bei Zahlung bis 21.11.2026 2 % Skonto.',
      'Bankverbindung: IBAN DE00 1111 1111 1111 1111 11, BIC BYLADEM1001',
    ])
      expect(text).toContain(expected);
  });

  test('an exempt invoice prints its own reason and no VAT; a Storno names the invoice it cancels and asks for no payment', async () => {
    const exempt = await textOf((await rendered(EXEMPT_INVOICE)).bytes);
    expect(exempt).toContain('steuerfrei 82,50 € 0,00 € 82,50 €');
    expect(exempt).toContain('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
    expect(exempt).toContain('Steuernummer 123/456/78901');

    const storno = await textOf((await rendered(STORNO_INVOICE)).bytes);
    expect(storno).toContain('Stornorechnung RE-2026-0003');
    expect(storno).toContain('Storno zu Rechnung RE-2026-0002\nvom 14.11.2026');
    expect(storno).not.toContain('Zahlbar');
    expect(storno).not.toContain('Bankverbindung');
  });

  test('a stationery PDF or a CMYK JPEG, which PDF/A-3b cannot vouch for, gives way to the plain letterhead; a PNG stays', async () => {
    const stationery = await PDFDocument.create({ updateMetadata: false });
    stationery
      .addPage()
      .drawText('Briefpapier', { font: await stationery.embedFont(StandardFonts.Helvetica) });
    const unsafe = await rendered(STANDARD_RATE_INVOICE, {
      ...LETTERHEAD,
      sender: { ...LETTERHEAD.sender, logo: { format: 'jpeg', bytes: CMYK_JPEG } },
      stationery: {
        firstPage: { file: { format: 'pdf', bytes: await stationery.save() }, margins: MARGINS },
        followingPages: null,
      },
    });
    const drawn = await firstPageResources(unsafe.bytes);
    expect(drawn.xObjects).toBe(0);
    expect(drawn.baseFonts.some((name) => name.includes('Helvetica'))).toBe(false);
    // The plain letterhead takes its place.
    expect(await textOf(unsafe.bytes)).toContain('Haustechnik Sonnenberg GmbH & Co. KG');

    const safe = await rendered(STANDARD_RATE_INVOICE, {
      ...LETTERHEAD,
      stationery: {
        firstPage: { file: { format: 'png', bytes: PNG }, margins: MARGINS },
        followingPages: { file: { format: 'jpeg', bytes: CMYK_JPEG }, margins: MARGINS },
      },
    });
    expect((await firstPageResources(safe.bytes)).xObjects).toBe(1);
  });
});

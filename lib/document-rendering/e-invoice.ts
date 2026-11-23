import 'server-only';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AFRelationship, JpegEmbedder, PDFHexString, PDFName, PDFString } from 'pdf-lib';

import { E_INVOICE_FILE_NAME, readEmbeddedInvoiceXml } from '@/lib/invoicing/embedded-xml';

import type { BusinessDocument, StationeryFile } from './model';
import { drawBusinessDocument } from './render';

// A ZUGFeRD / Factur-X invoice: the business document drawn by the one
// renderer, saved as PDF/A-3b with the EN 16931 XML embedded as
// `factur-x.xml` (relationship `Alternative`). A person reads the pages, a
// machine reads the XML; both come from the same invoice. The same input
// gives the same bytes. Mustang and veraPDF check the reference invoices in
// CI (fixtures/check-reference-e-invoices.ts). Nothing checks PDF/A at run
// time, so an invoice draws only what the renderer can vouch for (`pdfaSafe`).

/** The Factur-X profile the XML follows; the XMP names it, Mustang compares it with the XML. */
const FACTUR_X_CONFORMANCE_LEVEL = 'EN 16931';
const SRGB = 'sRGB IEC61966-2.1';

let iccBytes: Promise<Uint8Array> | null = null;

/** The sRGB profile of the output intent (CC0, `color/LICENSE-CC0.txt`); read once per server instance. */
function loadSrgbProfile(): Promise<Uint8Array> {
  iccBytes ??= readFile(new URL('./color/sRGB-v2-micro.icc', import.meta.url)).catch((error: unknown) => {
    iccBytes = null;
    throw error;
  });
  return iccBytes;
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * PDF/A-3b identification, the document info the PDF's info dictionary also
 * carries (they must agree), and the Factur-X extension schema with its values.
 */
function xmpMetadata(document: BusinessDocument, isoDate: string): string {
  const title = escapeXml(document.title);
  const author = escapeXml(document.sender.name);
  const property = (name: string, description: string) => `
          <rdf:li rdf:parseType="Resource">
            <pdfaProperty:name>${name}</pdfaProperty:name>
            <pdfaProperty:valueType>Text</pdfaProperty:valueType>
            <pdfaProperty:category>external</pdfaProperty:category>
            <pdfaProperty:description>${description}</pdfaProperty:description>
          </rdf:li>`;
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${author}</rdf:li></rdf:Seq></dc:creator>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>WerkFlow</xmp:CreatorTool>
      <xmp:CreateDate>${isoDate}</xmp:CreateDate>
      <xmp:ModifyDate>${isoDate}</xmp:ModifyDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>WerkFlow</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${E_INVOICE_FILE_NAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${FACTUR_X_CONFORMANCE_LEVEL}</fx:ConformanceLevel>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${property('DocumentFileName', 'Name of the embedded XML invoice file')}${property('DocumentType', 'INVOICE')}${property('Version', 'The actual version of the Factur-X XML schema')}${property('ConformanceLevel', 'The conformance level of the embedded Factur-X data')}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** The file if it is a PNG, or a JPEG in grey or RGB; a CMYK JPEG would need a CMYK output intent. */
async function pdfaSafeImage<File extends StationeryFile>(file: File | null): Promise<File | null> {
  if (!file || file.format === 'pdf') return null;
  if (file.format === 'png') return file;
  return (await JpegEmbedder.for(file.bytes)).colorSpace === 'DeviceCMYK' ? null : file;
}

/**
 * The document without what PDF/A-3b cannot vouch for: a stationery PDF may
 * carry unembedded fonts, CMYK or other content no run-time check reads, and
 * a CMYK JPEG needs another output intent. Such stationery gives way to the
 * plain letterhead and footer, such a logo to none.
 */
async function pdfaSafe(document: BusinessDocument): Promise<BusinessDocument> {
  const { stationery, sender } = document;
  const first = stationery && (await pdfaSafeImage(stationery.firstPage.file));
  const following = stationery?.followingPages ?? null;
  const followingFile = following && (await pdfaSafeImage(following.file));
  return {
    ...document,
    sender: { ...sender, logo: await pdfaSafeImage(sender.logo) },
    stationery:
      stationery && first
        ? {
            firstPage: { ...stationery.firstPage, file: first },
            followingPages: following && followingFile ? { ...following, file: followingFile } : null,
          }
        : null,
  };
}

/**
 * Renders an invoice document as a ZUGFeRD PDF/A-3b with `xml` embedded, then
 * reads the XML back out of the saved bytes: a PDF that does not carry exactly
 * that XML throws instead of being returned.
 */
export async function renderEInvoicePdf(input: BusinessDocument, xml: string): Promise<Uint8Array> {
  const document = await pdfaSafe(input);
  const pdf = await drawBusinessDocument(document);
  const date = new Date(`${document.issuedOn}T00:00:00Z`);
  const xmlBytes = new TextEncoder().encode(xml);
  const { context, catalog } = pdf;

  await pdf.attach(xmlBytes, E_INVOICE_FILE_NAME, {
    mimeType: 'text/xml',
    description: 'Rechnungsdaten nach EN 16931 (ZUGFeRD)',
    creationDate: date,
    modificationDate: date,
    afRelationship: AFRelationship.Alternative,
  });

  // PDF/A forbids a filter on the metadata stream, so it stays uncompressed.
  const xmp = context.stream(xmpMetadata(document, date.toISOString().replace('.000Z', 'Z')), {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  catalog.set(PDFName.of('Metadata'), context.register(xmp));

  const profile = context.register(context.flateStream(await loadSrgbProfile(), { N: 3 }));
  const outputIntent = context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of(SRGB),
    Info: PDFString.of(SRGB),
    DestOutputProfile: profile,
  });
  catalog.set(PDFName.of('OutputIntents'), context.obj([context.register(outputIntent)]));

  // PDF/A needs a file identifier; derived from the content, so a render repeats byte for byte.
  const id = createHash('sha256')
    .update(xmlBytes)
    .update(JSON.stringify([document.title, document.issuedOn, document.sender.name]))
    .digest('hex')
    .slice(0, 32);
  context.trailerInfo.ID = context.obj([PDFHexString.of(id), PDFHexString.of(id)]);

  const bytes = await pdf.save();
  if ((await readEmbeddedInvoiceXml(bytes)) !== xml) throw new Error('e_invoice_xml_mismatch');
  return bytes;
}

import { AFRelationship, PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { E_INVOICE_FILE_NAME } from '../embedded-xml';

/** The PDF/A-3 and Factur-X marks of the renderer's XMP (lib/document-rendering/e-invoice.ts), and no more. */
const ZUGFERD_XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>${E_INVOICE_FILE_NAME}</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>
</rdf:RDF></x:xmpmeta>`;

/**
 * A one-page PDF carrying `xml` as its embedded invoice, as the renderer attaches it; null attaches
 * none. `zugferd` adds the container marks a ZUGFeRD original carries: the XMP's PDF/A-3 and Factur-X
 * entries and a PDF/A output intent.
 */
export async function pdfCarrying(xml: string | null, { zugferd = false } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.addPage();
  if (xml !== null) {
    await pdf.attach(new TextEncoder().encode(xml), E_INVOICE_FILE_NAME, {
      mimeType: 'text/xml',
      afRelationship: AFRelationship.Alternative,
    });
  }
  if (zugferd) {
    const { context, catalog } = pdf;
    catalog.set(
      PDFName.of('Metadata'),
      context.register(context.stream(ZUGFERD_XMP, { Type: 'Metadata', Subtype: 'XML' })),
    );
    const intent = context.obj({
      Type: 'OutputIntent',
      S: 'GTS_PDFA1',
      OutputConditionIdentifier: PDFString.of('sRGB'),
    });
    catalog.set(PDFName.of('OutputIntents'), context.obj([context.register(intent)]));
  }
  return pdf.save();
}

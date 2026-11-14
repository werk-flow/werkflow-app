// Reads the invoice XML back out of a finished ZUGFeRD PDF. The PDF is only
// issued or sent when the file a machine reads is the file the core wrote and
// the rules checked: a changed or missing attachment is a failure.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';

/** The name ZUGFeRD 2 and Factur-X give the embedded invoice. */
export const E_INVOICE_FILE_NAME = 'factur-x.xml';

function textOf(value: unknown): string | null {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
}

/** The embedded `factur-x.xml` of a PDF as text; throws when the PDF has none. */
export async function readEmbeddedInvoiceXml(pdfBytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const files = pdf.catalog
    .lookupMaybe(PDFName.of('Names'), PDFDict)
    ?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
    ?.lookupMaybe(PDFName.of('Names'), PDFArray);
  const entries = files?.asArray() ?? [];
  for (let index = 0; index + 1 < entries.length; index += 2) {
    if (textOf(entries[index]) !== E_INVOICE_FILE_NAME) continue;
    const spec = pdf.context.lookup(entries[index + 1], PDFDict);
    const stream = spec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'), PDFRawStream);
    return new TextDecoder('utf-8', { fatal: true }).decode(decodePDFRawStream(stream).decode());
  }
  throw new Error('e_invoice_xml_missing');
}

/** Throws unless the PDF carries exactly `xml` as its embedded invoice. */
export async function verifyEmbeddedInvoiceXml(pdfBytes: Uint8Array, xml: string): Promise<void> {
  if ((await readEmbeddedInvoiceXml(pdfBytes)) !== xml) throw new Error('e_invoice_xml_mismatch');
}

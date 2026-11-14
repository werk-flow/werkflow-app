// Broken copies of a finished ZUGFeRD PDF. The read-back test and CI's
// Mustang and veraPDF job must refuse each one; a checker that accepts them
// checks nothing.

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

import { E_INVOICE_FILE_NAME } from '../embedded-xml';

/**
 * The PDF with its embedded invoice XML changed after embedding: the grand
 * total is one cent higher, so the XML no longer adds up (BR-CO-15) and no
 * longer matches what the core wrote.
 */
export async function withChangedEmbeddedXml(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const names = pdf.catalog
    .lookup(PDFName.of('Names'), PDFDict)
    .lookup(PDFName.of('EmbeddedFiles'), PDFDict)
    .lookup(PDFName.of('Names'), PDFArray)
    .asArray();
  const index = names.findIndex(
    (entry) =>
      (entry instanceof PDFString || entry instanceof PDFHexString) &&
      entry.decodeText() === E_INVOICE_FILE_NAME,
  );
  const spec = pdf.context.lookup(names[index + 1], PDFDict);
  const files = spec.lookup(PDFName.of('EF'), PDFDict);
  const original = files.lookup(PDFName.of('F'));
  if (!(original instanceof PDFRawStream)) throw new Error('fixture_embedded_file_unreadable');
  const xml = new TextDecoder().decode(decodePDFRawStream(original).decode());
  const changed = xml.replace(
    /<ram:GrandTotalAmount>(-?\d+)\.(\d{2})<\/ram:GrandTotalAmount>/,
    (_match, euros: string, cents: string) => {
      const total = BigInt(`${euros}${cents}`) + BigInt(1);
      const absolute = total < BigInt(0) ? -total : total;
      const sign = total < BigInt(0) ? '-' : '';
      return `<ram:GrandTotalAmount>${sign}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, '0')}</ram:GrandTotalAmount>`;
    },
  );
  if (changed === xml) throw new Error('fixture_grand_total_not_found');
  const stream = pdf.context.flateStream(new TextEncoder().encode(changed), {
    Type: 'EmbeddedFile',
    Subtype: 'text/xml',
  });
  for (const [key, value] of original.dict.entries()) {
    if (!stream.dict.has(key)) stream.dict.set(key, value);
  }
  files.set(PDFName.of('F'), pdf.context.register(stream));
  return pdf.save();
}

/** The PDF without its output intent, so its device RGB colours have no defined meaning (PDF/A-3 6.2.4.3). */
export async function withoutOutputIntent(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  pdf.catalog.delete(PDFName.of('OutputIntents'));
  return pdf.save();
}

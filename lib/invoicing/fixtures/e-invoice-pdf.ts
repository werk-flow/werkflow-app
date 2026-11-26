import { AFRelationship, PDFDocument } from 'pdf-lib';

import { E_INVOICE_FILE_NAME } from '../embedded-xml';

/** A one-page PDF carrying `xml` as its embedded invoice, as the renderer attaches it; null attaches none. */
export async function pdfCarrying(xml: string | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.addPage();
  if (xml !== null) {
    await pdf.attach(new TextEncoder().encode(xml), E_INVOICE_FILE_NAME, {
      mimeType: 'text/xml',
      afRelationship: AFRelationship.Alternative,
    });
  }
  return pdf.save();
}

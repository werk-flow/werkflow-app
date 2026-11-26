// What a staging journey checks in an invoice original it downloaded through the billing page
// (werk-flow/werkflow-planning#245): the ZUGFeRD XML embedded in the PDF passes the EN 16931 rules and
// names the invoice's number and type, in a ZUGFeRD PDF/A-3 container. It returns those, the failed
// rule ids and the missing container marks only, never the buyer, a line or an address.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import SaxonJS from 'saxon-js';

import { E_INVOICE_FILE_NAME, readEmbeddedInvoiceXml } from '../../invoicing/embedded-xml';
import { checkEn16931 } from '../../invoicing/check-en16931';
import { StagingFailure } from './runs';

export type OriginalFacts = {
  number: string;
  typeCode: string;
  /** The ids of the EN 16931 rules the XML fails, such as `BR-CO-15`; empty when it passes. */
  failedRules: string[];
  rulesRelease: string;
  /**
   * The ZUGFeRD container marks the PDF lacks: `PDF/A-3` and `Factur-X` in its XMP, the `AF` link to
   * the XML and a PDF/A `OutputIntent`. A full PDF/A validation is CI's veraPDF and Mustang job on the
   * renderer; this proves the downloaded file is that renderer's container, not a bare attachment.
   */
  missingContainerMarks: string[];
};

const CII = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
};

/** One element's text of the parsed CII invoice, so a comment or another element never stands in for it. */
function documentField(xml: string, field: 'ID' | 'TypeCode'): string {
  try {
    return String(
      SaxonJS.XPath.evaluate(
        `string(parse-xml($xml)/rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:${field})`,
        null,
        { namespaceContext: CII, params: { xml } },
      ),
    );
  } catch {
    throw new StagingFailure('The original holds no readable CII invoice.');
  }
}

function missingContainerMarks(pdf: PDFDocument): string[] {
  const metadata = pdf.catalog.lookup(PDFName.of('Metadata'));
  const xmp =
    metadata instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(metadata).decode()) : '';
  const intents = pdf.catalog.lookupMaybe(PDFName.of('OutputIntents'), PDFArray)?.asArray() ?? [];
  const marks: [string, boolean][] = [
    ['PDF/A-3', /<pdfaid:part>3<\/pdfaid:part>/.test(xmp)],
    ['Factur-X', xmp.includes(`<fx:DocumentFileName>${E_INVOICE_FILE_NAME}</fx:DocumentFileName>`)],
    ['AF', pdf.catalog.has(PDFName.of('AF'))],
    [
      'OutputIntent',
      intents.some(
        (intent) =>
          pdf.context.lookupMaybe(intent, PDFDict)?.get(PDFName.of('S')) === PDFName.of('GTS_PDFA1'),
      ),
    ],
  ];
  return marks.filter(([, present]) => !present).map(([mark]) => mark);
}

export async function readOriginal(pdf: Uint8Array): Promise<OriginalFacts> {
  let xml: string;
  try {
    xml = await readEmbeddedInvoiceXml(pdf);
  } catch {
    throw new StagingFailure('The downloaded PDF holds no readable factur-x.xml.');
  }
  const number = documentField(xml, 'ID');
  const typeCode = documentField(xml, 'TypeCode');
  if (!number || !typeCode) throw new StagingFailure('The original names no document number and type.');
  const check = await checkEn16931(xml);
  const container = await PDFDocument.load(pdf, { updateMetadata: false });
  return {
    number,
    typeCode,
    failedRules: check.errors.map((finding) => finding.ruleId),
    rulesRelease: check.rulesRelease,
    missingContainerMarks: missingContainerMarks(container),
  };
}

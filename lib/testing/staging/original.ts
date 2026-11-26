// What a staging journey checks in an invoice original it downloaded through the billing page
// (werk-flow/werkflow-planning#245): the ZUGFeRD XML embedded in the PDF passes the EN 16931 rules and
// names the invoice's number and type. It returns those and the failed rule ids only, never the buyer,
// a line or an address.

import { readEmbeddedInvoiceXml } from '../../invoicing/embedded-xml';
import { checkEn16931 } from '../../invoicing/check-en16931';
import { StagingFailure } from './runs';

export type OriginalFacts = {
  number: string;
  typeCode: string;
  /** The ids of the EN 16931 rules the XML fails, such as `BR-CO-15`; empty when it passes. */
  failedRules: string[];
  rulesRelease: string;
};

const DOCUMENT =
  /<rsm:ExchangedDocument>\s*<ram:ID>([^<]+)<\/ram:ID>\s*<ram:TypeCode>(\d{3})<\/ram:TypeCode>/;

export async function readOriginal(pdf: Uint8Array): Promise<OriginalFacts> {
  let xml: string;
  try {
    xml = await readEmbeddedInvoiceXml(pdf);
  } catch {
    throw new StagingFailure('The downloaded PDF holds no readable factur-x.xml.');
  }
  const [, number, typeCode] = DOCUMENT.exec(xml) ?? [];
  if (!number || !typeCode) throw new StagingFailure('The original names no document number and type.');
  const check = await checkEn16931(xml);
  return {
    number,
    typeCode,
    failedRules: check.errors.map((finding) => finding.ruleId),
    rulesRelease: check.rulesRelease,
  };
}

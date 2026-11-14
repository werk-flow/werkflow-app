import { describe, expect, test } from 'bun:test';

import { calculateInvoice } from './calculate';
import { EXEMPT_INVOICE, STANDARD_RATE_INVOICE, STORNO_INVOICE } from './fixtures/reference-invoices';
import { toEn16931 } from './to-en16931';

// What the EN 16931 rules cannot demand but the model says: the CEN rules
// accept a 384 without its original and payment terms without Skonto.
describe('toEn16931', () => {
  test('a Storno is type 384 and names the invoice it cancels (BG-3)', () => {
    const xml = toEn16931(calculateInvoice(STORNO_INVOICE));
    expect(xml).toContain('<ram:TypeCode>384</ram:TypeCode>');
    expect(xml).toMatch(
      /<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>RE-2026-0002<\/ram:IssuerAssignedID>\s*<ram:FormattedIssueDateTime>\s*<qdt:DateTimeString format="102">20261114</,
    );
    // Nothing is owed on a Storno, so it carries no payment terms.
    expect(xml).not.toContain('SpecifiedTradePaymentTerms');
  });

  test('Zahlungsziel and Skonto reach the payment terms, with the structured Skonto line', () => {
    const xml = toEn16931(calculateInvoice(STANDARD_RATE_INVOICE));
    expect(xml).toContain('Zahlbar ohne Abzug bis 28.11.2026.');
    expect(xml).toContain('Bei Zahlung innerhalb von 7 Tagen 2,00 % Skonto.');
    expect(xml).toContain('#SKONTO#TAGE=7#PROZENT=2.00#');
    expect(xml).toMatch(/<ram:DueDateDateTime>\s*<udt:DateTimeString format="102">20261128</);
  });

  test('a period of service is the billing period; a date of service the delivery date', () => {
    expect(toEn16931(calculateInvoice(STANDARD_RATE_INVOICE))).toMatch(
      /<ram:BillingSpecifiedPeriod>\s*<ram:StartDateTime>\s*<udt:DateTimeString format="102">20261103</,
    );
    expect(toEn16931(calculateInvoice(EXEMPT_INVOICE))).toMatch(
      /<ram:ActualDeliverySupplyChainEvent>\s*<ram:OccurrenceDateTime>\s*<udt:DateTimeString format="102">20261110</,
    );
  });

  test('text keeps what looks like an entity reference: the writer decodes none of it', () => {
    const [first] = STANDARD_RATE_INVOICE.lines;
    if (!first) throw new Error('fixture without lines');
    const xml = toEn16931(
      calculateInvoice({
        ...STANDARD_RATE_INVOICE,
        buyer: { ...STANDARD_RATE_INVOICE.buyer, name: 'Müller & Söhne &amp; Co' },
        lines: [{ ...first, name: 'Ersatzteil &lt;A&gt; "B"' }],
      }),
    );
    expect(xml).toContain('<ram:Name>Müller &amp; Söhne &amp;amp; Co</ram:Name>');
    expect(xml).toContain('<ram:Name>Ersatzteil &amp;lt;A&amp;gt; "B"</ram:Name>');
  });

  test('text with a control character XML 1.0 cannot carry is refused, never written', () => {
    const draft = {
      ...STANDARD_RATE_INVOICE,
      seller: { ...STANDARD_RATE_INVOICE.seller, name: 'Sonnenberg\u000BGmbH' },
    };
    expect(() => toEn16931(calculateInvoice(draft))).toThrow(RangeError);
  });

  test('the § 19 exemption carries its reason and a zero rate', () => {
    const xml = toEn16931(calculateInvoice(EXEMPT_INVOICE));
    expect(xml).toContain(
      '<ram:ExemptionReason>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</ram:ExemptionReason>',
    );
    expect(xml).toContain('<ram:CategoryCode>E</ram:CategoryCode>');
    expect(xml).toContain('<ram:RateApplicablePercent>0.00</ram:RateApplicablePercent>');
  });
});

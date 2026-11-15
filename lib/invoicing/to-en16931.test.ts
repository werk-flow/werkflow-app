import { describe, expect, test } from 'bun:test';

import { calculateInvoice } from './calculate';
import {
  CARD_INVOICE,
  DIRECT_DEBIT_INVOICE,
  EXEMPT_INVOICE,
  STANDARD_RATE_INVOICE,
  STORNO_INVOICE,
} from './fixtures/reference-invoices';
import type { InvoiceDraft } from './model';
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

  test('an unpaired surrogate is refused, a surrogate pair is written', () => {
    const lone = {
      ...STANDARD_RATE_INVOICE,
      seller: { ...STANDARD_RATE_INVOICE.seller, name: 'Sonnenberg\uD800' },
    };
    expect(() => toEn16931(calculateInvoice(lone))).toThrow(RangeError);
    const pair = {
      ...STANDARD_RATE_INVOICE,
      seller: { ...STANDARD_RATE_INVOICE.seller, name: 'Sonnenberg \u{1F527}' },
    };
    expect(toEn16931(calculateInvoice(pair))).toContain('Sonnenberg \u{1F527}');
  });

  test('the § 19 exemption carries its reason and a zero rate', () => {
    const xml = toEn16931(calculateInvoice(EXEMPT_INVOICE));
    expect(xml).toContain(
      '<ram:ExemptionReason>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</ram:ExemptionReason>',
    );
    expect(xml).toContain('<ram:CategoryCode>E</ram:CategoryCode>');
    expect(xml).toContain('<ram:RateApplicablePercent>0.00</ram:RateApplicablePercent>');
  });

  test('a direct debit is code 59 with the creditor ID (BT-90) and the mandate reference (BT-89)', () => {
    const xml = toEn16931(calculateInvoice(DIRECT_DEBIT_INVOICE));
    expect(xml).toMatch(
      /<ram:ApplicableHeaderTradeSettlement>\s*<ram:CreditorReferenceID>DE98ZZZ09999999999</,
    );
    expect(xml).toMatch(
      /<ram:SpecifiedTradeSettlementPaymentMeans>\s*<ram:TypeCode>59<\/ram:TypeCode>\s*<\/ram/,
    );
    expect(xml).toContain('<ram:DirectDebitMandateID>MUSTERMANDAT0001</ram:DirectDebitMandateID>');
    expect(xml).toContain('Der Betrag wird per SEPA-Lastschrift eingezogen.');
    expect(xml).not.toContain('TotalPrepaidAmount');
  });

  test('a debit names a collection as done only when a payment is recorded', () => {
    const [line] = DIRECT_DEBIT_INVOICE.lines;
    if (!line) throw new Error('fixture without lines');
    const text = (draft: InvoiceDraft) =>
      /<ram:SpecifiedTradePaymentTerms>\s*<ram:Description>([^<]*)</.exec(
        toEn16931(calculateInvoice(draft)),
      )?.[1];
    expect(text({ ...DIRECT_DEBIT_INVOICE, paidCents: 49900 })).toBe(
      'Der Betrag wurde per SEPA-Lastschrift eingezogen.\n',
    );
    const nothingCollected = 'Es wird nichts per SEPA-Lastschrift eingezogen.\n';
    expect(text({ ...DIRECT_DEBIT_INVOICE, lines: [{ ...line, unitPriceCents: 0 }] })).toBe(nothingCollected);
    expect(
      text({
        ...DIRECT_DEBIT_INVOICE,
        typeCode: '384',
        precedingInvoice: { number: 'MUSTER-0001', issueDate: '2026-11-15' },
        lines: [{ ...line, quantity: '-1' }],
      }),
    ).toBe(nothingCollected);
  });

  test("a seller identifier (BT-29) comes before the seller's name: its ID without a scheme, its global ID with one", () => {
    const xml = toEn16931(calculateInvoice(DIRECT_DEBIT_INVOICE));
    expect(xml).toMatch(/<ram:SellerTradeParty>\s*<ram:ID>DE98ZZZ09999999999<\/ram:ID>\s*<ram:Name>/);
    expect(xml).toMatch(
      /<ram:SpecifiedTaxRegistration>\s*<ram:ID schemeID="FC">12\/345\/67890<\/ram:ID>\s*<\/ram:SpecifiedTaxRegistration>\s*<\/ram:SellerTradeParty>/,
    );
    const gln = toEn16931(
      calculateInvoice({
        ...DIRECT_DEBIT_INVOICE,
        seller: { ...DIRECT_DEBIT_INVOICE.seller, identifier: { id: '4000001000005', scheme: '0088' } },
      }),
    );
    expect(gln).toMatch(
      /<ram:SellerTradeParty>\s*<ram:GlobalID schemeID="0088">4000001000005<\/ram:GlobalID>\s*<ram:Name>/,
    );
  });

  test('a settled card payment is code 48 with the last four digits, paid in full and owing nothing', () => {
    const xml = toEn16931(calculateInvoice(CARD_INVOICE));
    expect(xml).toMatch(
      /<ram:TypeCode>48<\/ram:TypeCode>\s*<ram:ApplicableTradeSettlementFinancialCard>\s*<ram:ID>4242<\/ram:ID>/,
    );
    expect(xml).toContain('<ram:TotalPrepaidAmount>499.00</ram:TotalPrepaidAmount>');
    expect(xml).toContain('<ram:DuePayableAmount>0.00</ram:DuePayableAmount>');
    expect(xml).not.toContain('SpecifiedTradePaymentTerms');
    expect(xml).not.toContain('CreditorReferenceID');
  });
});

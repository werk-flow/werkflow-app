// The EN 16931 mapping of the invoice core: a calculated invoice becomes
// ZUGFeRD / Factur-X XML in the EN 16931 profile (UN/CEFACT CII D16B). This is
// the only file that touches the XML writer library, so the writer stays
// swappable. It writes the computed amounts as they are and computes none.

import { create } from 'xmlbuilder2';

import { formatGermanDate } from '@/lib/utils';

import { taxRateBasisPoints } from './calculate';
import type { CalculatedInvoice, InvoiceParty, InvoiceSeller, InvoiceTax } from './model';

/** The ZUGFeRD and Factur-X profile id of EN 16931 ("COMFORT"). */
const EN16931_PROFILE = 'urn:cen.eu:en16931:2017';

/** SEPA credit transfer (UNTDID 4461). */
const SEPA_CREDIT_TRANSFER = '58';

type XmlNode = { [element: string]: string | XmlNode | XmlNode[] };

/** Cents as a decimal amount with two places: -350 → `-3.50`. */
function amount(cents: number): string {
  const magnitude = Math.abs(cents);
  const text = `${Math.trunc(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}

/** Basis points as a percentage: 1900 → `19.00`. */
function percent(basisPoints: number): string {
  return `${Math.trunc(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` as UN/CEFACT format 102. */
const dateTime = (date: string, prefix: 'udt' | 'qdt' = 'udt'): XmlNode => ({
  [`${prefix}:DateTimeString`]: { '@format': '102', '#': date.replaceAll('-', '') },
});

/** The VAT element of a line or a breakdown row; `amounts` only on a breakdown row, in CII's order. */
function tradeTax(tax: InvoiceTax, amounts?: { basisCents: number; taxCents: number }): XmlNode {
  return {
    ...(amounts ? { 'ram:CalculatedAmount': amount(amounts.taxCents) } : {}),
    'ram:TypeCode': 'VAT',
    ...(amounts && tax.category === 'E' && tax.exemptionReason
      ? { 'ram:ExemptionReason': tax.exemptionReason }
      : {}),
    ...(amounts ? { 'ram:BasisAmount': amount(amounts.basisCents) } : {}),
    'ram:CategoryCode': tax.category,
    'ram:RateApplicablePercent': percent(taxRateBasisPoints(tax)),
  };
}

function postalAddress(address: InvoiceParty['address']): XmlNode {
  const [lineOne, lineTwo, lineThree] = address.lines;
  return {
    'ram:PostcodeCode': address.postalCode,
    ...(lineOne ? { 'ram:LineOne': lineOne } : {}),
    ...(lineTwo ? { 'ram:LineTwo': lineTwo } : {}),
    ...(lineThree ? { 'ram:LineThree': lineThree } : {}),
    'ram:CityName': address.city,
    'ram:CountryID': address.countryCode,
  };
}

function tradeParty(party: InvoiceParty | InvoiceSeller): XmlNode {
  const registrations: XmlNode[] = [];
  if (party.vatId) registrations.push({ 'ram:ID': { '@schemeID': 'VA', '#': party.vatId } });
  if ('taxNumber' in party && party.taxNumber) {
    registrations.push({ 'ram:ID': { '@schemeID': 'FC', '#': party.taxNumber } });
  }
  const registration = 'legalRegistrationId' in party ? party.legalRegistrationId : null;
  return {
    'ram:Name': party.name,
    ...(registration ? { 'ram:SpecifiedLegalOrganization': { 'ram:ID': registration } } : {}),
    'ram:PostalTradeAddress': postalAddress(party.address),
    ...(party.email
      ? { 'ram:URIUniversalCommunication': { 'ram:URIID': { '@schemeID': 'EM', '#': party.email } } }
      : {}),
    ...(registrations.length ? { 'ram:SpecifiedTaxRegistration': registrations } : {}),
  };
}

/**
 * Zahlungsziel and Skonto as BT-20 text. Skonto also takes the structured
 * line `#SKONTO#TAGE=n#PROZENT=p#` that German receivers read.
 */
function paymentTermsText(invoice: CalculatedInvoice): string {
  const lines = [`Zahlbar ohne Abzug bis ${formatGermanDate(invoice.dueDate)}.`];
  const { discount } = invoice.paymentTerms;
  if (discount) {
    lines.push(
      `Bei Zahlung innerhalb von ${discount.days} Tagen ${percent(discount.percentBasisPoints).replace('.', ',')} % Skonto.`,
      `#SKONTO#TAGE=${discount.days}#PROZENT=${percent(discount.percentBasisPoints)}#`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function lineItem(line: CalculatedInvoice['lines'][number]): XmlNode {
  return {
    'ram:AssociatedDocumentLineDocument': { 'ram:LineID': line.id },
    'ram:SpecifiedTradeProduct': {
      'ram:Name': line.name,
      ...(line.description ? { 'ram:Description': line.description } : {}),
    },
    'ram:SpecifiedLineTradeAgreement': {
      'ram:NetPriceProductTradePrice': {
        'ram:ChargeAmount': amount(line.unitPriceCents),
        'ram:BasisQuantity': { '@unitCode': line.unitCode, '#': String(line.priceQuantity) },
      },
    },
    'ram:SpecifiedLineTradeDelivery': {
      'ram:BilledQuantity': { '@unitCode': line.unitCode, '#': line.quantity },
    },
    'ram:SpecifiedLineTradeSettlement': {
      'ram:ApplicableTradeTax': tradeTax(line.tax),
      'ram:SpecifiedTradeSettlementLineMonetarySummation': { 'ram:LineTotalAmount': amount(line.netCents) },
    },
  };
}

/** BG-16, BG-23, BG-14, BT-20, BG-22 and BG-3: how much is owed, for what, and how to pay. */
function headerSettlement(invoice: CalculatedInvoice): XmlNode {
  const { delivery, payee, totals } = invoice;
  const owed = totals.grossCents > 0;
  return {
    'ram:InvoiceCurrencyCode': invoice.currency,
    ...(payee && owed
      ? {
          'ram:SpecifiedTradeSettlementPaymentMeans': {
            'ram:TypeCode': SEPA_CREDIT_TRANSFER,
            'ram:PayeePartyCreditorFinancialAccount': {
              'ram:IBANID': payee.iban,
              ...(payee.accountName ? { 'ram:AccountName': payee.accountName } : {}),
            },
            ...(payee.bic
              ? { 'ram:PayeeSpecifiedCreditorFinancialInstitution': { 'ram:BICID': payee.bic } }
              : {}),
          },
        }
      : {}),
    'ram:ApplicableTradeTax': invoice.taxSubtotals.map((row) => tradeTax(row.tax, row)),
    ...(delivery.kind === 'period'
      ? {
          'ram:BillingSpecifiedPeriod': {
            'ram:StartDateTime': dateTime(delivery.start),
            'ram:EndDateTime': dateTime(delivery.end),
          },
        }
      : {}),
    ...(owed
      ? {
          'ram:SpecifiedTradePaymentTerms': {
            'ram:Description': paymentTermsText(invoice),
            'ram:DueDateDateTime': dateTime(invoice.dueDate),
          },
        }
      : {}),
    'ram:SpecifiedTradeSettlementHeaderMonetarySummation': {
      'ram:LineTotalAmount': amount(totals.lineNetCents),
      'ram:TaxBasisTotalAmount': amount(totals.lineNetCents),
      'ram:TaxTotalAmount': { '@currencyID': invoice.currency, '#': amount(totals.taxCents) },
      'ram:GrandTotalAmount': amount(totals.grossCents),
      'ram:DuePayableAmount': amount(totals.grossCents),
    },
    ...(invoice.precedingInvoice
      ? {
          'ram:InvoiceReferencedDocument': {
            'ram:IssuerAssignedID': invoice.precedingInvoice.number,
            'ram:FormattedIssueDateTime': dateTime(invoice.precedingInvoice.issueDate, 'qdt'),
          },
        }
      : {}),
  };
}

/** The invoice as ZUGFeRD EN 16931 CII XML, UTF-8 text. */
export function toEn16931(invoice: CalculatedInvoice): string {
  const { delivery } = invoice;
  const document: XmlNode = {
    'rsm:CrossIndustryInvoice': {
      '@xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
      '@xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
      '@xmlns:qdt': 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
      '@xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
      'rsm:ExchangedDocumentContext': {
        'ram:GuidelineSpecifiedDocumentContextParameter': { 'ram:ID': EN16931_PROFILE },
      },
      'rsm:ExchangedDocument': {
        'ram:ID': invoice.number,
        'ram:TypeCode': invoice.typeCode,
        'ram:IssueDateTime': dateTime(invoice.issueDate),
        ...(invoice.notes.length
          ? { 'ram:IncludedNote': invoice.notes.map((note) => ({ 'ram:Content': note })) }
          : {}),
      },
      'rsm:SupplyChainTradeTransaction': {
        'ram:IncludedSupplyChainTradeLineItem': invoice.lines.map(lineItem),
        'ram:ApplicableHeaderTradeAgreement': {
          ...(invoice.buyerReference ? { 'ram:BuyerReference': invoice.buyerReference } : {}),
          'ram:SellerTradeParty': tradeParty(invoice.seller),
          'ram:BuyerTradeParty': tradeParty(invoice.buyer),
          ...(invoice.orderReference
            ? { 'ram:BuyerOrderReferencedDocument': { 'ram:IssuerAssignedID': invoice.orderReference } }
            : {}),
        },
        'ram:ApplicableHeaderTradeDelivery': {
          ...(invoice.deliverTo
            ? {
                'ram:ShipToTradeParty': {
                  'ram:Name': invoice.deliverTo.name,
                  'ram:PostalTradeAddress': postalAddress(invoice.deliverTo.address),
                },
              }
            : {}),
          ...(delivery.kind === 'date'
            ? { 'ram:ActualDeliverySupplyChainEvent': { 'ram:OccurrenceDateTime': dateTime(delivery.date) } }
            : {}),
        },
        'ram:ApplicableHeaderTradeSettlement': headerSettlement(invoice),
      },
    },
  };
  return create({ version: '1.0', encoding: 'UTF-8' }, document).end({ prettyPrint: true });
}

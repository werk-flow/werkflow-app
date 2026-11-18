import type { ActionFailure } from '@/lib/action-result';
import { saveCompanyProfileInputSchema, type CompanyProfileDetails } from '@/lib/company-profile/profile';
import type { En16931Finding } from '@/lib/invoicing/check-en16931';
import type { InvoiceDraft, InvoiceParty } from '@/lib/invoicing/model';
import { isInventoryUnitCode, type InventoryUnitCode } from '@/lib/inventory/units';
import { z } from '@/lib/zod';
import type { InvoiceDetail } from './types';

// What an issued invoice says, mapped into the invoice core's plain model.
// Seller and letterhead come from one company-profile snapshot taken at issue
// and stored with the invoice, beside the Rechnungsempfänger's name and
// address, so the checked XML, the stored invoice and every rendering of its
// original agree. Lines and terms are the invoice's own, frozen at issue.

/** UN/ECE Recommendation 20 or 21 code of each unit (EN 16931 BT-130). */
const UN_ECE_UNIT_CODES: Record<InventoryUnitCode, string> = {
  piece: 'H87',
  meter: 'MTR',
  square_meter: 'MTK',
  cubic_meter: 'MTQ',
  kilometer: 'KMT',
  liter: 'LTR',
  kilogram: 'KGM',
  hour: 'HUR',
  day: 'DAY',
  flat_rate: 'LS',
  roll: 'XRO',
  package: 'XPK',
  box: 'XCT',
  set: 'SET',
  pair: 'PR',
  sack: 'XSA',
  cartridge: 'XCQ',
  bundle: 'XBE',
  pallet: 'XPX',
  rod: 'XRD',
  coil: 'XRG',
};

const postalAddressSchema = z.object({
  lines: z.array(z.string()).min(1).max(3),
  postalCode: z.string(),
  city: z.string(),
  countryCode: z.string(),
});
const storedFileSchema = z.object({ path: z.string(), mimeType: z.string() }).nullable();

/** The snapshot `issue_invoice` stores: the seller's profile with its letterhead files, and the buyer. */
export const issueSnapshotSchema = z.object({
  organizationName: z.string(),
  profile: saveCompanyProfileInputSchema.shape.details,
  files: z.object({
    logo: storedFileSchema,
    stationery_first: storedFileSchema,
    stationery_following: storedFileSchema,
  }),
  /** The Rechnungsempfänger: the party the invoice is addressed to and who pays it. */
  buyer: z.object({ name: z.string(), address: postalAddressSchema }),
});
export type IssueSnapshot = z.output<typeof issueSnapshotSchema>;

const POSTAL_CODE_AND_CITY = /^(?:D-)?(\d{5})\s+(\S.*)$/;

/**
 * A customer's address text („Hofweg 1, 10117 Berlin“, also over several
 * lines) as a German postal address: one to three lines, then postal code and
 * city. Null when the last part does not read as five digits and a city.
 */
export function postalAddressOf(text: string | null): InvoiceParty['address'] | null {
  const parts = (text ?? '')
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const [, postalCode, city] = POSTAL_CODE_AND_CITY.exec(parts.at(-1) ?? '') ?? [];
  if (!postalCode || !city || parts.length < 2 || parts.length > 4) return null;
  return { lines: parts.slice(0, -1), postalCode, city, countryCode: 'DE' };
}

/** The company profile as the invoice's seller; an empty field is no value. */
export function sellerOf(details: CompanyProfileDetails, organizationName: string): InvoiceDraft['seller'] {
  return {
    name: details.companyName || organizationName,
    address: {
      lines: [details.street],
      postalCode: details.postalCode,
      city: details.city,
      countryCode: 'DE',
    },
    vatId: details.vatId || null,
    taxNumber: details.taxNumber || null,
    legalRegistrationId: details.registerNumber || null,
    email: details.email || null,
  };
}

/** The profile's bank account as the payee of a SEPA credit transfer; none without an IBAN. */
export function payeeOf(details: CompanyProfileDetails): InvoiceDraft['payee'] {
  const iban = details.iban.replaceAll(/\s/g, '');
  return iban ? { iban, bic: details.bic.replaceAll(/\s/g, '') || null, accountName: null } : null;
}

/** What the office fills in under „Dokumente & Briefpapier“ for a refused rule or field. */
const PROFILE_FIELD_LABELS: Record<string, string> = {
  'BR-CO-26': 'USt-IdNr. oder Handelsregisternummer',
  'BR-S-02': 'USt-IdNr. oder Steuernummer',
  'seller.name': 'Firmenname',
  'seller.address': 'Anschrift',
  'seller.email': 'E-Mail-Adresse',
  'payee.iban': 'IBAN',
  payee: 'Bankverbindung',
};

/** The company-profile field a refused rule or field names; null when the profile is not at fault. */
export function profileFieldLabel(finding: En16931Finding): string | null {
  return PROFILE_FIELD_LABELS[finding.ruleId] ?? PROFILE_FIELD_LABELS[finding.field] ?? null;
}

/** One thing that keeps a draft from being issued, in the office's words, with where to fix it. */
export type IssueFinding = { label: string; href: string | null };

/** An invoice that fails the check before its number: what is wrong, in the office's words. */
export type InvoiceCheckFailure = ActionFailure<'invoice_check_failed'> & { findings: IssueFinding[] };

const LINE_FIELD = /^lines\[(\d+)\]/;

/** The rule check's findings in the office's words; a finding repeated on several fields shows once. */
export function issueFindingsOf(errors: readonly En16931Finding[], recipientId: string): IssueFinding[] {
  const findings = errors.map((error): IssueFinding => {
    const profileLabel = profileFieldLabel(error);
    if (profileLabel) {
      return {
        label: `Firmenangaben: ${profileLabel} fehlt oder passt nicht (Regel ${error.ruleId})`,
        href: '/einstellungen/dokumente',
      };
    }
    if (error.field.startsWith('buyer')) {
      return {
        label: `Rechnungsempfänger: Name oder Anschrift (Regel ${error.ruleId})`,
        href: `/kunden/${recipientId}`,
      };
    }
    const line = LINE_FIELD.exec(error.field)?.[1];
    if (line !== undefined)
      return { label: `Position ${Number(line) + 1} (Regel ${error.ruleId})`, href: null };
    return { label: `Angabe ${error.field} (Regel ${error.ruleId})`, href: null };
  });
  return [...new Map(findings.map((finding) => [finding.label, finding])).values()];
}

type IssuedFacts = Pick<
  InvoiceDetail,
  | 'serviceStart'
  | 'serviceEnd'
  | 'paymentDueDays'
  | 'discountDays'
  | 'discountBasisPoints'
  | 'orderReference'
  | 'buyerReference'
  | 'openingText'
  | 'closingText'
  | 'lines'
>;

/**
 * The invoice as the core's draft, under the given number and date. Null while
 * it has no Leistungsdatum; the issue refuses that before the rule check.
 */
export function invoiceDraftOf(
  invoice: IssuedFacts,
  snapshot: IssueSnapshot,
  issue: { number: string; issueDate: string },
): InvoiceDraft | null {
  const { serviceStart, serviceEnd, discountDays, discountBasisPoints } = invoice;
  if (!serviceStart || !serviceEnd) return null;
  return {
    typeCode: '380',
    number: issue.number,
    issueDate: issue.issueDate,
    currency: 'EUR',
    seller: sellerOf(snapshot.profile, snapshot.organizationName),
    buyer: { ...snapshot.buyer, vatId: null, email: null },
    deliverTo: null,
    delivery:
      serviceStart === serviceEnd
        ? { kind: 'date', date: serviceStart }
        : { kind: 'period', start: serviceStart, end: serviceEnd },
    buyerReference: invoice.buyerReference || null,
    orderReference: invoice.orderReference || null,
    precedingInvoice: null,
    paymentTerms: {
      dueInDays: invoice.paymentDueDays,
      discount:
        discountDays !== null && discountBasisPoints !== null
          ? { days: discountDays, percentBasisPoints: discountBasisPoints }
          : null,
    },
    payee: payeeOf(snapshot.profile),
    notes: [invoice.openingText, invoice.closingText].filter(Boolean),
    lines: invoice.lines.map((line, index) => ({
      id: String(index + 1),
      name: line.name,
      description: line.description,
      quantity: line.quantity,
      unitCode: isInventoryUnitCode(line.unit) ? UN_ECE_UNIT_CODES[line.unit] : line.unit,
      unitPriceCents: line.unitPriceCents,
      priceQuantity: line.priceQuantity,
      tax:
        line.taxRateBasisPoints === 0
          ? { category: 'Z' }
          : { category: 'S', rateBasisPoints: line.taxRateBasisPoints },
    })),
  };
}

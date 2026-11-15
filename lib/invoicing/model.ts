// The plain invoice model of the one invoice core (EN 16931). A caller maps its
// own records into it: E2c a customer's invoice, E13 WerkFlow's own. The core
// imports no database, organization or Supabase type and assumes no SHK
// business, job or customer row. An amount is integer cents, a quantity a
// decimal string with at most three decimals, a rate basis points.

import type { PriceQuantity } from '@/lib/inventory/line-amount';

/** A calendar day as `YYYY-MM-DD`. */
type IsoDate = string;

type PostalAddress = {
  /** Street and house number, then up to two more lines; the first is required. */
  lines: string[];
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2, for example `DE`. */
  countryCode: string;
};

export type InvoiceParty = {
  name: string;
  address: PostalAddress;
  /** USt-IdNr. (BT-31, BT-48), for example `DE123456789`. */
  vatId: string | null;
  email: string | null;
};

/**
 * Seller identifier (BT-29). `scheme` is its ISO 6523 ICD code (BT-29-1), for
 * example `0088` for a GLN, or null for an identifier without a listed scheme,
 * such as a SEPA creditor ID: CII accepts only ICD codes as a scheme
 * (BR-CL-10, BR-CL-11), so `SEPA` is UBL's alone.
 */
type SellerIdentifier = { id: string; scheme: string | null };

export type InvoiceSeller = InvoiceParty & {
  /** Steuernummer (BT-32); a seller without USt-IdNr. needs it. */
  taxNumber: string | null;
  /**
   * Handelsregisternummer (BT-30), for example `HRB 12345`. A seller is
   * identified by it, its USt-IdNr. or its identifier (BR-CO-26).
   */
  legalRegistrationId: string | null;
  identifier?: SellerIdentifier | null | undefined;
};

/**
 * The tax of a line (EN 16931 BG-30). `S` is the standard or reduced rate,
 * `Z` a zero rate, `E` an exemption with its reason, for example under § 19
 * UStG. The office chooses the case; the core decides none.
 */
export type InvoiceTax =
  | { category: 'S'; rateBasisPoints: number }
  | { category: 'Z' }
  | { category: 'E'; exemptionReason: string };

type InvoiceLine = {
  /** The line's own id, for example its position number `1.2` (BT-126). */
  id: string;
  name: string;
  /** Empty for none. */
  description: string;
  /** A decimal string with at most three decimals; negative for a credit. */
  quantity: string;
  /** UN/ECE Recommendation 20 code, for example `H87` (piece) or `HUR` (hour). */
  unitCode: string;
  /** Net price for `priceQuantity` units. */
  unitPriceCents: number;
  priceQuantity: PriceQuantity;
  tax: InvoiceTax;
};

/** Leistungsdatum or Leistungszeitraum. */
type InvoiceDelivery = { kind: 'date'; date: IsoDate } | { kind: 'period'; start: IsoDate; end: IsoDate };

type InvoicePaymentTerms = {
  /** Zahlungsziel in days after the invoice date. */
  dueInDays: number;
  /** Skonto: a percentage in basis points if paid within `days`. */
  discount: { days: number; percentBasisPoints: number } | null;
};

/** Where the payment goes (SEPA credit transfer). */
type InvoicePayee = { iban: string; bic: string | null; accountName: string | null };

/**
 * How the buyer pays (BG-16): a SEPA credit transfer to the payee (UNTDID 4461
 * code 58), a SEPA direct debit under a mandate (59, BT-89 and BT-90), or a
 * card (48, BT-87). No full IBAN or card number enters the model: a card
 * carries its last four digits only.
 */
export type InvoicePayment =
  | { kind: 'credit-transfer'; payee: InvoicePayee }
  | { kind: 'direct-debit'; mandateReference: string; creditorId: string }
  | { kind: 'card'; lastFour: string };

/**
 * How a draft names its payment: a credit-transfer payee as shorthand for a
 * `payment` of kind `credit-transfer`, or a `payment`, never both.
 */
type InvoiceDraftPayment =
  | { payee?: InvoicePayee | null | undefined; payment?: null | undefined }
  | { payee?: null | undefined; payment?: InvoicePayment | null | undefined };

export type InvoiceDraft = InvoiceDraftPayment & {
  /** 380 a commercial invoice, 384 a corrected invoice such as a Storno. */
  typeCode: '380' | '384';
  number: string;
  issueDate: IsoDate;
  currency: 'EUR';
  seller: InvoiceSeller;
  buyer: InvoiceParty;
  /** Lieferanschrift or place of service, when it differs from the buyer's address. */
  deliverTo: { name: string; address: PostalAddress } | null;
  delivery: InvoiceDelivery;
  /** The buyer's reference (BT-10), for example a Leitweg-ID or cost centre. */
  buyerReference: string | null;
  /** The buyer's order number (BT-13). */
  orderReference: string | null;
  /** The invoice a corrected invoice replaces (BG-3). */
  precedingInvoice: { number: string; issueDate: IsoDate } | null;
  paymentTerms: InvoicePaymentTerms;
  /** The amount already paid (BT-113), for example a settled card charge; none when absent. */
  paidCents?: number;
  /** Free texts printed on the invoice (BT-22). */
  notes: string[];
  lines: InvoiceLine[];
};

/** One VAT breakdown row (BG-23): category and rate, summed over its lines. */
export type InvoiceTaxSubtotal = {
  tax: InvoiceTax;
  basisCents: number;
  taxCents: number;
};

/** A draft with every amount computed by `calculateInvoice`; the payee is its credit-transfer payment. */
export type CalculatedInvoice = Omit<InvoiceDraft, 'lines' | 'payee' | 'payment' | 'paidCents'> & {
  payment: InvoicePayment | null;
  lines: Array<InvoiceLine & { netCents: number }>;
  dueDate: IsoDate;
  taxSubtotals: InvoiceTaxSubtotal[];
  totals: {
    /** BT-106, BT-109: no document allowances or charges, so both are the line sum. */
    lineNetCents: number;
    taxCents: number;
    /** BT-112. */
    grossCents: number;
    /** BT-113: zero unless the draft names a paid amount. */
    paidCents: number;
    /** BT-115 = BT-112 − BT-113 (BR-CO-16); no rounding amount. */
    dueCents: number;
  };
};

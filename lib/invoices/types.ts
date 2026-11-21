import { z } from '@/lib/zod';

// A Rechnung as the office keeps it: customer, recipient, the work it bills,
// terms, lines and the totals the server computed
// (supabase/migrations/20261219100000_keep_invoice_drafts_with_their_lines_and_totals.sql).

/** Every status the database check allows; this release writes only `entwurf`. */
export const INVOICE_STATUSES = ['entwurf', 'ausgestellt', 'storniert'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  entwurf: 'Entwurf',
  ausgestellt: 'Ausgestellt',
  storniert: 'Storniert',
};

/** The work a draft can bill. */
export const INVOICE_WORK_KINDS = ['job', 'project', 'service_case'] as const;
export const invoiceWorkKindSchema = z.enum(INVOICE_WORK_KINDS);
export type InvoiceWorkKind = z.infer<typeof invoiceWorkKindSchema>;

export const INVOICE_WORK_LABELS: Record<InvoiceWorkKind, string> = {
  job: 'Auftrag',
  project: 'Projekt',
  service_case: 'Servicefall',
};

/** The VAT rates a line offers, as the Leistungen do: 19 and 7 % standard, 0 % a zero rate. */
export const INVOICE_TAX_RATES = [1900, 700, 0] as const;
export type InvoiceTaxRate = (typeof INVOICE_TAX_RATES)[number];

export type InvoiceListEntry = {
  id: string;
  /** Null while it is a draft. */
  invoiceNumber: string | null;
  status: InvoiceStatus;
  clientName: string;
  /** The Rechnungsempfänger's name when it is not the customer. */
  recipientName: string | null;
  grossCents: number;
  updatedAt: string;
};

/** One line as the editor and the database keep it. */
export type InvoiceLineValues = {
  name: string;
  description: string;
  /** A decimal string with at most three decimals; negative for a credit. */
  quantity: string;
  /** A code of `lib/inventory/units.ts`. */
  unit: string;
  unitPriceCents: number;
  priceQuantity: 1 | 10 | 100 | 1000;
  taxRateBasisPoints: InvoiceTaxRate;
};

/** The terms of a draft. */
export type InvoiceTerms = {
  /** Leistungsdatum (start = end) or Leistungszeitraum, `YYYY-MM-DD`; both null while open. */
  serviceStart: string | null;
  serviceEnd: string | null;
  paymentDueDays: number;
  /** Skonto; both null for none. */
  discountDays: number | null;
  discountBasisPoints: number | null;
  orderReference: string;
  buyerReference: string;
  openingText: string;
  closingText: string;
};

export type InvoiceTotals = { lineNetCents: number; taxCents: number; grossCents: number };

export type InvoiceDetail = InvoiceTerms &
  InvoiceTotals & {
    id: string;
    invoiceNumber: string | null;
    status: InvoiceStatus;
    version: number;
    client: { id: string; name: string };
    recipient: { id: string; name: string; address: string | null };
    /** The work it bills, with its label and detail route. */
    work: { kind: InvoiceWorkKind; label: string; href: string } | null;
    lines: Array<InvoiceLineValues & { netCents: number }>;
  };

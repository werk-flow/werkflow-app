import type { PriceQuantity } from '@/lib/inventory/line-amount';
import type { InventoryUnitCode } from '@/lib/inventory/units';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { InvoiceLineValues, InvoiceTaxRate } from './types';

// The catalog source of an invoice line: the Leistung or article it was
// copied from with that day's price
// (supabase/migrations/20261216110000_keep_the_catalog_source_of_invoice_lines.sql).
// The copied values are the line's own; the source only says where they came from.

export const INVOICE_LINE_SOURCE_KINDS = ['leistung', 'article'] as const;
export const invoiceLineSourceKindSchema = z.enum(INVOICE_LINE_SOURCE_KINDS);
export type InvoiceLineSourceKind = z.infer<typeof invoiceLineSourceKindSchema>;

export const INVOICE_LINE_SOURCE_LABELS: Record<InvoiceLineSourceKind, string> = {
  leistung: 'Leistung',
  article: 'Artikel',
};

/** What a save sends and stores: the kind and the id. */
export const invoiceLineSourceRefSchema = z.object({ kind: invoiceLineSourceKindSchema, id: uuidSchema });
export type InvoiceLineSourceRef = z.infer<typeof invoiceLineSourceRefSchema>;

/** What the editor shows: the source's number, name and whether it is archived now. */
export const invoiceLineSourceSchema = invoiceLineSourceRefSchema.extend({
  number: z.string().nullable(),
  name: z.string(),
  archived: z.boolean(),
});
export type InvoiceLineSource = z.infer<typeof invoiceLineSourceSchema>;

/** A line as the editor saves it: its values and its source, if it came from the catalog. */
export type InvoiceDraftLine = InvoiceLineValues & { source: InvoiceLineSourceRef | null };

/** A new line from the catalog with today's price, as the server read it; the editor copies it. */
export type InvoiceCatalogLine = {
  name: string;
  description: string;
  unit: InventoryUnitCode;
  unitPriceCents: number;
  priceQuantity: PriceQuantity;
  taxRateBasisPoints: InvoiceTaxRate;
  source: InvoiceLineSource;
};

/** „Leistung L-7 · Monteurstunde“ */
export function lineSourceLabel(source: InvoiceLineSource): string {
  return `${INVOICE_LINE_SOURCE_LABELS[source.kind]} ${[source.number, source.name].filter(Boolean).join(' · ')}`;
}

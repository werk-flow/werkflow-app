import { isInventoryUnitCode } from '@/lib/inventory/units';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { INVOICE_TAX_RATES, invoiceWorkKindSchema } from './types';

// The inputs of the invoice actions. The editor checks the same limits before
// it submits; the server parses every input again, and the table checks
// repeat them.

export const createInvoiceSchema = z.object({
  /** One key per opening of the create dialog: a retried press returns the first draft. */
  attemptKey: uuidSchema,
  clientId: uuidSchema,
  work: z.object({ kind: invoiceWorkKindSchema, id: uuidSchema }).nullable(),
});
export type CreateInvoiceInput = z.input<typeof createInvoiceSchema>;

const isoDate = z.iso.date();

const lineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  quantity: z.string().regex(/^-?\d{1,9}(?:\.\d{1,3})?$/),
  unit: z.string().refine(isInventoryUnitCode),
  unitPriceCents: z.number().int().min(0).max(100_000_000),
  priceQuantity: z.literal([1, 10, 100, 1000]),
  taxRateBasisPoints: z.literal(INVOICE_TAX_RATES),
});

const termsSchema = z
  .object({
    serviceStart: isoDate.nullable(),
    serviceEnd: isoDate.nullable(),
    paymentDueDays: z.number().int().min(0).max(365),
    discountDays: z.number().int().min(1).nullable(),
    discountBasisPoints: z.number().int().min(1).max(9999).nullable(),
    orderReference: z.string().trim().max(200),
    buyerReference: z.string().trim().max(200),
    openingText: z.string().trim().max(4000),
    closingText: z.string().trim().max(4000),
  })
  .refine(
    (terms) =>
      (terms.serviceStart === null) === (terms.serviceEnd === null) &&
      (terms.serviceStart === null || terms.serviceEnd === null || terms.serviceEnd >= terms.serviceStart),
  )
  .refine(
    (terms) =>
      (terms.discountDays === null) === (terms.discountBasisPoints === null) &&
      (terms.discountDays === null || terms.discountDays <= terms.paymentDueDays),
  );

export const saveInvoiceDraftSchema = z.object({
  invoiceId: uuidSchema,
  expectedVersion: z.number().int().min(1),
  /** One key per save press: a retried press answers with the first save. */
  attemptKey: uuidSchema,
  terms: termsSchema,
  lines: z.array(lineSchema).max(500),
});
export type SaveInvoiceDraftInput = z.input<typeof saveInvoiceDraftSchema>;

export const deleteInvoiceDraftSchema = z.object({
  invoiceId: uuidSchema,
  expectedVersion: z.number().int().min(1),
  attemptKey: uuidSchema,
});
export type DeleteInvoiceDraftInput = z.input<typeof deleteInvoiceDraftSchema>;

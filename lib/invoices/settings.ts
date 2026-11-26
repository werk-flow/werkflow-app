import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The organization's invoice settings: the number series and the default
// Zahlungsziel and Skonto of a new draft
// (supabase/migrations/20270205090000_issue_invoices_with_gapless_numbers.sql).
// The database formats the numbers; the form only edits the parts.

const invoiceSettingsValuesSchema = z
  .object({
    /** Letters, digits and . _ / - only, so a number never holds a space. */
    numberPrefix: z.string().regex(/^[A-Za-z0-9._/-]{0,20}$/),
    /** With the year, a number reads <prefix><year>-<n> and n restarts each year. */
    numberWithYear: z.boolean(),
    numberMinDigits: z.number().int().min(1).max(10),
    /** The database's bound: 999,999,999 is a used-up series, which issues nothing until a lower start. */
    nextNumber: z.number().int().min(1).max(999_999_999),
    /** The Berlin year the series was read in; save_invoice_settings refuses a year-based series read in another. */
    numberYear: z.number().int(),
    paymentDueDays: z.number().int().min(0).max(365),
    discountDays: z.number().int().min(1).nullable(),
    discountBasisPoints: z.number().int().min(1).max(9999).nullable(),
  })
  .refine(
    (values) =>
      (values.discountDays === null) === (values.discountBasisPoints === null) &&
      (values.discountDays === null || values.discountDays <= values.paymentDueDays),
  );
export type InvoiceSettingsValues = z.output<typeof invoiceSettingsValuesSchema>;

export const saveInvoiceSettingsSchema = z.object({
  /** The organization whose settings the form shows: a save after a switch to another one is refused. */
  organizationId: uuidSchema,
  /** 0 while none are saved. */
  expectedVersion: z.number().int().min(0),
  settings: invoiceSettingsValuesSchema,
});
export type SaveInvoiceSettingsInput = z.input<typeof saveInvoiceSettingsSchema>;

/** The settings as the page shows them, with the number the next invoice issued today takes. */
export const invoiceSettingsSchema = z.object({
  version: z.number().int().min(0),
  numberPrefix: z.string(),
  numberWithYear: z.boolean(),
  numberMinDigits: z.number().int(),
  nextNumber: z.number().int(),
  /** Null once the series is used up: issue_invoice takes no further number. */
  nextInvoiceNumber: z.string().nullable(),
  numberYear: z.number().int(),
  /** From the first issue on the series is fixed. */
  numbersFixed: z.boolean(),
  paymentDueDays: z.number().int(),
  discountDays: z.number().int().nullable(),
  discountBasisPoints: z.number().int().nullable(),
});
export type InvoiceSettings = z.output<typeof invoiceSettingsSchema>;

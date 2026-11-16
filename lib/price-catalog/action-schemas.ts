import { OFFERED_INVENTORY_UNITS } from '@/lib/inventory/units';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { MAX_PRICE_CENTS } from './money';
import { LEISTUNG_TAX_RATES, leistungKindSchema } from './types';

// The inputs of the Leistung actions. The forms check the same limits before
// they submit; the server parses every input again.

const amountCents = z.number().int().min(0).max(MAX_PRICE_CENTS);

/** A unit the forms offer: a code of E1's list that is not retired. */
const offeredUnitSchema = z
  .string()
  .refine((code) => OFFERED_INVENTORY_UNITS.some((unit) => unit.code === code));

const leistungFieldsSchema = z.object({
  leistungNumber: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000),
  kind: leistungKindSchema,
  unit: offeredUnitSchema,
  taxRateBasisPoints: z.literal(LEISTUNG_TAX_RATES),
});

const priceFieldsSchema = z.object({
  validFrom: z.iso.date(),
  salePriceCents: amountCents,
  costRateCents: amountCents.nullable(),
});

export const createLeistungSchema = leistungFieldsSchema.extend(priceFieldsSchema.shape);
export const updateLeistungSchema = leistungFieldsSchema.extend({ leistungId: uuidSchema });
export const addLeistungPriceSchema = priceFieldsSchema.extend({ leistungId: uuidSchema });
export const setLeistungArchivedSchema = z.object({ leistungId: uuidSchema, archived: z.boolean() });

export type LeistungFieldsInput = z.input<typeof leistungFieldsSchema>;
export type CreateLeistungInput = z.input<typeof createLeistungSchema>;
export type UpdateLeistungInput = z.input<typeof updateLeistungSchema>;
export type AddLeistungPriceInput = z.input<typeof addLeistungPriceSchema>;
export type SetLeistungArchivedInput = z.input<typeof setLeistungArchivedSchema>;

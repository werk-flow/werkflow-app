import { OFFERED_INVENTORY_UNITS } from '@/lib/inventory/units';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { MAX_CONDITION_LEISTUNG_PRICES, MAX_DISCOUNT_TENTHS } from './customer-conditions';
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

const discountTenths = z.number().int().min(0).max(MAX_DISCOUNT_TENTHS);

/** A new version of a customer's conditions: the whole set, from its first day on. */
export const recordCustomerConditionSchema = z.object({
  clientId: uuidSchema,
  /** The newest version the form was filled from, 0 for none: another session's version meanwhile refuses this one. */
  expectedVersion: z.number().int().min(0),
  /** One key per opening of the dialog: a retried press answers with the first version. */
  attemptKey: uuidSchema,
  validFrom: z.iso.date(),
  discountTenths: z.object({ material: discountTenths, arbeit: discountTenths, anfahrt: discountTenths }),
  leistungPrices: z
    .array(z.object({ leistungId: uuidSchema, salePriceCents: amountCents }))
    .max(MAX_CONDITION_LEISTUNG_PRICES)
    .refine((prices) => new Set(prices.map((price) => price.leistungId)).size === prices.length),
});

export type LeistungFieldsInput = z.input<typeof leistungFieldsSchema>;
export type CreateLeistungInput = z.input<typeof createLeistungSchema>;
export type UpdateLeistungInput = z.input<typeof updateLeistungSchema>;
export type AddLeistungPriceInput = z.input<typeof addLeistungPriceSchema>;
export type SetLeistungArchivedInput = z.input<typeof setLeistungArchivedSchema>;
export type RecordCustomerConditionInput = z.input<typeof recordCustomerConditionSchema>;

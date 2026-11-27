import 'server-only';

import { isInventoryUnitCode } from '@/lib/inventory/units';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { MAX_DISCOUNT_TENTHS, type CustomerConditions, type DayCondition } from './customer-conditions';

// The server's reads of a customer's Kundenkonditionen: the customer page's
// newest versions, and what prices one new offer Position
// (customer-conditions.ts, resolveCatalogPrice). Internal readers: the caller
// has established Admin or Büro of the organization. A failed or malformed
// read throws; it never becomes "no conditions", which would price at the
// list price silently.

const discount = z.number().int().min(0).max(MAX_DISCOUNT_TENTHS);
const versionFields = {
  id: uuidSchema,
  version: z.number().int().positive(),
  validFrom: z.iso.date(),
  materialDiscountTenths: discount,
  arbeitDiscountTenths: discount,
  anfahrtDiscountTenths: discount,
};

const conditionsSchema = z.object({
  total: z.number().int().nonnegative(),
  applyingId: uuidSchema.nullable(),
  versions: z.array(
    z.object({
      ...versionFields,
      leistungPrices: z.array(
        z.object({
          leistungId: uuidSchema,
          number: z.string(),
          name: z.string(),
          unit: z.string(),
          archived: z.boolean(),
          salePriceCents: z.number().int().nonnegative(),
        }),
      ),
    }),
  ),
});

function discounts(row: {
  materialDiscountTenths: number;
  arbeitDiscountTenths: number;
  anfahrtDiscountTenths: number;
}) {
  return {
    material: row.materialDiscountTenths,
    arbeit: row.arbeitDiscountTenths,
    anfahrt: row.anfahrtDiscountTenths,
  };
}

/** The customer's newest versions, how many it has and the one that applies on `today`. */
export async function readCustomerConditions(
  organizationId: string,
  clientId: string,
  today: string,
): Promise<CustomerConditions> {
  const { data, error } = await createSupabaseAdminClient().rpc('list_client_price_conditions', {
    p_organization_id: organizationId,
    p_client_id: clientId,
    p_on_date: today,
  });
  const parsed = conditionsSchema.safeParse(data);
  if (error || !parsed.success) throw new Error('client_price_conditions_read_failed');
  return {
    total: parsed.data.total,
    applyingId: parsed.data.applyingId,
    versions: parsed.data.versions.map(({ id, version, validFrom, leistungPrices, ...row }) => ({
      id,
      version,
      validFrom,
      discountTenths: discounts(row),
      leistungPrices: leistungPrices.map((price) => ({
        ...price,
        unit: isInventoryUnitCode(price.unit) ? price.unit : null,
      })),
    })),
  };
}

const dayConditionSchema = z
  .object({
    condition: z
      .object({ ...versionFields, ownPriceCents: z.number().int().nonnegative().nullable() })
      .nullable(),
  })
  .nullable();

/**
 * What prices a new Position of an offer on `day`: its customer's version of
 * that day with its own price of `leistungId` (null for an article), `null`
 * when the customer has none that day, `offer_not_found` for no such offer of
 * the organization.
 */
export async function readOfferConditionOnDay(
  organizationId: string,
  offerId: string,
  day: string,
  leistungId: string | null,
): Promise<{ condition: DayCondition | null } | 'offer_not_found'> {
  const { data, error } = await createSupabaseAdminClient().rpc('offer_price_condition_on_day', {
    p_organization_id: organizationId,
    p_offer_id: offerId,
    p_on_date: day,
    ...(leistungId ? { p_leistung_id: leistungId } : {}),
  });
  const parsed = dayConditionSchema.safeParse(data);
  if (error || !parsed.success) throw new Error('offer_price_condition_read_failed');
  if (!parsed.data) return 'offer_not_found';
  const row = parsed.data.condition;
  return {
    condition: row && {
      id: row.id,
      version: row.version,
      validFrom: row.validFrom,
      discountTenths: discounts(row),
      ownPriceCents: row.ownPriceCents,
    },
  };
}

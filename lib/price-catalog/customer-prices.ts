import 'server-only';

import { isInventoryUnitCode } from '@/lib/inventory/units';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { conditionOnDay, MAX_DISCOUNT_TENTHS, type CustomerCondition } from './customer-conditions';

// The server's read of a customer's Kundenkonditionen, for the customer page
// and for the one rule that prices a new offer Position
// (customer-conditions.ts, resolveCatalogPrice). Internal readers: the caller
// has established Admin or Büro of the organization. A failed or malformed
// read throws; it never becomes "no conditions", which would price at the
// list price silently.

const discount = z.number().int().min(0).max(MAX_DISCOUNT_TENTHS);
const conditionsSchema = z.array(
  z.object({
    id: uuidSchema,
    version: z.number().int().positive(),
    validFrom: z.iso.date(),
    materialDiscountTenths: discount,
    arbeitDiscountTenths: discount,
    anfahrtDiscountTenths: discount,
    recordedAt: z.string(),
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
);

/** Every version of the customer's conditions, the newest first; empty for none or another organization's customer. */
export async function readCustomerConditions(
  organizationId: string,
  clientId: string,
): Promise<CustomerCondition[]> {
  const { data, error } = await createSupabaseAdminClient().rpc('list_client_price_conditions', {
    p_organization_id: organizationId,
    p_client_id: clientId,
  });
  const parsed = conditionsSchema.safeParse(data);
  if (error || !parsed.success) throw new Error('client_price_conditions_read_failed');
  return parsed.data.map((row) => ({
    id: row.id,
    version: row.version,
    validFrom: row.validFrom,
    discountTenths: {
      material: row.materialDiscountTenths,
      arbeit: row.arbeitDiscountTenths,
      anfahrt: row.anfahrtDiscountTenths,
    },
    leistungPrices: row.leistungPrices.map((price) => ({
      ...price,
      unit: isInventoryUnitCode(price.unit) ? price.unit : null,
    })),
    recordedAt: row.recordedAt,
  }));
}

/**
 * The conditions of an offer's customer that apply on `day`: `null` when the
 * customer has none that day, `offer_not_found` for no such offer of the
 * organization.
 */
export async function readOfferConditionOnDay(
  organizationId: string,
  offerId: string,
  day: string,
): Promise<{ condition: CustomerCondition | null } | 'offer_not_found'> {
  const { data, error } = await createSupabaseAdminClient()
    .from('offers')
    .select('client_id')
    .eq('organization_id', organizationId)
    .eq('id', offerId)
    .maybeSingle();
  if (error) throw new Error('offer_client_read_failed');
  if (!data) return 'offer_not_found';
  return { condition: conditionOnDay(await readCustomerConditions(organizationId, data.client_id), day) };
}

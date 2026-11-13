import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from './shared';

/**
 * A Leistung with its first price and, optionally, later prices, written as
 * the office's create and price actions write them. Returns the Leistung id.
 */
export async function seedLeistung(input: {
  orgId: string;
  actorId: string;
  leistungNumber: string;
  name: string;
  description?: string;
  kind?: 'arbeit' | 'anfahrt' | 'pauschale' | 'gebuehr' | 'fremdleistung';
  unit?: string;
  prices: readonly [
    { validFrom: string; salePriceCents: number; costRateCents: number | null },
    ...{ validFrom: string; salePriceCents: number; costRateCents: number | null }[],
  ];
}): Promise<string> {
  const admin = createAdminClient();
  const [first, ...later] = input.prices;
  const { data, error } = await admin.rpc(
    'create_leistung',
    rpcArgs('create_leistung', {
      p_organization_id: input.orgId,
      p_actor_id: input.actorId,
      p_leistung_number: input.leistungNumber,
      p_name: input.name,
      p_description: input.description ?? '',
      p_kind: input.kind ?? 'arbeit',
      p_unit: input.unit ?? 'hour',
      p_tax_rate_basis_points: 1900,
      p_valid_from: first.validFrom,
      p_sale_price_cents: first.salePriceCents,
      p_cost_rate_cents: first.costRateCents,
    }),
  );
  if (error || !data) throw new Error(`Failed to seed Leistung: ${error?.message ?? 'no id'}`);
  for (const price of later) {
    const inserted = await admin.from('leistung_price_versions').insert({
      organization_id: input.orgId,
      leistung_id: data,
      valid_from: price.validFrom,
      sale_price_cents: price.salePriceCents,
      cost_rate_cents: price.costRateCents,
      created_by: input.actorId,
    });
    if (inserted.error) throw new Error(`Failed to seed a Leistung price: ${inserted.error.message}`);
  }
  return data;
}

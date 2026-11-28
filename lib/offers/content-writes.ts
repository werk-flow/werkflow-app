import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { isProvenPriceSource } from '@/lib/price-catalog/price-source-proof';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { z } from '@/lib/zod';
import { saveOfferContentSchema, type SaveOfferContentInput } from './action-schemas';
import { offerContentArgument } from './amounts';
import type { OfferFreePosition } from './types';

// The one write of an offer's Titel and Positionen, for the editor's action
// and for server callers that act for the office (werk-flow/werkflow-planning#541).
// The caller has established the actor as Admin or Büro of the organization;
// the database function checks the actor again under the access lock, refuses
// an offer outside the organization and writes the history in the same call
// (supabase/migrations/20270201090000_write_titel_and_positionen_into_an_offer.sql).
// Beside each priced Position it stores the Position's own cost, hidden from
// every client role: the cost the office took over with an article or a
// Leistung, or typed (20270501090000_calculate_offers_with_leistungen_and_costs.sql),
// and where its price came from: a source stays only with the server's proof
// for this offer, entry, price and price quantity; any other price is „manuell“
// (20270601100000_price_new_offer_positions_by_customer_conditions.sql).
// A Nachlass or Zuschlag goes with its amount and its parts by VAT rate
// (20270701140000_add_discount_and_surcharge_positions_to_an_offer.sql).

const contentRefusal = writeRefusalFor(
  new Set([
    'invalid_input',
    'not_authorized',
    'offer_not_found',
    'offer_not_editable',
    'offer_changed',
    'article_not_found',
    'leistung_not_found',
    'price_condition_not_found',
  ]),
);

const savedContentSchema = z.object({ contentVersion: z.number().int().positive(), updatedAt: z.string() });

type OfficeActor = { orgId: string; userId: string };

const MANUAL = { kind: 'manuell', conditionId: null } as const;

/** The price source the save stores: the claimed one if the server proved it, else „manuell“. */
function storedPriceSource(
  position: OfferFreePosition,
  scope: { organizationId: string; offerId: string },
): { kind: 'listenpreis' | 'kundenkondition' | 'manuell'; conditionId: string | null } {
  const claim = position.priceSource;
  if (claim.kind === 'manuell' || !position.source) return MANUAL;
  const conditionId = claim.kind === 'kundenkondition' ? claim.conditionId : null;
  const proven = isProvenPriceSource(claim.proof, {
    ...scope,
    entry: position.source,
    kind: claim.kind,
    conditionId,
    unit: position.unit,
    unitPriceCents: position.unitPriceCents,
    priceQuantity: position.priceQuantity,
  });
  return proven ? { kind: claim.kind, conditionId } : MANUAL;
}

/**
 * Replaces the Titel and Positionen of an offer in „Entwurf“ that is still at
 * the content version the input names, with the amounts the server computes.
 * A repeat under the same attempt key answers the first save. The answer names
 * the offer's transaction stamp, so the saving tab knows its Realtime echo.
 */
export async function writeOfferContent(
  actor: OfficeActor,
  rawInput: SaveOfferContentInput,
): Promise<ActionResult<{ offerId: string; contentVersion: number; updatedAt: string }>> {
  const parsed = saveOfferContentSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const content = offerContentArgument(input.sections);
  // A position the line rule refuses (an amount beyond the safe range) is the office's input to fix.
  if (!content) return { success: false, error: 'invalid_input' };
  // The database names a Position's cost `purchaseCost`, as its cost store does.
  const sections = content.sections.map((section) => ({
    ...section,
    positions: section.positions.map((position) => {
      if (position.kind !== 'free') return position;
      const { cost, ...values } = position;
      // The stored source replaces the claim, and never without the server's proof.
      const priceSource = storedPriceSource(position, {
        organizationId: actor.orgId,
        offerId: input.offerId,
      });
      return { ...values, purchaseCost: cost, priceSource };
    }),
  }));
  const { data, error } = await createSupabaseAdminClient().rpc(
    'save_offer_content',
    rpcArgs('save_offer_content', {
      p_actor_id: actor.userId,
      p_organization_id: actor.orgId,
      p_offer_id: input.offerId,
      p_expected_content_version: input.expectedContentVersion,
      p_attempt_key: input.attemptKey,
      p_sections: sections,
      // The save knows Bedarfs- and Alternativpositionen, Nachlässe and Zuschläge; save_offer_content
      // refuses an older caller's save of an offer holding one.
      p_totals: { ...content.totals, positionTypes: true, adjustments: true },
    }),
  );
  const saved = savedContentSchema.safeParse(data);
  if (error || !saved.success) {
    return contentRefusal(error, 'save_failed', 'writeOfferContent: save_offer_content failed');
  }
  return { success: true, offerId: input.offerId, ...saved.data };
}

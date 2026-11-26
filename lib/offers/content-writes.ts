import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { readArticlePrices, type ArticlePrice } from '@/lib/inventory/article-prices';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { z } from '@/lib/zod';
import { saveOfferContentSchema, type SaveOfferContentInput } from './action-schemas';
import { offerContentArgument } from './amounts';
import type { OfferSection } from './types';

// The one write of an offer's Titel and Positionen, for the editor's action
// and for server callers that act for the office (werk-flow/werkflow-planning#541).
// The caller has established the actor as Admin or Büro of the organization;
// the database function checks the actor again under the access lock, refuses
// an offer outside the organization and writes the history in the same call
// (supabase/migrations/20270201090000_write_titel_and_positionen_into_an_offer.sql).
// Beside a Position from an article it stores the article's purchase cost of
// the save's day, read through E1's readArticlePrices; the client never sends
// one (20270301090000_take_offer_positions_from_articles.sql).

const contentRefusal = writeRefusalFor(
  new Set([
    'invalid_input',
    'not_authorized',
    'offer_not_found',
    'offer_not_editable',
    'offer_changed',
    'article_not_found',
  ]),
);

const savedContentSchema = z.object({ contentVersion: z.number().int().positive(), updatedAt: z.string() });

type OfficeActor = { orgId: string; userId: string };

type PurchaseCost = { amountCents: number; priceQuantity: number };

/**
 * Today's price of every article the content names, by id, from E1's reader
 * for the caller's organization. `article_not_found` when the reader leaves
 * one out: it is no article of the organization.
 */
async function articlePricesOf(
  sections: readonly OfferSection[],
): Promise<ActionResult<{ prices: Map<string, ArticlePrice> }>> {
  const ids = [
    ...new Set(
      sections.flatMap((section) =>
        section.positions.flatMap((position) =>
          position.kind === 'free' && position.source ? [position.source.id] : [],
        ),
      ),
    ),
  ];
  if (ids.length === 0) return { success: true, prices: new Map() };
  const read = await readArticlePrices(ids, getBusinessTodayIso());
  // The reader logged its own failure; the editor says the save failed.
  if (!read.success)
    return { success: false, error: read.error === 'load_failed' ? 'save_failed' : read.error };
  const prices = new Map(read.prices.map((price) => [price.articleId, price]));
  return ids.every((id) => prices.has(id))
    ? { success: true, prices }
    : { success: false, error: 'article_not_found' };
}

/**
 * The cost stored beside a Position: the article's purchase cost per price
 * quantity, only while the Position keeps the article's unit, because a cost
 * is stated in that unit. Null for a Position typed by hand.
 */
function purchaseCostOf(
  position: OfferSection['positions'][number],
  prices: ReadonlyMap<string, ArticlePrice>,
): PurchaseCost | null {
  if (position.kind !== 'free' || !position.source) return null;
  const price = prices.get(position.source.id);
  if (!price?.purchaseCost || price.unit !== position.unit) return null;
  return { amountCents: price.purchaseCost.amountCents, priceQuantity: price.purchaseCost.priceQuantity };
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
  const prices = await articlePricesOf(input.sections);
  if (!prices.success) return prices;
  const sections = content.sections.map((section) => ({
    ...section,
    positions: section.positions.map((position) =>
      position.kind === 'free'
        ? { ...position, purchaseCost: purchaseCostOf(position, prices.prices) }
        : position,
    ),
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
      p_totals: content.totals,
    }),
  );
  const saved = savedContentSchema.safeParse(data);
  if (error || !saved.success) {
    return contentRefusal(error, 'save_failed', 'writeOfferContent: save_offer_content failed');
  }
  return { success: true, offerId: input.offerId, ...saved.data };
}

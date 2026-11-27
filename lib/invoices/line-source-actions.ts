'use server';

import type { ActionResult } from '@/lib/action-result';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { readArticlePrices } from '@/lib/inventory/article-prices';
import type { PriceQuantity } from '@/lib/inventory/line-amount';
import type { InventoryUnitCode } from '@/lib/inventory/units';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import {
  conditionLineKind,
  resolveCatalogPrice,
  type CustomerCondition,
} from '@/lib/price-catalog/customer-conditions';
import { readOfferConditionOnDay } from '@/lib/price-catalog/customer-prices';
import { readLeistungPrices } from '@/lib/price-catalog/leistung-prices';
import { LEISTUNG_KINDS, type LeistungKind } from '@/lib/price-catalog/types';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import {
  invoiceLineSourceRefSchema,
  type InvoiceCatalogLine,
  type InvoiceLineSourceRef,
  type OfferCatalogLine,
} from './line-sources';
import { INVOICE_TAX_RATES, type InvoiceTaxRate } from './types';

// A draft line from the catalog: the office picks a Leistung or an article,
// and the server reads its name, unit, tax rate and today's net sale price
// (Berlin) through the readers of E2a (readLeistungPrices) and E1
// (readArticlePrices). The editor copies the answer into a new line, where
// the office can still change every value before the save. An offer Position
// from an article or a Leistung takes the same rule (readOfferArticleLine,
// readOfferLeistungLine), so offers and invoices price an entry alike, except
// that an offer's customer's conditions apply (lib/price-catalog/
// customer-conditions.ts, resolveCatalogPrice): the offer's answer names
// where its price came from, and adds the entry's cost, for the office's
// calculation. An invoice line keeps the list price.

type CatalogLineResult = ActionResult<{ line: InvoiceCatalogLine }>;
type OfferCatalogLineResult = ActionResult<{ line: OfferCatalogLine }>;
/** A unit outside the list: an invoice refuses the entry, an offer asks the office for a unit. */
type UnitOutsideList = 'refuse' | 'ask';

/** The longest name and description a line keeps (the invoice_lines checks). */
const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

type SourceFacts = {
  number: string | null;
  name: string;
  description: string;
  archived: boolean;
  /** A Leistung's kind, which picks its customer discount; null for an article. */
  leistungKind: LeistungKind | null;
};
type SourceAmount = { amountCents: number; priceQuantity: PriceQuantity };
type SourcePrice = {
  unit: InventoryUnitCode | null;
  salePrice: SourceAmount | null;
  /** An article's purchase price or a Leistung's cost rate on the day. */
  cost: SourceAmount | null;
  taxRateBasisPoints: number;
};

function taxRateOf(basisPoints: number): InvoiceTaxRate | null {
  return INVOICE_TAX_RATES.find((rate) => rate === basisPoints) ?? null;
}

/**
 * The line, or the reason the catalog entry cannot become one today. With a
 * customer's condition, its own price or discount sets the price.
 */
function catalogLine(
  ref: InvoiceLineSourceRef,
  facts: SourceFacts,
  price: SourcePrice,
  unitOutsideList: UnitOutsideList,
  condition: CustomerCondition | null,
): OfferCatalogLineResult {
  if (facts.archived) return { success: false, error: 'source_archived' };
  const resolved = resolveCatalogPrice({
    listPrice: price.salePrice,
    lineKind: conditionLineKind(
      facts.leistungKind ? { kind: 'leistung', leistungKind: facts.leistungKind } : { kind: 'article' },
    ),
    leistungId: ref.kind === 'leistung' ? ref.id : null,
    condition,
  });
  if (!resolved) return { success: false, error: 'source_unpriced' };
  if (!price.unit && unitOutsideList === 'refuse') return { success: false, error: 'source_unit_unknown' };
  const taxRateBasisPoints = taxRateOf(price.taxRateBasisPoints);
  if (taxRateBasisPoints === null) return { success: false, error: 'source_tax_rate_unsupported' };
  return {
    success: true,
    line: {
      name: facts.name.trim().slice(0, NAME_MAX),
      description: facts.description.trim().slice(0, DESCRIPTION_MAX),
      unit: price.unit,
      unitPriceCents: resolved.amountCents,
      priceQuantity: resolved.priceQuantity,
      taxRateBasisPoints,
      source: { ...ref, number: facts.number, name: facts.name, archived: facts.archived },
      priceSource: resolved.source,
      cost: price.cost && { amountCents: price.cost.amountCents, priceQuantity: price.cost.priceQuantity },
    },
  };
}

async function leistungFacts(organizationId: string, id: string): Promise<SourceFacts | null | 'failed'> {
  const { data, error } = await createSupabaseAdminClient()
    .from('leistungen')
    .select('leistung_number, name, description, kind, archived_at')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error) return 'failed';
  return data
    ? {
        number: data.leistung_number,
        name: data.name,
        description: data.description,
        archived: data.archived_at !== null,
        leistungKind: constrainedValue(LEISTUNG_KINDS, data.kind, 'leistungen.kind'),
      }
    : null;
}

async function articleFacts(organizationId: string, id: string): Promise<SourceFacts | null | 'failed'> {
  const { data, error } = await createSupabaseAdminClient()
    .from('inventory_items')
    .select('internal_sku, name, description, is_active')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error) return 'failed';
  return data
    ? {
        number: data.internal_sku,
        name: data.name,
        description: data.description ?? '',
        archived: !data.is_active,
        leistungKind: null,
      }
    : null;
}

/** Today's price of the source, through its domain's reader; null when the reader left it out. */
async function sourcePrice(ref: InvoiceLineSourceRef, today: string): Promise<SourcePrice | null | 'failed'> {
  if (ref.kind === 'leistung') {
    const read = await readLeistungPrices([ref.id], today);
    if (!read.success) return 'failed';
    const price = read.prices.find((entry) => entry.leistungId === ref.id);
    return price ? { ...price, cost: price.costRate } : null;
  }
  const read = await readArticlePrices([ref.id], today);
  if (!read.success) return 'failed';
  const price = read.prices.find((entry) => entry.articleId === ref.id);
  return price ? { ...price, cost: price.purchaseCost } : null;
}

/**
 * A new line from the source on today's Berlin date, for Admin and Büro of
 * its organization; for an offer (`offerId`) with its customer's conditions
 * of that day.
 */
async function readCatalogLine(
  ref: InvoiceLineSourceRef,
  unitOutsideList: UnitOutsideList,
  action: string,
  offerId: string | null,
): Promise<OfferCatalogLineResult> {
  try {
    const caller = await resolveActionContext();
    if (!caller.success) return caller;
    if (!caller.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
    const { orgId } = caller.context;
    const today = getBusinessTodayIso();
    const [facts, price, customer] = await Promise.all([
      ref.kind === 'leistung' ? leistungFacts(orgId, ref.id) : articleFacts(orgId, ref.id),
      sourcePrice(ref, today),
      offerId
        ? readOfferConditionOnDay(orgId, offerId, today).catch(() => 'failed' as const)
        : { condition: null },
    ]);
    if (facts === 'failed' || price === 'failed' || customer === 'failed') {
      logError(`${action}: catalog read failed`, { code: ref.kind });
      return { success: false, error: 'load_failed' };
    }
    if (customer === 'offer_not_found') return { success: false, error: 'offer_not_found' };
    if (!facts || !price) return { success: false, error: 'source_not_found' };
    return catalogLine(ref, facts, price, unitOutsideList, customer.condition);
  } catch (error) {
    logError(`${action}: unexpected error`, error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * A new draft line from a Leistung or an article of the caller's
 * organization, priced on today's Berlin date. Admin and Büro only. Refuses
 * an archived entry, one without a sale price today, one with a unit outside
 * the list and one with a VAT rate a line does not offer.
 */
export async function readInvoiceLineSource(rawInput: InvoiceLineSourceRef): Promise<CatalogLineResult> {
  const parsed = invoiceLineSourceRefSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const read = await readCatalogLine(parsed.data, 'refuse', 'readInvoiceLineSource', null);
  if (!read.success) return read;
  // An invoice line takes no cost: the answer stays as before offers kept one.
  // Nor a price source: without a customer's condition it is the list price.
  const { unit, name, description, unitPriceCents, priceQuantity, taxRateBasisPoints, source } = read.line;
  return unit
    ? {
        success: true,
        line: { name, description, unit, unitPriceCents, priceQuantity, taxRateBasisPoints, source },
      }
    : { success: false, error: 'source_unit_unknown' };
}

/**
 * A new Position of an offer of the caller's organization from an article of
 * it, by the rule of an invoice line and priced on today's Berlin date, the
 * date a draft offer carries, by the offer's customer's conditions of that
 * day, with the article's purchase cost of that day. Admin and Büro only.
 * Unlike an invoice line, an article whose stored unit is outside the list
 * answers with `unit: null`: the offer editor asks the office for a unit
 * before it saves.
 */
export async function readOfferArticleLine(rawInput: {
  offerId: string;
  articleId: string;
}): Promise<OfferCatalogLineResult> {
  const parsed = z.object({ offerId: uuidSchema, articleId: uuidSchema }).safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { offerId, articleId } = parsed.data;
  return readCatalogLine({ kind: 'article', id: articleId }, 'ask', 'readOfferArticleLine', offerId);
}

/**
 * A new offer Position from a Leistung of the caller's organization, as
 * readOfferArticleLine reads an article, with the cost rate of the price
 * version that applies today.
 */
export async function readOfferLeistungLine(rawInput: {
  offerId: string;
  leistungId: string;
}): Promise<OfferCatalogLineResult> {
  const parsed = z.object({ offerId: uuidSchema, leistungId: uuidSchema }).safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { offerId, leistungId } = parsed.data;
  return readCatalogLine({ kind: 'leistung', id: leistungId }, 'ask', 'readOfferLeistungLine', offerId);
}

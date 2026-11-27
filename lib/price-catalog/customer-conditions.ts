import { lineAmountCents, type PriceQuantity } from '@/lib/inventory/line-amount';
import type { InventoryUnitCode } from '@/lib/inventory/units';
import type { LeistungKind } from './types';

// Kundenkonditionen: a customer's own prices, kept by Admin and Büro as
// numbered versions with a first valid day
// (supabase/migrations/20270501110000_price_new_offer_positions_by_customer_conditions.sql).
// A version holds a discount on each kind of line and an own net price per
// named Leistung. The conditions key on the kind of line, never on an
// article category. This module is the one rule that prices a new offer
// Position by them; lib/price-catalog/customer-prices.ts reads its input on
// the server.

/** The kinds of line a discount applies to: an article is material, a Leistung of kind Arbeit or Anfahrt its kind. */
export const CONDITION_LINE_KINDS = ['material', 'arbeit', 'anfahrt'] as const;
export type ConditionLineKind = (typeof CONDITION_LINE_KINDS)[number];

export const CONDITION_LINE_KIND_LABELS: Record<ConditionLineKind, string> = {
  material: 'Material',
  arbeit: 'Arbeit',
  anfahrt: 'Anfahrt',
};

/** The largest discount, in tenths of a percent: 100 %. */
export const MAX_DISCOUNT_TENTHS = 1000;

/** A version's own net price for one Leistung, per one unit of it. */
type CustomerLeistungPrice = {
  leistungId: string;
  number: string;
  name: string;
  /** `null` for a stored code outside the unit list. */
  unit: InventoryUnitCode | null;
  archived: boolean;
  salePriceCents: number;
};

/** One version of a customer's conditions. Never changed once recorded. */
export type CustomerCondition = {
  id: string;
  /** 1, 2, 3 … per customer, in recording order. */
  version: number;
  /** The first Berlin day it applies, `YYYY-MM-DD`. */
  validFrom: string;
  /** Per kind of line, in tenths of a percent; 0 for none. */
  discountTenths: Record<ConditionLineKind, number>;
  /** By Leistung name. */
  leistungPrices: CustomerLeistungPrice[];
  recordedAt: string;
};

/**
 * The version that applies on `day` (`YYYY-MM-DD`): the latest first day up
 * to that day, and among versions of the same first day the newest. Null
 * before the first one starts.
 */
export function conditionOnDay(
  conditions: readonly CustomerCondition[],
  day: string,
): CustomerCondition | null {
  let applying: CustomerCondition | null = null;
  for (const condition of conditions) {
    if (condition.validFrom > day) continue;
    if (
      !applying ||
      condition.validFrom > applying.validFrom ||
      (condition.validFrom === applying.validFrom && condition.version > applying.version)
    ) {
      applying = condition;
    }
  }
  return applying;
}

/** The kind of line of a catalog entry; a Leistung of another kind takes no discount. */
export function conditionLineKind(
  entry: { kind: 'article' } | { kind: 'leistung'; leistungKind: LeistungKind },
): ConditionLineKind | null {
  if (entry.kind === 'article') return 'material';
  return entry.leistungKind === 'arbeit' || entry.leistungKind === 'anfahrt' ? entry.leistungKind : null;
}

/**
 * A net price per its price quantity less a discount, rounded half away from
 * zero once by the shared line rule: the price per 100 keeps its precision.
 */
export function discountedPriceCents(amountCents: number, discountTenths: number): number {
  if (!Number.isInteger(discountTenths) || discountTenths < 0 || discountTenths > MAX_DISCOUNT_TENTHS) {
    throw new RangeError('A discount is between 0 and 100 percent in tenths.');
  }
  // 1 − 12,5 % is 0.875: a factor in thousandths.
  return lineAmountCents({ thousandths: BigInt(1000 - discountTenths) }, amountCents, 1);
}

/** Where a Position's price came from: the list price, a customer's condition, or the office's own. */
export type PriceSourceKind = 'listenpreis' | 'kundenkondition' | 'manuell';

/** The version of a customer's conditions a price came from. */
type ConditionRef = { id: string; version: number; validFrom: string };

/** Where the resolver took a price from; only a customer's condition names its version. */
export type CatalogPriceSource =
  | { kind: 'listenpreis' }
  | { kind: 'kundenkondition'; condition: ConditionRef };

export type ResolvedPrice = { amountCents: number; priceQuantity: PriceQuantity; source: CatalogPriceSource };

/**
 * The price of a new Position from a catalog entry for a customer: the
 * Leistung's own price in the condition, else the list price less the
 * condition's discount for the entry's kind of line. An own price is the
 * agreed price and takes no discount. Without a condition, a discount or an
 * own price the list price stands. Null when neither an own price nor a list
 * price applies.
 */
export function resolveCatalogPrice(input: {
  listPrice: { amountCents: number; priceQuantity: PriceQuantity } | null;
  lineKind: ConditionLineKind | null;
  /** The Leistung the entry is, null for an article. */
  leistungId: string | null;
  condition: CustomerCondition | null;
}): ResolvedPrice | null {
  const { listPrice, lineKind, leistungId, condition } = input;
  const atListPrice = listPrice && { ...listPrice, source: { kind: 'listenpreis' as const } };
  if (!condition) return atListPrice;
  const source = {
    kind: 'kundenkondition' as const,
    condition: { id: condition.id, version: condition.version, validFrom: condition.validFrom },
  };
  const ownPrice = condition.leistungPrices.find((price) => price.leistungId === leistungId);
  if (ownPrice) return { amountCents: ownPrice.salePriceCents, priceQuantity: 1, source };
  const discount = lineKind ? condition.discountTenths[lineKind] : 0;
  if (!listPrice || discount === 0) return atListPrice;
  return {
    amountCents: discountedPriceCents(listPrice.amountCents, discount),
    priceQuantity: listPrice.priceQuantity,
    source,
  };
}

/**
 * What a save says of a priced Position's price: manual, or the source with
 * the price it answered when the Position was added.
 */
export type PriceSourceClaim =
  | { kind: 'manuell' }
  | { kind: 'listenpreis'; unitPriceCents: number }
  | { kind: 'kundenkondition'; conditionId: string; unitPriceCents: number };

/**
 * The price source a save stores: a source stays only while the Position
 * still names its catalog entry and has the price that source answered; any
 * other price is the office's own, „manuell“.
 */
export function savedPriceSource(
  claim: PriceSourceClaim,
  catalogEntry: { kind: 'article' | 'leistung'; id: string } | null,
  unitPriceCents: number,
): { kind: PriceSourceKind; conditionId: string | null } {
  if (claim.kind === 'manuell' || !catalogEntry || claim.unitPriceCents !== unitPriceCents) {
    return { kind: 'manuell', conditionId: null };
  }
  return claim.kind === 'kundenkondition'
    ? { kind: 'kundenkondition', conditionId: claim.conditionId }
    : { kind: 'listenpreis', conditionId: null };
}

/** „12,5“ of tenths of a percent. */
export function discountText(tenths: number): string {
  return `${String(Math.trunc(tenths / 10))}${tenths % 10 === 0 ? '' : `,${String(tenths % 10)}`}`;
}

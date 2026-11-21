import { formatEuroCents } from '@/lib/document-rendering/format';
import type {
  ArticlePriceEntry,
  ArticlePriceKind,
  ArticleSupplierReference,
} from '@/lib/inventory/article-price-terms';
import type { PriceQuantity } from '@/lib/inventory/line-amount';
import { formatInventoryQuantity, getInventoryUnitLabel } from '@/lib/inventory/types';
import { INVENTORY_UNITS } from '@/lib/inventory/units';

// How the article dialog's „Lieferanten“ and „Preise“ read: a price per its
// price quantity, a pack as a sentence, and the state of a recorded price.

/** The short label of a unit, „m“, or the stored text for a unit outside the list. */
export function unitShortLabelOrStored(unit: string): string {
  return INVENTORY_UNITS.find((entry) => entry.code === unit)?.shortLabel ?? unit;
}

/** „4,12 € je m“, or „610,00 € je 100 m“ for a price per 100 base units. */
export function formatArticlePrice(amountCents: number, priceQuantity: PriceQuantity, unit: string): string {
  const per =
    priceQuantity === 1 ? unitShortLabelOrStored(unit) : `${priceQuantity} ${unitShortLabelOrStored(unit)}`;
  return `${formatEuroCents(amountCents)} je ${per}`;
}

export const ARTICLE_PRICE_KIND_LABELS: Record<ArticlePriceKind, string> = {
  purchase: 'Einkaufspreis',
  sale: 'Verkaufspreis',
};

type PriceAmount = { amountCents: number; priceQuantity: PriceQuantity };

/** „Einkaufspreis: 4,00 € je m → 457,50 € je 100 m“, or „bisher keiner“ before a first price. */
export function formatPriceChange(
  kind: ArticlePriceKind,
  before: PriceAmount | null,
  after: PriceAmount,
  unit: string,
): string {
  const old = before ? formatArticlePrice(before.amountCents, before.priceQuantity, unit) : 'bisher keiner';
  return `${ARTICLE_PRICE_KIND_LABELS[kind]}: ${old} → ${formatArticlePrice(after.amountCents, after.priceQuantity, unit)}`;
}

/** „1 Rolle = 50 Meter“, or „Bestellt in Meter“ when the supplier sells in the base unit. */
export function describePack(
  pack: Pick<ArticleSupplierReference, 'purchaseUnit' | 'packQuantity' | 'baseQuantity'>,
  baseUnit: string,
): string {
  if (!pack.purchaseUnit) return `Bestellt in ${getInventoryUnitLabel(baseUnit)}`;
  return `${formatInventoryQuantity(pack.packQuantity, pack.purchaseUnit, 3)} = ${formatInventoryQuantity(
    pack.baseQuantity,
    baseUnit,
    3,
  )}`;
}

export type ArticlePriceState = 'current' | 'upcoming' | 'earlier';

export const ARTICLE_PRICE_STATE_BADGES: Record<
  ArticlePriceState,
  { label: string; variant: 'success' | 'secondary' | 'outline' }
> = {
  current: { label: 'Gilt heute', variant: 'success' },
  upcoming: { label: 'Kommt', variant: 'secondary' },
  earlier: { label: 'Früher', variant: 'outline' },
};

/** The state of a recorded price on the read's day; the database marked the one that applies. */
export function articlePriceState(price: ArticlePriceEntry, priceDate: string): ArticlePriceState {
  if (price.isCurrent) return 'current';
  return price.validFrom > priceDate ? 'upcoming' : 'earlier';
}

import type { PriceQuantity } from './line-amount';

// The terms of an article's dated prices and supplier references, as the
// database checks them (migration 20261203090000). Client and server share
// them.

/** Base units one price is stated for, as wholesalers state prices. */
export const PRICE_QUANTITIES = [1, 10, 100, 1000] as const satisfies readonly PriceQuantity[];

export const ARTICLE_PRICE_KINDS = ['purchase', 'sale'] as const;
export type ArticlePriceKind = (typeof ARTICLE_PRICE_KINDS)[number];

/** Where a price came from; `carried_over` is the single price an article carried before dated prices. */
export const ARTICLE_PRICE_ORIGINS = ['manual', 'csv_import', 'datanorm', 'carried_over'] as const;
export type ArticlePriceOrigin = (typeof ARTICLE_PRICE_ORIGINS)[number];

export const ARTICLE_PRICE_ORIGIN_LABELS: Record<ArticlePriceOrigin, string> = {
  manual: 'Von Hand',
  csv_import: 'CSV-Import',
  datanorm: 'DATANORM',
  carried_over: 'Übernommen',
};

/** An amount in cents for `priceQuantity` base units, from its first Berlin day. */
export type ArticlePriceAmount = {
  amountCents: number;
  priceQuantity: PriceQuantity;
  validFrom: string;
  origin: ArticlePriceOrigin;
};

/** One supplier reference of an article. */
export type ArticleSupplierReference = {
  id: string;
  supplierId: string;
  supplierArticleNumber: string | null;
  /** A unit code of the list, or `null` when the supplier sells in the article's base unit. */
  purchaseUnit: string | null;
  /** `packQuantity` purchase units hold `baseQuantity` base units. */
  packQuantity: number;
  baseQuantity: number;
  isPreferred: boolean;
};

/** One recorded price of an article. */
export type ArticlePriceEntry = {
  id: string;
  kind: ArticlePriceKind;
  /** The base unit the amount is stated in; a price of an earlier unit no longer applies. */
  unit: string;
  amountCents: number;
  priceQuantity: PriceQuantity;
  validFrom: string;
  origin: ArticlePriceOrigin;
  recordedAt: string;
  /** The price of its kind that applies on the read's day. */
  isCurrent: boolean;
};

/** An article's supplier references and every price, latest first day first. */
export type ArticleTerms = {
  suppliers: ArticleSupplierReference[];
  prices: ArticlePriceEntry[];
};

/** The terms of the listed articles, read for one Berlin day, or the failure of that read. */
export type ArticleTermsPage =
  | { status: 'loaded'; priceDate: string; byItem: Record<string, ArticleTerms> }
  | { status: 'failed' };

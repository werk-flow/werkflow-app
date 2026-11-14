import { readDelivery } from '@/vendor/wholesaler-reader/src/index';
import type { PriceQuantity } from './line-amount';

// The one module that imports the private wholesaler-file reader, and the app's own
// words for what it reads. `bun install` places the reader in the git-ignored vendor/
// folder with its key, or a stand-in without it (lib/inventory/wholesaler-reader-install.ts).
//
// The reader's repository compiles this file against the real reader in its own check,
// without the app's packages: keep its imports to the reader and line-amount.ts.
// Tests pass a fake reader with synthetic data; no wholesaler file enters this repository.

const NOT_INSTALLED = 'Dieser Import ist in dieser Umgebung nicht verfügbar.';

/** One file of a delivery as it arrived: its name without folder, and its bytes. */
export type WholesalerFile = { name: string; bytes: Uint8Array };

/** A list price may get a rebate; a net price is the buyer's price. */
type WholesalerPriceKind = 'list' | 'net';

/** An amount in integer cents for the article's price quantity. */
type WholesalerPrice = { kind: WholesalerPriceKind; amountCents: number };

/** Where a delivery's line stands, for the office to find it. */
type DeliveryPlace = { file: string; line: number };

type WholesalerArticle = DeliveryPlace & {
  articleNumber: string;
  change: 'new' | 'change';
  name: string;
  nameAddition: string;
  /** The unit exactly as the wholesaler wrote it; the import maps it to the unit list. */
  unit: string;
  priceQuantity: PriceQuantity;
  /** Null when this line carries no price; a price change then names it. */
  price: WholesalerPrice | null;
  rebateGroup: string | null;
  mainProductGroup: string | null;
  productGroup: string | null;
  ean: string | null;
  matchcode: string | null;
};

type WholesalerDiscount =
  | { kind: 'rebate_group'; rebateGroup: string }
  | { kind: 'percent'; hundredthsOfPercent: number }
  /** A rebate the reader leaves as written. */
  | { kind: 'unread'; code: string; value: string };

type WholesalerPriceChange = DeliveryPlace & {
  articleNumber: string;
  priceKind: WholesalerPriceKind;
  /** Null when the wholesaler gives the price on request only. */
  amountCents: number | null;
  discounts: WholesalerDiscount[];
};

type WholesalerRebateGroup = { rebateGroup: string; discount: WholesalerDiscount; text: string };

/** A line or file the reader refused, with a German sentence for the office. */
type WholesalerRejection = DeliveryPlace & { code: string; reason: string };

export type WholesalerDelivery = {
  header: { formatVersion: string; supplierText: string; date: string | null; currency: string } | null;
  articles: WholesalerArticle[];
  deletions: (DeliveryPlace & { articleNumber: string })[];
  priceChanges: WholesalerPriceChange[];
  productGroups: { mainProductGroup: string; productGroup: string | null; text: string }[];
  rebateGroups: WholesalerRebateGroup[];
  /** Kinds of lines the reader leaves out, counted per kind. */
  skipped: { kind: string; lines: number }[];
  rejections: WholesalerRejection[];
};

export type WholesalerReading =
  | { installed: true; delivery: WholesalerDelivery }
  | { installed: false; reason: string };

/** The reader's result as far as this module reads it; the reader's check compiles the real one against it. */
type ReaderDelivery = {
  header: { version: string; supplierText: string; date: string | null; currency: string } | null;
  articles: (DeliveryPlace & {
    articleNumber: string;
    change: 'new' | 'change';
    shortText1: string;
    shortText2: string;
    unit: string;
    priceQuantity: PriceQuantity;
    price: WholesalerPrice | null;
    rebateGroup: string | null;
    mainProductGroup: string | null;
    productGroup: string | null;
    ean: string | null;
    matchcode: string | null;
  })[];
  deletions: (DeliveryPlace & { articleNumber: string })[];
  priceChanges: WholesalerPriceChange[];
  productGroups: { mainProductGroup: string; productGroup: string | null; text: string }[];
  rebateGroups: WholesalerRebateGroup[];
  skipped: { recordType: string; lines: number }[];
  rejected: WholesalerRejection[];
};
type DeliveryReader = (files: WholesalerFile[]) => ReaderDelivery;

function installedReader(): DeliveryReader | null {
  return readDelivery ?? null;
}

/** Whether this build carries the reader; without it the wholesaler import is unavailable. */
export function wholesalerReaderInstalled(): boolean {
  return installedReader() !== null;
}

/** Reads one delivery into the app's words, or says that this build has no reader. */
export function readWholesalerDelivery(
  files: WholesalerFile[],
  reader: DeliveryReader | null = installedReader(),
): WholesalerReading {
  if (!reader) return { installed: false, reason: NOT_INSTALLED };
  const read = reader(files);
  const place = ({ file, line }: DeliveryPlace): DeliveryPlace => ({ file, line });
  const discount = (written: WholesalerDiscount): WholesalerDiscount => {
    switch (written.kind) {
      case 'rebate_group':
        return { kind: 'rebate_group', rebateGroup: written.rebateGroup };
      case 'percent':
        return { kind: 'percent', hundredthsOfPercent: written.hundredthsOfPercent };
      case 'unread':
        return { kind: 'unread', code: written.code, value: written.value };
    }
  };
  return {
    installed: true,
    delivery: {
      header: read.header && {
        formatVersion: read.header.version,
        supplierText: read.header.supplierText,
        date: read.header.date,
        currency: read.header.currency,
      },
      articles: read.articles.map((article) => ({
        ...place(article),
        articleNumber: article.articleNumber,
        change: article.change,
        name: article.shortText1,
        nameAddition: article.shortText2,
        unit: article.unit,
        priceQuantity: article.priceQuantity,
        price: article.price && { kind: article.price.kind, amountCents: article.price.amountCents },
        rebateGroup: article.rebateGroup,
        mainProductGroup: article.mainProductGroup,
        productGroup: article.productGroup,
        ean: article.ean,
        matchcode: article.matchcode,
      })),
      deletions: read.deletions.map((deletion) => ({
        ...place(deletion),
        articleNumber: deletion.articleNumber,
      })),
      priceChanges: read.priceChanges.map((change) => ({
        ...place(change),
        articleNumber: change.articleNumber,
        priceKind: change.priceKind,
        amountCents: change.amountCents,
        discounts: change.discounts.map(discount),
      })),
      productGroups: read.productGroups.map((group) => ({
        mainProductGroup: group.mainProductGroup,
        productGroup: group.productGroup,
        text: group.text,
      })),
      rebateGroups: read.rebateGroups.map((group) => ({
        rebateGroup: group.rebateGroup,
        discount: discount(group.discount),
        text: group.text,
      })),
      skipped: read.skipped.map((skipped) => ({ kind: skipped.recordType, lines: skipped.lines })),
      rejections: read.rejected.map((rejection) => ({
        ...place(rejection),
        code: rejection.code,
        reason: rejection.reason,
      })),
    },
  };
}

import type { DatanormRejectionCode } from '@/lib/inventory/datanorm/rejections';

/** One file of a delivery as it arrived: its file name without folder, and its bytes. */
export type DatanormFile = { name: string; bytes: Uint8Array };

/** A list price may get a rebate; a net price is the buyer's price. */
export type DatanormPriceKind = 'list' | 'net';

/** The number of base units a price is stated for. */
export type DatanormPriceQuantity = 1 | 10 | 100 | 1000;

export type DatanormHeader = {
  version: '04';
  /** The free text of the header (supplier, catalog, notes), spaces collapsed. */
  supplierText: string;
  /** ISO date, or null when the header's date is not a calendar day. */
  date: string | null;
  currency: string;
};

/** An amount in integer cents for the price quantity of its article. */
type DatanormPrice = { kind: DatanormPriceKind; amountCents: number };

export type DatanormArticle = {
  file: string;
  line: number;
  articleNumber: string;
  change: 'new' | 'change';
  shortText1: string;
  shortText2: string;
  /** The unit exactly as the wholesaler wrote it; mapping it is the import's job. */
  unit: string;
  priceQuantity: DatanormPriceQuantity;
  /** Null when the record carries no price (0 or empty): it then comes from a price file. */
  price: DatanormPrice | null;
  rebateGroup: string | null;
  mainProductGroup: string | null;
  /** From the B record of the same article, when the delivery has one. */
  productGroup: string | null;
  ean: string | null;
  matchcode: string | null;
};

type DatanormDeletion = { file: string; line: number; articleNumber: string };

/** A rebate a price record or rebate group grants. */
export type DatanormDiscount =
  | { kind: 'rebate_group'; rebateGroup: string }
  | { kind: 'percent'; hundredthsOfPercent: number }
  /** A multiplier or surcharge: public descriptions leave its decimals open, so it stays as written. */
  | { kind: 'unread'; code: string; value: string };

export type DatanormPriceChange = {
  file: string;
  line: number;
  articleNumber: string;
  priceKind: DatanormPriceKind;
  /** Cents for the article's price quantity; null when the record marks the price "on request". */
  amountCents: number | null;
  discounts: DatanormDiscount[];
};

type DatanormProductGroup = {
  mainProductGroup: string;
  /** Null for a line that names only the main group. */
  productGroup: string | null;
  text: string;
};

type DatanormRebateGroup = { rebateGroup: string; discount: DatanormDiscount; text: string };

type DatanormRejection = { file: string; line: number; code: DatanormRejectionCode; reason: string };

/** Record types a delivery may carry that this reader leaves out, counted per type. */
type DatanormSkippedRecords = { recordType: string; lines: number };

export type DatanormDelivery = {
  /** The header of the first article file, else of the first file read; null when no file had one. */
  header: DatanormHeader | null;
  articles: DatanormArticle[];
  deletions: DatanormDeletion[];
  priceChanges: DatanormPriceChange[];
  productGroups: DatanormProductGroup[];
  rebateGroups: DatanormRebateGroup[];
  skipped: DatanormSkippedRecords[];
  rejected: DatanormRejection[];
};

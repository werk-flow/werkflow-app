import type { PriceQuantity } from './line-amount';
import { normalizeInventoryUnitInput, type InventoryUnitCode } from './units';
import type { WholesalerDelivery } from './wholesaler-reader';

// The wholesaler import's staging rules on the server, without a database or
// a file: how a read delivery becomes the lines the preview stages, how a
// delivery is recognized again, and which unit a unit text guesses.
// The database decides each line's effect on the catalog (migration
// 20261205090000).

/** One staged line, in the database's column names, as `stage_supplier_catalog_import_lines` takes it. */
export type StagedImportLine = {
  ordinal: number;
  kind: 'article' | 'price' | 'deletion' | 'rejection';
  file_name: string;
  line_number: number;
  article_number: string | null;
  name: string | null;
  name_addition: string | null;
  unit_text: string | null;
  price_quantity: PriceQuantity | null;
  price_kind: 'list' | 'net' | null;
  price_cents: number | null;
  rebate_group: string | null;
  main_product_group: string | null;
  product_group: string | null;
  ean: string | null;
  matchcode: string | null;
  reason_code: string | null;
  reason: string | null;
};

const EMPTY_LINE = {
  article_number: null,
  name: null,
  name_addition: null,
  unit_text: null,
  price_quantity: null,
  price_kind: null,
  price_cents: null,
  rebate_group: null,
  main_product_group: null,
  product_group: null,
  ean: null,
  matchcode: null,
  reason_code: null,
  reason: null,
} as const;

/** The longest article name the catalog keeps. */
const NAME_MAX_LENGTH = 500;
const ARTICLE_NUMBER_MAX_LENGTH = 200;

/** A price as the catalog keeps it: both null when the wholesaler names none, or only on request. */
type CatalogPrice = { price_kind: 'list' | 'net' | null; price_cents: number | null };

function catalogPrice(kind: 'list' | 'net', amountCents: number | null): CatalogPrice {
  return amountCents === null
    ? { price_kind: null, price_cents: null }
    : { price_kind: kind, price_cents: amountCents };
}

type DeliveryArticle = WholesalerDelivery['articles'][number];
type DeliveryPriceChange = WholesalerDelivery['priceChanges'][number];

/** One article's staged line, with its latest price change as its price, or its rejection. */
function articleLine(
  article: DeliveryArticle,
  latestPriceChange: ReadonlyMap<string, DeliveryPriceChange>,
): Omit<StagedImportLine, 'ordinal'> {
  const articleNumber = article.articleNumber.trim();
  const name = article.name.trim();
  const place = { file_name: article.file, line_number: article.line };
  if (!articleNumber || articleNumber.length > ARTICLE_NUMBER_MAX_LENGTH || !name) {
    return {
      ...EMPTY_LINE,
      ...place,
      kind: 'rejection',
      article_number: articleNumber.slice(0, ARTICLE_NUMBER_MAX_LENGTH) || null,
      reason_code: articleNumber ? 'article_name_missing' : 'article_number_missing',
      reason: articleNumber ? 'Der Artikel hat keine Bezeichnung.' : 'Der Artikel hat keine Artikelnummer.',
    };
  }
  const change = latestPriceChange.get(articleNumber);
  const price = change
    ? catalogPrice(change.priceKind, change.amountCents)
    : article.price
      ? catalogPrice(article.price.kind, article.price.amountCents)
      : catalogPrice('list', null);
  return {
    ...EMPTY_LINE,
    ...place,
    kind: 'article',
    article_number: articleNumber,
    name: name.slice(0, NAME_MAX_LENGTH),
    name_addition: article.nameAddition.trim().slice(0, NAME_MAX_LENGTH),
    unit_text: article.unit.trim(),
    price_quantity: article.priceQuantity,
    ...price,
    rebate_group: article.rebateGroup,
    main_product_group: article.mainProductGroup,
    product_group: article.productGroup,
    ean: article.ean,
    matchcode: article.matchcode,
  };
}

/**
 * The lines one delivery stages, in delivery order. A price change of an
 * article the delivery also lists becomes that article's price; a price
 * change of another article stays a price line for the catalog row. An
 * article without number or name is a rejected line, as is every line the
 * reader refused.
 */
export function stagedDeliveryLines(delivery: WholesalerDelivery): StagedImportLine[] {
  const lines: Omit<StagedImportLine, 'ordinal'>[] = [];
  const latestPriceChange = new Map(
    delivery.priceChanges.map((change) => [change.articleNumber.trim(), change]),
  );

  for (const article of delivery.articles) lines.push(articleLine(article, latestPriceChange));

  // Only an article the batch stages takes a price change over; a rejected one leaves it a price line.
  const delivered = new Set(
    lines.flatMap((line) => (line.kind === 'article' && line.article_number ? [line.article_number] : [])),
  );
  for (const change of delivery.priceChanges) {
    const articleNumber = change.articleNumber.trim();
    if (!articleNumber || delivered.has(articleNumber) || articleNumber.length > ARTICLE_NUMBER_MAX_LENGTH)
      continue;
    lines.push({
      ...EMPTY_LINE,
      file_name: change.file,
      line_number: change.line,
      kind: 'price',
      article_number: articleNumber,
      ...catalogPrice(change.priceKind, change.amountCents),
    });
  }

  for (const deletion of delivery.deletions) {
    const articleNumber = deletion.articleNumber.trim();
    if (!articleNumber || articleNumber.length > ARTICLE_NUMBER_MAX_LENGTH) continue;
    lines.push({
      ...EMPTY_LINE,
      file_name: deletion.file,
      line_number: deletion.line,
      kind: 'deletion',
      article_number: articleNumber,
    });
  }

  for (const rejection of delivery.rejections) {
    lines.push({
      ...EMPTY_LINE,
      file_name: rejection.file,
      line_number: rejection.line,
      kind: 'rejection',
      reason_code: rejection.code,
      reason: rejection.reason,
    });
  }

  return lines.map((line, ordinal) => ({ ...line, ordinal }));
}

/** The hex SHA-256 of bytes. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The content key of a delivery: the SHA-256 over each file's SHA-256 in
 * file-name order. The same files give the same key, whatever order they
 * were chosen in.
 */
export async function deliveryContentHash(
  files: readonly { name: string; bytes: Uint8Array }[],
): Promise<string> {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const fileHashes = await Promise.all(sorted.map((file) => sha256Hex(file.bytes)));
  return sha256Hex(new TextEncoder().encode(fileHashes.join('\n')));
}

/** The unit each unit text of a delivery names, or null where the office must choose. */
export function guessUnitMapping(unitTexts: readonly string[]): Record<string, InventoryUnitCode | null> {
  return Object.fromEntries(unitTexts.map((text) => [text, normalizeInventoryUnitInput(text)]));
}

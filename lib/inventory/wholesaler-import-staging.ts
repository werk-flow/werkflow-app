import type { ActionResult } from '@/lib/action-result';
import { normalizeInventoryUnitInput, type InventoryUnitCode } from './units';
import type { WholesalerReportLine } from './wholesaler-import-lines';
import { WHOLESALER_IMPORT_MAX_LINES, type StagedImportLine } from './wholesaler-import-schemas';
import { readWholesalerDelivery, type WholesalerDelivery } from './wholesaler-reader';

// The wholesaler import's browser half: it reads a delivery's files with the
// one reader seam, turns the delivery into the lines the batch stages, keys
// the delivery for the repeat warning and splits the lines into the parts
// each staging call carries. The file's bytes never leave the browser
// (decision 0001). The dialog loads this module, and with it the reader,
// only when it reads a delivery. The database decides each line's effect on
// the catalog (migration 20261214090001).

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
function stagedDeliveryLines(delivery: WholesalerDelivery): StagedImportLine[] {
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

/** The rejected lines the preview lists, with file, line and reason. */
export function rejectedLines(lines: readonly StagedImportLine[]): WholesalerReportLine[] {
  return lines.flatMap((line) =>
    line.kind === 'rejection'
      ? [
          {
            fileName: line.file_name,
            lineNumber: line.line_number,
            articleNumber: line.article_number,
            reason: line.reason ?? 'Die Zeile konnte nicht gelesen werden.',
          },
        ]
      : [],
  );
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
async function deliveryContentHash(files: readonly { name: string; bytes: Uint8Array }[]): Promise<string> {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // One file at a time, so at most one copy of a large file is held for its digest.
  const fileHashes: string[] = [];
  for (const file of sorted) fileHashes.push(await sha256Hex(file.bytes));
  return sha256Hex(new TextEncoder().encode(fileHashes.join('\n')));
}

/** The unit each unit text of a delivery names, or null where the office must choose. */
export function guessUnitMapping(unitTexts: readonly string[]): Record<string, InventoryUnitCode | null> {
  return Object.fromEntries(unitTexts.map((text) => [text, normalizeInventoryUnitInput(text)]));
}

/** What the browser read from a delivery, or why it read nothing. */
type DeliveryReading = ActionResult<
  { delivery: WholesalerDelivery; lines: StagedImportLine[]; contentHash: string },
  'reader_unavailable' | 'delivery_unreadable' | 'delivery_empty' | 'delivery_too_large'
>;

/**
 * Reads a delivery's files in the browser with the reader this build
 * carries, or `reader` in a test: the delivery, the lines the batch stages,
 * and the delivery's content key.
 */
export async function readDeliveryFiles(
  files: readonly File[],
  reader?: Parameters<typeof readWholesalerDelivery>[1],
): Promise<DeliveryReading> {
  const read = await Promise.all(
    files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
  );
  let reading;
  try {
    reading = readWholesalerDelivery(read, reader);
  } catch {
    return { success: false, error: 'delivery_unreadable' };
  }
  if (!reading.installed) return { success: false, error: 'reader_unavailable' };
  const lines = stagedDeliveryLines(reading.delivery);
  if (lines.length === 0) return { success: false, error: 'delivery_empty' };
  if (lines.length > WHOLESALER_IMPORT_MAX_LINES) return { success: false, error: 'delivery_too_large' };
  return { success: true, delivery: reading.delivery, lines, contentHash: await deliveryContentHash(read) };
}

/**
 * The UTF-8 bytes of lines one staging call carries at most: half the 1 MB a
 * Server Action takes, so the rest holds the call's envelope (the batch id,
 * the brackets) and React's escape of each string that starts with `$`.
 */
const STAGE_PART_MAX_BYTES = 512 * 1024;
const utf8 = new TextEncoder();

/**
 * The lines in delivery order, split into the parts the staging calls carry:
 * each at most `maxLines` lines and 512 KB of UTF-8 JSON, so a part of long
 * names in three-byte characters still fits one request.
 */
export function stagingParts(lines: readonly StagedImportLine[], maxLines: number): StagedImportLine[][] {
  const parts: StagedImportLine[][] = [];
  let part: StagedImportLine[] = [];
  let bytes = 0;
  for (const line of lines) {
    // The line's JSON and the comma before it.
    const size = utf8.encode(JSON.stringify(line)).length + 1;
    if (part.length > 0 && (part.length === maxLines || bytes + size > STAGE_PART_MAX_BYTES)) {
      parts.push(part);
      part = [];
      bytes = 0;
    }
    part.push(line);
    bytes += size;
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

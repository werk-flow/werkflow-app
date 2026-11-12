import { decodeCp850 } from '@/lib/export-profile/text-decoding';
import {
  codeField,
  discountField,
  PRICE_KIND_CODES,
  PRICE_QUANTITY_CODES,
  readHeader,
  wholeNumberField,
} from '@/lib/inventory/datanorm/fields';
import { datanormLines, datanormRecordType, type DatanormLine } from '@/lib/inventory/datanorm/records';
import { datanormRejectionReason, type DatanormRejectionCode } from '@/lib/inventory/datanorm/rejections';
import type {
  DatanormArticle,
  DatanormDelivery,
  DatanormDiscount,
  DatanormFile,
  DatanormPriceChange,
} from '@/lib/inventory/datanorm/types';

// Reads one DATANORM 4 delivery from a wholesaler. The record layout below
// is written in our own words from public descriptions; no specification
// document is part of this repository:
// - comtech help "Datanorm-Datei": https://hilfe.comtech.at/ce/773/html/datanorm_datei.htm
// - solutioo "Unterschiede DATANORM 4 und 5": https://docs.solutioo.de/datanorm-item-import/import-von-datanorm-dateien/unterschiede
// - entitys "DATANORM: Das Format erklärt": https://entitys.io/magazin/datanorm
// - Wikipedia "Datanorm": https://de.wikipedia.org/wiki/Datanorm
// - flace.de examples of price and rebate files: https://flace.de/?p=577, https://flace.de/?p=1261
//
// Files: DATANORM.001 to .999 hold articles (A and B records), DATPREIS.001
// to .999 price changes (P), DATANORM.WRG product groups (S) and
// DATANORM.RAB rebate groups (R). Each file is code page 850 and starts with
// the fixed-width header (fields.ts). Every other line separates its fields
// with ";". Positions are 1-based:
// - A: 2 change (N new, A change, L delete), 3 article number, 5 and 6 short
//   texts, 7 price kind (1 list, 2 net), 8 price-unit code, 9 unit, 10 price
//   in cents (0 or empty: none here), 11 rebate group, 12 main product group.
// - B: 3 article number, 4 matchcode, 8 EAN, 10 product group.
// - P: 2 change (A change, P price on request), then up to three blocks of
//   nine fields from 3 on: article number, price kind, price in cents, and
//   three pairs of rebate code and value.
// - S: 3 main product group, 4 its text, 5 product group, 6 its text.
// - R: 3 rebate group, 4 rebate code, 5 rebate value, 6 text.

const ARTICLE_FILE = /^DATANORM\.(\d{3})$/i;
const PRICE_FILE = /^DATPREIS\.(\d{3})$/i;
const FILE_ORDER: Array<(name: string) => boolean> = [
  (name) => ARTICLE_FILE.test(name),
  (name) => PRICE_FILE.test(name),
  (name) => /^DATANORM\.WRG$/i.test(name),
  (name) => /^DATANORM\.RAB$/i.test(name),
];
/** Record types a delivery may carry that this reader leaves out: long texts, dimensions, sets and the like. */
const SKIPPED_RECORD_TYPES = new Set(['C', 'D', 'E', 'G', 'J', 'K', 'T', 'Z']);
const PRICE_BLOCK_START = 2;
const PRICE_BLOCK_LENGTH = 9;
const PRICE_BLOCKS_PER_LINE = 3;

type Reading = {
  delivery: DatanormDelivery;
  articlesByNumber: Map<string, DatanormArticle>;
  skippedLines: Map<string, number>;
};

type RecordLine = { file: string; line: number; fields: string[] };

/** Reads every file of one delivery; a line it cannot read lands in `rejected` with its file, line and reason. */
export function readDatanormDelivery(files: readonly DatanormFile[]): DatanormDelivery {
  const reading: Reading = {
    delivery: {
      header: null,
      articles: [],
      deletions: [],
      priceChanges: [],
      productGroups: [],
      rebateGroups: [],
      skipped: [],
      rejected: [],
    },
    articlesByNumber: new Map(),
    skippedLines: new Map(),
  };
  for (const file of orderedFiles(files)) {
    if (FILE_ORDER.some((matches) => matches(file.name))) readFile(reading, file);
    else reject(reading, { file: file.name, line: 1, fields: [] }, 'file_unknown', '');
  }
  reading.delivery.skipped = [...reading.skippedLines].map(([recordType, lines]) => ({ recordType, lines }));
  return reading.delivery;
}

function orderedFiles(files: readonly DatanormFile[]): DatanormFile[] {
  const rank = (file: DatanormFile): number => {
    const index = FILE_ORDER.findIndex((matches) => matches(file.name));
    return index === -1 ? FILE_ORDER.length : index;
  };
  return [...files].sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name));
}

function readFile(reading: Reading, file: DatanormFile): void {
  const [first, ...rest] = datanormLines(decodeCp850(file.bytes));
  if (!readFileHeader(reading, file.name, first)) return;
  for (const line of rest) {
    readRecord(reading, { file: file.name, line: line.lineNumber, fields: line.text.split(';') });
  }
}

function readFileHeader(reading: Reading, file: string, first: DatanormLine | undefined): boolean {
  const at: RecordLine = { file, line: first?.lineNumber ?? 1, fields: [] };
  const read = readHeader(first?.text ?? '');
  if (read.kind === 'not_a_header') {
    reject(reading, at, 'header_missing', '');
    return false;
  }
  if (read.kind === 'version_unsupported') {
    reject(reading, at, 'version_unsupported', read.version);
    return false;
  }
  reading.delivery.header ??= read.header;
  return true;
}

function readRecord(reading: Reading, record: RecordLine): void {
  const recordType = datanormRecordType(record.fields[0] ?? '');
  if (recordType === 'A') readArticle(reading, record);
  else if (recordType === 'B') readArticleDetails(reading, record);
  else if (recordType === 'P') readPriceChange(reading, record);
  else if (recordType === 'S') readProductGroup(reading, record);
  else if (recordType === 'R') readRebateGroup(reading, record);
  else if (recordType === 'V') reject(reading, record, 'header_misplaced', '');
  else if (SKIPPED_RECORD_TYPES.has(recordType))
    reading.skippedLines.set(recordType, (reading.skippedLines.get(recordType) ?? 0) + 1);
  else reject(reading, record, 'record_type_unknown', (record.fields[0] ?? '').trim());
}

const A_FIELDS = 10;

function readArticle(reading: Reading, record: RecordLine): void {
  if (record.fields.length < A_FIELDS) return reject(reading, record, 'too_few_fields', 'A');
  const change = field(record, 2);
  const articleNumber = field(record, 3);
  if (change !== 'N' && change !== 'A' && change !== 'L')
    return reject(reading, record, 'change_unknown', change);
  if (articleNumber === '') return reject(reading, record, 'article_number_missing', '');
  if (change === 'L') {
    reading.delivery.deletions.push({ file: record.file, line: record.line, articleNumber });
    return;
  }
  const priceQuantity = codeField(PRICE_QUANTITY_CODES, field(record, 8));
  if (!priceQuantity.ok) return reject(reading, record, 'price_unit_unknown', priceQuantity.written);
  const amount = wholeNumberField(field(record, 10));
  if (!amount.ok) return reject(reading, record, 'price_not_number', amount.written);
  const amountCents = amount.value !== null && amount.value > 0 ? amount.value : null;
  const priceKind = codeField(PRICE_KIND_CODES, field(record, 7));
  if (amountCents !== null && !priceKind.ok)
    return reject(reading, record, 'price_kind_unknown', priceKind.written);
  const article: DatanormArticle = {
    file: record.file,
    line: record.line,
    articleNumber,
    change: change === 'N' ? 'new' : 'change',
    shortText1: field(record, 5),
    shortText2: field(record, 6),
    unit: field(record, 9),
    priceQuantity: priceQuantity.value,
    price: amountCents !== null && priceKind.ok ? { kind: priceKind.value, amountCents } : null,
    rebateGroup: optionalField(record, 11),
    mainProductGroup: optionalField(record, 12),
    productGroup: null,
    ean: null,
    matchcode: null,
  };
  reading.delivery.articles.push(article);
  reading.articlesByNumber.set(articleNumber, article);
}

// A B record reaches at least its product group, field 10; a shorter one is cut off.
const B_FIELDS = 10;

function readArticleDetails(reading: Reading, record: RecordLine): void {
  if (record.fields.length < B_FIELDS) return reject(reading, record, 'too_few_fields', 'B');
  const articleNumber = field(record, 3);
  if (articleNumber === '') return reject(reading, record, 'article_number_missing', '');
  const article = reading.articlesByNumber.get(articleNumber);
  if (!article) return reject(reading, record, 'article_missing', articleNumber);
  article.matchcode = optionalField(record, 4);
  article.ean = optionalField(record, 8);
  article.productGroup = optionalField(record, 10);
}

const P_FIELDS = 5;

function readPriceChange(reading: Reading, record: RecordLine): void {
  if (record.fields.length < P_FIELDS) return reject(reading, record, 'too_few_fields', 'P');
  const change = field(record, 2);
  if (change !== 'A' && change !== 'P') return reject(reading, record, 'change_unknown', change);
  const changes: DatanormPriceChange[] = [];
  for (let block = 0; block < PRICE_BLOCKS_PER_LINE; block += 1) {
    const at = PRICE_BLOCK_START + block * PRICE_BLOCK_LENGTH;
    const values = record.fields.slice(at, at + PRICE_BLOCK_LENGTH).map((value) => value.trim());
    if ((values[0] ?? '') === '') continue;
    const read = priceBlock(values, change === 'P');
    if (!read.ok) return reject(reading, record, read.code, read.written);
    changes.push({ file: record.file, line: record.line, ...read.value });
  }
  if (changes.length === 0) return reject(reading, record, 'article_number_missing', '');
  reading.delivery.priceChanges.push(...changes);
}

type BlockRead =
  | { ok: true; value: Omit<DatanormPriceChange, 'file' | 'line'> }
  | { ok: false; code: DatanormRejectionCode; written: string };

function priceBlock(values: string[], onRequest: boolean): BlockRead {
  const [articleNumber = '', kind = '', price = '', ...discountPairs] = values;
  const priceKind = codeField(PRICE_KIND_CODES, kind);
  if (!priceKind.ok) return { ok: false, code: 'price_kind_unknown', written: priceKind.written };
  const amount = onRequest ? { ok: true as const, value: null } : wholeNumberField(price);
  if (!amount.ok) return { ok: false, code: 'price_not_number', written: amount.written };
  const discounts: DatanormDiscount[] = [];
  for (let pair = 0; pair < discountPairs.length; pair += 2) {
    const discount = discountField(discountPairs[pair] ?? '', discountPairs[pair + 1] ?? '');
    if (!discount.ok) return { ok: false, code: 'discount_not_number', written: discount.written };
    if (discount.value) discounts.push(discount.value);
  }
  return {
    ok: true,
    value: { articleNumber, priceKind: priceKind.value, amountCents: amount.value, discounts },
  };
}

const S_FIELDS = 3;

function readProductGroup(reading: Reading, record: RecordLine): void {
  const mainProductGroup = field(record, 3);
  if (record.fields.length < S_FIELDS || mainProductGroup === '')
    return reject(reading, record, 'too_few_fields', 'S');
  const productGroup = optionalField(record, 5);
  const text = productGroup === null ? field(record, 4) : field(record, 6);
  reading.delivery.productGroups.push({ mainProductGroup, productGroup, text });
}

const R_FIELDS = 5;

function readRebateGroup(reading: Reading, record: RecordLine): void {
  const rebateGroup = field(record, 3);
  if (record.fields.length < R_FIELDS || rebateGroup === '')
    return reject(reading, record, 'too_few_fields', 'R');
  const discount = discountField(field(record, 4), field(record, 5));
  if (!discount.ok) return reject(reading, record, 'discount_not_number', discount.written);
  if (!discount.value) return reject(reading, record, 'too_few_fields', 'R');
  reading.delivery.rebateGroups.push({ rebateGroup, discount: discount.value, text: field(record, 6) });
}

/** The trimmed field at a 1-based position; empty when the line is shorter. */
function field(record: RecordLine, position: number): string {
  return (record.fields[position - 1] ?? '').trim();
}

function optionalField(record: RecordLine, position: number): string | null {
  const value = field(record, position);
  return value === '' ? null : value;
}

function reject(reading: Reading, record: RecordLine, code: DatanormRejectionCode, fact: string): void {
  reading.delivery.rejected.push({
    file: record.file,
    line: record.line,
    code,
    reason: datanormRejectionReason(code, fact),
  });
}

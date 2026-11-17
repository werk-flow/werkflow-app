// Rule test: a read delivery becomes the lines the preview stages, a delivery
// is recognized again whatever order its files came in, and a unit text names
// a unit only when the unit list knows it. Synthetic data, no wholesaler file.
import { expect, test } from 'bun:test';
import {
  formatRebatePercent,
  ownPriceChangesForUnits,
  parseRebatePercent,
  wholesalerImportReportCsv,
  wholesalerPreviewTotals,
} from './wholesaler-import-lines';
import { WHOLESALER_STAGE_MAX_LINES, type WholesalerPriceChange } from './wholesaler-import-schemas';
import { guessUnitMapping, readDeliveryFiles, stagingParts } from './wholesaler-import-staging';
import type { WholesalerDelivery } from './wholesaler-reader';

const ARTICLE = {
  file: 'lieferung-nordrohr',
  line: 2,
  articleNumber: 'NR-1501',
  change: 'new',
  name: 'Kupferrohr 15 mm',
  nameAddition: 'hart',
  unit: 'Meter',
  priceQuantity: 100,
  price: { kind: 'list', amountCents: 61000 },
  rebateGroup: 'CU1',
  mainProductGroup: 'ROHR',
  productGroup: 'CU',
  ean: '4000000000017',
  matchcode: 'CU15',
} as const satisfies WholesalerDelivery['articles'][number];

function delivery(overrides: Partial<WholesalerDelivery>): WholesalerDelivery {
  return {
    header: { formatVersion: '4', supplierText: 'Großhandel Nordrohr', date: '2026-11-02', currency: 'EUR' },
    articles: [],
    deletions: [],
    priceChanges: [],
    productGroups: [],
    rebateGroups: [],
    skipped: [],
    rejections: [],
    ...overrides,
  };
}

type DeliveryReader = NonNullable<Parameters<typeof readDeliveryFiles>[1]>;

/** A fake reader that answers `read` in the reader's own words, whatever the bytes. */
function fakeReader(read: WholesalerDelivery): DeliveryReader {
  return () => ({
    header: read.header && {
      version: read.header.formatVersion,
      supplierText: read.header.supplierText,
      date: read.header.date,
      currency: read.header.currency,
    },
    articles: read.articles.map(({ name, nameAddition, ...article }) => ({
      ...article,
      shortText1: name,
      shortText2: nameAddition,
    })),
    deletions: read.deletions,
    priceChanges: read.priceChanges,
    productGroups: read.productGroups,
    rebateGroups: read.rebateGroups,
    skipped: read.skipped.map(({ kind, lines }) => ({ recordType: kind, lines })),
    rejected: read.rejections,
  });
}

/** The lines the browser stages for a delivery the fake reader answers. */
async function stagedDeliveryLines(read: WholesalerDelivery) {
  const reading = await readDeliveryFiles([new File([new Uint8Array([1])], 'lieferung')], fakeReader(read));
  if (!reading.success) throw new Error(reading.error);
  return reading.lines;
}

test('a price change of a delivered article becomes its price; one of another article stays a price line', async () => {
  const lines = await stagedDeliveryLines(
    delivery({
      articles: [ARTICLE],
      priceChanges: [
        {
          file: 'preise',
          line: 1,
          articleNumber: 'NR-1501',
          priceKind: 'net',
          amountCents: 41000,
          discounts: [],
        },
        {
          file: 'preise',
          line: 2,
          articleNumber: 'NR-2000',
          priceKind: 'list',
          amountCents: 990,
          discounts: [],
        },
      ],
    }),
  );
  expect(
    lines.map((line) => [line.ordinal, line.kind, line.article_number, line.price_kind, line.price_cents]),
  ).toEqual([
    [0, 'article', 'NR-1501', 'net', 41000],
    [1, 'price', 'NR-2000', 'list', 990],
  ]);
});

test('a price change of a rejected article stays a price line for the catalog row', async () => {
  const lines = await stagedDeliveryLines(
    delivery({
      articles: [{ ...ARTICLE, name: ' ' }],
      priceChanges: [
        {
          file: 'preise',
          line: 1,
          articleNumber: 'NR-1501',
          priceKind: 'net',
          amountCents: 41000,
          discounts: [],
        },
      ],
    }),
  );
  expect(lines.map((line) => [line.kind, line.article_number])).toEqual([
    ['rejection', 'NR-1501'],
    ['price', 'NR-1501'],
  ]);
});

test('a price given only on request is no price, never a zero', async () => {
  const [onRequest] = await stagedDeliveryLines(
    delivery({
      priceChanges: [
        {
          file: 'preise',
          line: 4,
          articleNumber: 'NR-3000',
          priceKind: 'list',
          amountCents: null,
          discounts: [],
        },
      ],
    }),
  );
  expect(onRequest).toMatchObject({ kind: 'price', price_kind: null, price_cents: null });
});

test('an article without number or name is a rejected line with a reason, and the reader’s rejections stay', async () => {
  const lines = await stagedDeliveryLines(
    delivery({
      articles: [
        { ...ARTICLE, line: 3, articleNumber: '  ' },
        { ...ARTICLE, line: 4, name: ' ' },
      ],
      deletions: [{ file: 'lieferung-nordrohr', line: 5, articleNumber: 'NR-0999' }],
      rejections: [
        { file: 'lieferung-nordrohr', line: 6, code: 'line_incomplete', reason: 'Der Zeile fehlen Angaben.' },
      ],
    }),
  );
  expect(lines.map((line) => [line.kind, line.line_number, line.reason_code, line.reason])).toEqual([
    ['rejection', 3, 'article_number_missing', 'Der Artikel hat keine Artikelnummer.'],
    ['rejection', 4, 'article_name_missing', 'Der Artikel hat keine Bezeichnung.'],
    ['deletion', 5, null, null],
    ['rejection', 6, 'line_incomplete', 'Der Zeile fehlen Angaben.'],
  ]);
});

test('the same files give the same delivery key in any order, and other bytes another key', async () => {
  const reader = fakeReader(delivery({ articles: [ARTICLE] }));
  const keyOf = async (files: File[]) => {
    const reading = await readDeliveryFiles(files, reader);
    if (!reading.success) throw new Error(reading.error);
    return reading.contentHash;
  };
  const first = new File([new Uint8Array([1, 2])], 'a');
  const second = new File([new Uint8Array([3])], 'b');
  const key = await keyOf([first, second]);
  expect(key).toMatch(/^[0-9a-f]{64}$/);
  expect(await keyOf([second, first])).toBe(key);
  expect(await keyOf([first, new File([new Uint8Array([4])], 'b')])).not.toBe(key);
});

test('a delivery the reader refuses or that holds nothing is no delivery to stage', async () => {
  const file = new File([new Uint8Array([1])], 'lieferung');
  expect(await readDeliveryFiles([file], null)).toEqual({ success: false, error: 'reader_unavailable' });
  expect(await readDeliveryFiles([file], fakeReader(delivery({})))).toEqual({
    success: false,
    error: 'delivery_empty',
  });
  const throwing: DeliveryReader = () => {
    throw new Error('unreadable');
  };
  expect(await readDeliveryFiles([file], throwing)).toEqual({ success: false, error: 'delivery_unreadable' });
});

test('each staging part fits the 1 MB a Server Action takes, counted in UTF-8 bytes, whatever characters its texts hold', async () => {
  // „“–€… take three UTF-8 bytes each, so a part's characters undercount its bytes threefold.
  // Umlauts and ß take two, which 400 000 characters never push past 1 MB.
  const text = (length: number) => '„“–€…'.repeat(length).slice(0, length);
  const lines = await stagedDeliveryLines(
    delivery({
      articles: Array.from({ length: 3000 }, (_, index) => ({
        ...ARTICLE,
        file: text(200),
        line: index + 2,
        articleNumber: `${index}-${text(190)}`,
        name: text(500),
        nameAddition: text(500),
        unit: text(200),
        rebateGroup: text(200),
        mainProductGroup: text(200),
        productGroup: text(200),
        ean: text(200),
        matchcode: text(200),
      })),
    }),
  );
  const parts = stagingParts(lines, WHOLESALER_STAGE_MAX_LINES);
  expect(parts.flat().map((line) => line.ordinal)).toEqual(lines.map((line) => line.ordinal));
  const importId = '00000000-0000-4000-8000-000000000001';
  for (const part of parts) {
    // The body of one staging call: React sends the action's arguments as one JSON array.
    const body = new TextEncoder().encode(JSON.stringify([{ importId, lines: part }]));
    expect(body.length).toBeLessThan(1024 * 1024);
  }
});

test('a unit text names a unit of the list or nothing, never Stück by default', () => {
  expect(guessUnitMapping(['Meter', 'Stk.', 'XYZ', ''])).toEqual({
    Meter: 'meter',
    'Stk.': 'piece',
    XYZ: null,
    '': null,
  });
});

test('the report lists file, line, article number and reason', () => {
  const csv = new TextDecoder().decode(
    wholesalerImportReportCsv([
      {
        fileName: 'lieferung',
        lineNumber: 7,
        articleNumber: 'NR-1',
        reason: 'Die Einheit „XYZ“ ist keiner Einheit zugeordnet.',
      },
      { fileName: 'lieferung', lineNumber: 9, articleNumber: null, reason: 'Der Zeile fehlen Angaben.' },
    ]),
  );
  expect(csv.replace(/^﻿/, '').split('\r\n')).toEqual([
    'Datei;Zeile;Artikelnummer;Grund',
    'lieferung;7;NR-1;Die Einheit „XYZ“ ist keiner Einheit zugeordnet.',
    'lieferung;9;;Der Zeile fehlen Angaben.',
    '',
  ]);
});

test('the preview counts follow the unit choice: an unmapped unit text rejects its articles, another unit changes them', () => {
  const preview = {
    units: [
      {
        unitText: 'Meter',
        articles: 3,
        created: 1,
        changed: 1,
        unchanged: 1,
        unchangedByUnit: { meter: 1 },
        priceChanged: 1,
      },
      {
        unitText: 'XYZ',
        articles: 2,
        created: 2,
        changed: 0,
        unchanged: 0,
        unchangedByUnit: {},
        priceChanged: 0,
      },
    ],
    priceUpdates: 4,
    priceUnmatched: 1,
    removed: 2,
    rejected: 5,
    prices: { rebateGroups: [], rebates: {}, changes: [], fingerprint: '0'.repeat(32) },
  };
  expect(wholesalerPreviewTotals(preview, { Meter: 'meter', XYZ: null })).toEqual({
    created: 1,
    changed: 1,
    unchanged: 1,
    priceChanged: 1,
    unitRejected: 2,
    priceUpdates: 4,
    priceUnmatched: 1,
    removed: 2,
    rejected: 5,
    ownPricesChanged: 0,
  });
  expect(wholesalerPreviewTotals(preview, { Meter: 'meter', XYZ: 'piece' })).toMatchObject({
    created: 3,
    unitRejected: 0,
  });
  expect(wholesalerPreviewTotals(preview, { Meter: 'rod', XYZ: null })).toMatchObject({
    changed: 2,
    unchanged: 0,
  });
});

/** A price change of the pipe, counted in Meter, from an article line with the unit text „Meter“. */
function pipeChange(overrides: Partial<WholesalerPriceChange>): WholesalerPriceChange {
  return {
    itemId: '47700000-0000-4000-8000-000000000021',
    itemName: 'Kupferrohr 15 mm',
    itemUnit: 'meter',
    articleNumber: 'NR-1501',
    unitText: 'Meter',
    catalogUnit: null,
    kind: 'sale',
    rebateGroup: 'CU1',
    rebateBasisPoints: null,
    old: { amountCents: 500, priceQuantity: 1 },
    new: { amountCents: 61000, priceQuantity: 100 },
    validFrom: '2026-11-17',
    ...overrides,
  };
}

test("an own price changes only in the article's unit: an article line by the office's mapping, a price line by the catalog's unit", () => {
  const article = pipeChange({});
  const priceLine = pipeChange({ unitText: null, catalogUnit: 'meter', kind: 'purchase' });
  const otherUnitPriceLine = pipeChange({ unitText: null, catalogUnit: 'piece', kind: 'purchase' });
  const changes = [article, priceLine, otherUnitPriceLine];

  expect(ownPriceChangesForUnits(changes, { Meter: 'meter' })).toEqual({
    applied: [article, priceLine],
    otherUnit: [otherUnitPriceLine],
  });
  // Mapped to another unit, the article line's price no longer fits the article.
  expect(ownPriceChangesForUnits(changes, { Meter: 'rod' })).toEqual({
    applied: [priceLine],
    otherUnit: [article, otherUnitPriceLine],
  });
  // Left unmapped, the article is rejected and changes no price.
  expect(ownPriceChangesForUnits(changes, { Meter: null }).applied).toEqual([priceLine]);
  expect(
    wholesalerPreviewTotals(
      {
        units: [],
        priceUpdates: 0,
        priceUnmatched: 0,
        removed: 0,
        rejected: 0,
        prices: { rebateGroups: [], rebates: {}, changes, fingerprint: '0'.repeat(32) },
      },
      { Meter: 'meter' },
    ).ownPricesChanged,
  ).toBe(2);
});

test('a rebate reads as typed in German, in hundredths of a percent from 0 to 100', () => {
  expect(parseRebatePercent('32,5')).toBe(3250);
  expect(parseRebatePercent(' 32,55 % ')).toBe(3255);
  expect(parseRebatePercent('0')).toBe(0);
  expect(parseRebatePercent('100')).toBe(10_000);
  expect(parseRebatePercent('')).toBeNull();
  expect(parseRebatePercent('100,01')).toBeUndefined();
  expect(parseRebatePercent('12,345')).toBeUndefined();
  expect(parseRebatePercent('-5')).toBeUndefined();
  expect(parseRebatePercent('dreißig')).toBeUndefined();
  expect(parseRebatePercent('10%0')).toBeUndefined();
  expect(parseRebatePercent('%10')).toBeUndefined();
  expect(formatRebatePercent(3250)).toBe('32,5');
  expect(formatRebatePercent(3000)).toBe('30');
});

// Rule test: the wholesaler-file reader reaches the app only in the app's own words, and a build without a reader
// says the import is unavailable and reads nothing. The fake reader returns synthetic data, never a wholesaler file.
import { expect, test } from 'bun:test';
import { readWholesalerDelivery, type WholesalerFile } from './wholesaler-reader';

const FILES: WholesalerFile[] = [{ name: 'lieferung-nordrohr-1', bytes: new Uint8Array([1, 2, 3]) }];
const PLACE = { file: 'lieferung-nordrohr-1', line: 2 };

test('without a reader the import says it is unavailable here and reads nothing', () => {
  expect(readWholesalerDelivery(FILES, null)).toEqual({
    installed: false,
    reason: 'Dieser Import ist in dieser Umgebung nicht verfügbar.',
  });
});

test("a delivery reaches the app as its own articles, prices, rebate groups and rejections, and nothing else of the reader's result", () => {
  const passed: WholesalerFile[][] = [];
  const reading = readWholesalerDelivery(FILES, (files) => {
    passed.push(files);
    return {
      header: { version: '7', supplierText: 'Großhandel Nordrohr', date: '2026-11-02', currency: 'EUR' },
      articles: [
        {
          ...PLACE,
          articleNumber: 'NR-1501',
          change: 'new',
          shortText1: 'Kupferrohr 15 mm',
          shortText2: 'hart, 5 m Stange',
          unit: 'Meter',
          priceQuantity: 100,
          price: { kind: 'list', amountCents: 61000 },
          rebateGroup: 'CU1',
          mainProductGroup: 'ROHR',
          productGroup: 'CU',
          ean: '4000000000017',
          matchcode: 'CU15',
          // A field a newer reader may add does not pass the seam.
          ...{ internalNote: 'nicht für die App' },
        },
        {
          ...PLACE,
          line: 3,
          articleNumber: 'NR-1502',
          change: 'change',
          shortText1: 'Pressfitting 15 mm',
          shortText2: '',
          unit: 'Stück',
          priceQuantity: 1,
          price: null,
          rebateGroup: null,
          mainProductGroup: null,
          productGroup: null,
          ean: null,
          matchcode: null,
        },
      ],
      deletions: [{ ...PLACE, line: 4, articleNumber: 'NR-0999' }],
      priceChanges: [
        {
          file: 'preise-nordrohr-1',
          line: 2,
          articleNumber: 'NR-1502',
          priceKind: 'net',
          amountCents: 389,
          discounts: [
            { kind: 'rebate_group', rebateGroup: 'FIT' },
            { kind: 'percent', hundredthsOfPercent: 1250 },
            { kind: 'unread', code: 'z', value: '105' },
          ],
        },
        {
          file: 'preise-nordrohr-1',
          line: 3,
          articleNumber: 'NR-1501',
          priceKind: 'list',
          amountCents: null,
          discounts: [],
        },
      ],
      productGroups: [{ mainProductGroup: 'ROHR', productGroup: null, text: 'Rohre' }],
      rebateGroups: [
        { rebateGroup: 'CU1', discount: { kind: 'percent', hundredthsOfPercent: 3000 }, text: 'Kupfer' },
      ],
      skipped: [{ recordType: 'langtext', lines: 12 }],
      rejected: [{ ...PLACE, line: 9, code: 'line_incomplete', reason: 'Der Zeile fehlen Angaben.' }],
    };
  });

  expect(passed).toEqual([FILES]);
  expect(reading).toEqual({
    installed: true,
    delivery: {
      header: {
        formatVersion: '7',
        supplierText: 'Großhandel Nordrohr',
        date: '2026-11-02',
        currency: 'EUR',
      },
      articles: [
        {
          ...PLACE,
          articleNumber: 'NR-1501',
          change: 'new',
          name: 'Kupferrohr 15 mm',
          nameAddition: 'hart, 5 m Stange',
          unit: 'Meter',
          priceQuantity: 100,
          price: { kind: 'list', amountCents: 61000 },
          rebateGroup: 'CU1',
          mainProductGroup: 'ROHR',
          productGroup: 'CU',
          ean: '4000000000017',
          matchcode: 'CU15',
        },
        {
          ...PLACE,
          line: 3,
          articleNumber: 'NR-1502',
          change: 'change',
          name: 'Pressfitting 15 mm',
          nameAddition: '',
          unit: 'Stück',
          priceQuantity: 1,
          price: null,
          rebateGroup: null,
          mainProductGroup: null,
          productGroup: null,
          ean: null,
          matchcode: null,
        },
      ],
      deletions: [{ ...PLACE, line: 4, articleNumber: 'NR-0999' }],
      priceChanges: [
        {
          file: 'preise-nordrohr-1',
          line: 2,
          articleNumber: 'NR-1502',
          priceKind: 'net',
          amountCents: 389,
          discounts: [
            { kind: 'rebate_group', rebateGroup: 'FIT' },
            { kind: 'percent', hundredthsOfPercent: 1250 },
            { kind: 'unread', code: 'z', value: '105' },
          ],
        },
        {
          file: 'preise-nordrohr-1',
          line: 3,
          articleNumber: 'NR-1501',
          priceKind: 'list',
          amountCents: null,
          discounts: [],
        },
      ],
      productGroups: [{ mainProductGroup: 'ROHR', productGroup: null, text: 'Rohre' }],
      rebateGroups: [
        { rebateGroup: 'CU1', discount: { kind: 'percent', hundredthsOfPercent: 3000 }, text: 'Kupfer' },
      ],
      skipped: [{ kind: 'langtext', lines: 12 }],
      rejections: [{ ...PLACE, line: 9, code: 'line_incomplete', reason: 'Der Zeile fehlen Angaben.' }],
    },
  });
});

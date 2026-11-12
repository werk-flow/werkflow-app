import { describe, expect, test } from 'bun:test';
import { decodeCp850 } from '@/lib/export-profile/text-decoding';
import { readDatanormDelivery } from '@/lib/inventory/datanorm/read-delivery';
import { brokenNordrohrDelivery, nordrohrDelivery } from '@/lib/testing/fixtures/datanorm/deliveries';

describe('a clean DATANORM 4 delivery', () => {
  const delivery = readDatanormDelivery(nordrohrDelivery());

  test('the header names version, supplier text, date and currency', () => {
    expect(delivery.header).toEqual({
      version: '04',
      supplierText: 'Großhandel Nordrohr GmbH Katalog Sanitär und Heizung',
      date: '2026-05-12',
      currency: 'EUR',
    });
  });

  test('a delivery split over .001 and .002 reads as one, in file order, whatever order the files arrive in', () => {
    expect(delivery.articles.map((article) => [article.file, article.articleNumber])).toEqual([
      ['DATANORM.001', 'NR-1001'],
      ['DATANORM.001', 'NR-1002'],
      ['DATANORM.001', 'NR-1003'],
      ['DATANORM.002', 'NR-1004'],
    ]);
    const bend = delivery.articles.find((article) => article.articleNumber === 'NR-1002');
    expect(bend).toMatchObject({ matchcode: 'PRESSBOGEN15', ean: '4006501000024', productGroup: '1020' });
  });

  test('an A record with its B record becomes one article with texts, unit, price, groups, EAN and matchcode', () => {
    expect(delivery.articles[0]).toEqual({
      file: 'DATANORM.001',
      line: 2,
      articleNumber: 'NR-1001',
      change: 'new',
      shortText1: 'Kupferrohr 15 mm',
      shortText2: 'Stange 5 m',
      unit: 'm',
      priceQuantity: 1,
      price: { kind: 'list', amountCents: 1290 },
      rebateGroup: 'KU',
      mainProductGroup: '10',
      productGroup: '1010',
      ean: '4006501000017',
      matchcode: 'KUPFERROHR15',
    });
  });

  test('a net price per 100 keeps its whole cents and price quantity 100', () => {
    expect(delivery.articles[1]).toMatchObject({
      shortText1: 'Pressbogen 90°',
      unit: 'Stk',
      priceQuantity: 100,
      price: { kind: 'net', amountCents: 48750 },
    });
  });

  test('a price of 0 is no price, so the article waits for a price file', () => {
    expect(delivery.articles[2]?.price).toBeNull();
  });

  test('a change record decodes its code page 850 umlaut and reads price per 10', () => {
    expect(delivery.articles[3]).toMatchObject({
      change: 'change',
      shortText1: 'Heizkörperventil',
      priceQuantity: 10,
      price: { kind: 'list', amountCents: 15990 },
    });
  });

  test('a delete record names the article it removes', () => {
    expect(delivery.deletions).toEqual([{ file: 'DATANORM.001', line: 7, articleNumber: 'NR-0999' }]);
  });

  test('one price line carries up to three articles with their rebates, and "on request" stays empty', () => {
    expect(
      delivery.priceChanges.map(({ articleNumber, priceKind, amountCents, discounts }) => ({
        articleNumber,
        priceKind,
        amountCents,
        discounts,
      })),
    ).toEqual([
      {
        articleNumber: 'NR-1001',
        priceKind: 'net',
        amountCents: 1150,
        discounts: [{ kind: 'percent', hundredthsOfPercent: 1500 }],
      },
      {
        articleNumber: 'NR-1003',
        priceKind: 'list',
        amountCents: 2450,
        discounts: [{ kind: 'rebate_group', rebateGroup: 'KU' }],
      },
      { articleNumber: 'NR-1004', priceKind: 'net', amountCents: 14990, discounts: [] },
      { articleNumber: 'NR-1002', priceKind: 'net', amountCents: null, discounts: [] },
    ]);
  });

  test('product groups and rebate groups read with their texts', () => {
    expect(delivery.productGroups).toEqual([
      { mainProductGroup: '10', productGroup: null, text: 'Rohre und Fittings' },
      { mainProductGroup: '10', productGroup: '1010', text: 'Kupferrohr' },
    ]);
    expect(delivery.rebateGroups).toEqual([
      { rebateGroup: 'KU', discount: { kind: 'percent', hundredthsOfPercent: 2500 }, text: 'Kupfer' },
      { rebateGroup: 'PF', discount: { kind: 'percent', hundredthsOfPercent: 3250 }, text: 'Pressfittings' },
    ]);
  });

  test('a long-text record is counted as skipped, and nothing is rejected', () => {
    expect(delivery.skipped).toEqual([{ recordType: 'T', lines: 1 }]);
    expect(delivery.rejected).toEqual([]);
  });
});

describe('a broken DATANORM delivery', () => {
  const delivery = readDatanormDelivery(brokenNordrohrDelivery());
  const rejected = delivery.rejected.map(({ file, line, code }) => ({ file, line, code }));

  test('every refused line or file names file, line and its kind of problem', () => {
    expect(rejected).toEqual([
      { file: 'DATANORM.001', line: 2, code: 'too_few_fields' },
      { file: 'DATANORM.001', line: 3, code: 'price_not_number' },
      { file: 'DATANORM.001', line: 4, code: 'price_unit_unknown' },
      { file: 'DATANORM.001', line: 6, code: 'price_not_number' },
      { file: 'DATANORM.001', line: 7, code: 'record_type_unknown' },
      { file: 'DATANORM.002', line: 1, code: 'header_missing' },
      { file: 'DATPREIS.001', line: 1, code: 'version_unsupported' },
      { file: 'DATANORM.WRG', line: 1, code: 'version_unsupported' },
      { file: 'Preisliste.csv', line: 1, code: 'file_unknown' },
    ]);
  });

  test('the reason is a German sentence that names the written value', () => {
    const reasons = delivery.rejected.map((rejection) => rejection.reason);
    expect(reasons).toContain('Der Preis „12,50“ ist keine ganze Zahl in Cent.');
    expect(reasons).toContain(
      'Die Preiseinheit „5“ ist unbekannt. Erlaubt sind 0, 1, 2 und 3 (Preis je 1, 10, 100 oder 1000 Einheiten).',
    );
    expect(reasons).toContain('Die Datei hat die DATANORM-Version „050“. WerkFlow liest nur DATANORM 4.');
    expect(reasons).toContain('Die Datei hat die DATANORM-Version „03“. WerkFlow liest nur DATANORM 4.');
  });

  test('a refused file contributes nothing, and the readable line keeps an unknown unit as written', () => {
    expect(delivery.articles.map((article) => [article.articleNumber, article.unit])).toEqual([
      ['NR-2004', 'Bund'],
    ]);
    expect(delivery.priceChanges).toEqual([]);
    expect(delivery.productGroups).toEqual([]);
  });
});

describe('code page 850', () => {
  test('the German letters and the degree sign decode from their DOS bytes', () => {
    expect(decodeCp850(Uint8Array.from([0x84, 0x94, 0x81, 0x8e, 0x99, 0x9a, 0xe1, 0xf8, 0x41]))).toBe(
      'äöüÄÖÜß°A',
    );
  });
});

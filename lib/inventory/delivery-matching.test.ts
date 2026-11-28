import { expect, test } from 'bun:test';

import type { DeliveryArticle } from './delivery-articles';
import { type DeliveryLine, matchDeliveryLine } from './delivery-matching';

const reference = (
  number: string,
  purchaseUnit: string | null,
  packQuantity: number,
  baseQuantity: number,
) => ({
  id: `ref-${number}`,
  supplierId: 'supplier-gc',
  supplierArticleNumber: number,
  purchaseUnit,
  packQuantity,
  baseQuantity,
  isPreferred: true,
});

const COPPER_PIPE: DeliveryArticle = {
  itemId: 'item-pipe',
  name: 'Kupferrohr 15 mm',
  internalSku: 'CU-15',
  unit: 'meter',
  // One Stange holds 5 m.
  references: [reference('GC-15015', 'rod', 1, 5)],
  barcodes: ['4012345000158'],
};
const ELBOW: DeliveryArticle = {
  itemId: 'item-elbow',
  name: 'Pressbogen 90° 22 mm',
  internalSku: 'PB-22',
  unit: 'piece',
  // The supplier sells it per piece.
  references: [reference('GC-22090', null, 1, 1)],
  barcodes: [],
};

const line = (fields: Partial<DeliveryLine>): DeliveryLine => ({
  artikelnummer: null,
  ean: null,
  menge: null,
  einheit: null,
  packungsinhalt: null,
  ...fields,
});

const ARTICLES = [COPPER_PIPE, ELBOW];

test('a line in the supplier’s purchase unit converts through the stored pack', () => {
  const match = matchDeliveryLine(line({ artikelnummer: 'GC-15015', menge: 4, einheit: 'Stange' }), ARTICLES);
  expect(match).toEqual({
    article: { itemId: 'item-pipe', name: 'Kupferrohr 15 mm', internalSku: 'CU-15', unit: 'meter' },
    via: 'artikelnummer',
    baseQuantity: 20,
    problems: [],
  });
});

test('a line in the base unit counts as it stands, and an EAN finds the article without a number', () => {
  const match = matchDeliveryLine(line({ ean: '4012345000158', menge: 7.5, einheit: 'm' }), ARTICLES);
  expect([match.via, match.baseQuantity, match.problems]).toEqual(['ean', 7.5, []]);
});

test('a pack of 10 against a piece article converts by the printed pack content and says so', () => {
  const match = matchDeliveryLine(
    line({ artikelnummer: 'GC-22090', menge: 2, einheit: 'VE', packungsinhalt: 10 }),
    ARTICLES,
  );
  expect([match.article?.itemId, match.baseQuantity, match.problems]).toEqual([
    'item-elbow',
    20,
    ['packung_umgerechnet'],
  ]);
});

test('an unknown article number finds no article', () => {
  expect(matchDeliveryLine(line({ artikelnummer: 'GC-99999', menge: 1, einheit: 'Stk' }), ARTICLES)).toEqual({
    article: null,
    via: null,
    baseQuantity: null,
    problems: ['artikel_unbekannt'],
  });
});

test('a unit outside the list gives no quantity and names the unit problem', () => {
  const match = matchDeliveryLine(line({ artikelnummer: 'GC-15015', menge: 4, einheit: 'Bündel' }), ARTICLES);
  expect([match.article?.itemId, match.baseQuantity, match.problems]).toEqual([
    'item-pipe',
    null,
    ['einheit_unbekannt'],
  ]);
});

test('a listed unit that fits neither the purchase nor the base unit is a mismatch', () => {
  const match = matchDeliveryLine(line({ artikelnummer: 'GC-15015', menge: 4, einheit: 'kg' }), ARTICLES);
  expect([match.baseQuantity, match.problems]).toEqual([null, ['einheit_abweichend']]);
});

test('two own articles with one number are ambiguous, and a line without quantity says so', () => {
  const twin = { ...ELBOW, itemId: 'item-twin', references: [reference('GC-15015', null, 1, 1)] };
  expect(
    matchDeliveryLine(line({ artikelnummer: 'GC-15015', menge: 1 }), [...ARTICLES, twin]).problems,
  ).toEqual(['mehrdeutig']);
  expect(matchDeliveryLine(line({ artikelnummer: 'GC-22090' }), ARTICLES).problems).toEqual(['menge_fehlt']);
});

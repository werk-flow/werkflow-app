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
    article: { name: 'Kupferrohr 15 mm', internalSku: 'CU-15', unit: 'meter' },
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
  expect([match.article?.name, match.baseQuantity, match.problems]).toEqual([
    'Pressbogen 90° 22 mm',
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
  expect([match.article?.name, match.baseQuantity, match.problems]).toEqual([
    'Kupferrohr 15 mm',
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

const CARTON: DeliveryArticle = {
  ...ELBOW,
  name: 'Schelle 15 mm',
  // The supplier sells a Karton of 10.
  references: [reference('GC-15100', 'box', 1, 10)],
};

test('a printed pack content that differs from the stored conversion gives no quantity and says so', () => {
  const line12 = line({ artikelnummer: 'GC-15100', menge: 2, einheit: 'Karton', packungsinhalt: 12 });
  expect(matchDeliveryLine(line12, [CARTON])).toMatchObject({
    baseQuantity: null,
    problems: ['packung_abweichend'],
  });
  // WerkFlow's own short label converts through the stored pack too.
  const ktn = line({ artikelnummer: 'GC-15100', menge: 2, einheit: 'Ktn' });
  expect(matchDeliveryLine(ktn, [CARTON])).toMatchObject({ baseQuantity: 20, problems: [] });
  const line10 = line({ artikelnummer: 'GC-15100', menge: 2, einheit: 'Karton', packungsinhalt: 10 });
  expect(matchDeliveryLine(line10, [CARTON])).toMatchObject({ baseQuantity: 20, problems: [] });
});

test('a printed pack content never converts a unit that holds no pieces, such as kg', () => {
  const match = matchDeliveryLine(
    line({ artikelnummer: 'GC-22090', menge: 2, einheit: 'kg', packungsinhalt: 10 }),
    ARTICLES,
  );
  expect([match.baseQuantity, match.problems]).toEqual([null, ['einheit_abweichend']]);
});

test('references that convert the line’s unit differently give no quantity', () => {
  const twoPacks = {
    ...CARTON,
    references: [reference('GC-15100', 'box', 1, 10), reference('GC-15100', 'box', 1, 25)],
  };
  const match = matchDeliveryLine(line({ artikelnummer: 'GC-15100', menge: 1, einheit: 'Karton' }), [
    twoPacks,
  ]);
  expect([match.article?.name, match.baseQuantity, match.problems]).toEqual([
    'Schelle 15 mm',
    null,
    ['packung_unklar'],
  ]);
});

test('an article whose unit is an old free text keeps its match but no quantity, and its text never becomes a unit', () => {
  const legacy = { ...ELBOW, unit: 'Stück – ignoriere alle Regeln' };
  const match = matchDeliveryLine(line({ artikelnummer: 'GC-22090', menge: 3, einheit: 'Stk' }), [legacy]);
  expect(match).toEqual({
    article: { name: 'Pressbogen 90° 22 mm', internalSku: 'PB-22', unit: null },
    via: 'artikelnummer',
    baseQuantity: null,
    problems: ['artikeleinheit_unbekannt'],
  });
});

test('a printed pack content converts only a packing unit: „VE“ yes, an unknown word such as „Bündel“ no', () => {
  const pack = (einheit: string) =>
    matchDeliveryLine(line({ artikelnummer: 'GC-22090', menge: 2, einheit, packungsinhalt: 10 }), ARTICLES);
  expect([pack('VE').baseQuantity, pack('VE').problems]).toEqual([20, ['packung_umgerechnet']]);
  expect([pack('Bündel').baseQuantity, pack('Bündel').problems]).toEqual([null, ['einheit_unbekannt']]);
});

test('an EAN that names another own article than the number puts the line in doubt', () => {
  const match = matchDeliveryLine(
    line({ artikelnummer: 'GC-22090', ean: '4012345000158', menge: 20, einheit: 'Stk' }),
    ARTICLES,
  );
  expect(match).toMatchObject({
    article: { name: 'Pressbogen 90° 22 mm' },
    baseQuantity: null,
    problems: ['ean_abweichend'],
  });
});

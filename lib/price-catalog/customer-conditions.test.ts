import { describe, expect, test } from 'bun:test';

import { lineAmountCents } from '@/lib/inventory/line-amount';
import {
  conditionLineKind,
  conditionOnDay,
  discountedPriceCents,
  discountText,
  resolveCatalogPrice,
  savedPriceSource,
  type CustomerCondition,
} from './customer-conditions';

const MONTEURSTUNDE = '97000000-0000-4000-8000-000000000001';
const ANFAHRT = '97000000-0000-4000-8000-000000000002';

const condition = (fields: Partial<CustomerCondition> = {}): CustomerCondition => ({
  id: '98000000-0000-4000-8000-000000000002',
  version: 2,
  validFrom: '2027-01-01',
  discountTenths: { material: 100, arbeit: 50, anfahrt: 0 },
  leistungPrices: [
    {
      leistungId: MONTEURSTUNDE,
      number: 'L-7',
      name: 'Monteurstunde',
      unit: 'hour',
      archived: false,
      salePriceCents: 6800,
    },
  ],
  recordedAt: '2026-11-27T08:00:00Z',
  ...fields,
});
const fromVersion2 = {
  kind: 'kundenkondition',
  condition: { id: '98000000-0000-4000-8000-000000000002', version: 2, validFrom: '2027-01-01' },
} as const;

describe('resolveCatalogPrice', () => {
  const cases: Array<
    [string, Parameters<typeof resolveCatalogPrice>[0], ReturnType<typeof resolveCatalogPrice>]
  > = [
    [
      'without a condition the list price stands',
      {
        listPrice: { amountCents: 7250, priceQuantity: 1 },
        lineKind: 'arbeit',
        leistungId: MONTEURSTUNDE,
        condition: null,
      },
      { amountCents: 7250, priceQuantity: 1, source: { kind: 'listenpreis' } },
    ],
    [
      "the Leistung's own price beats the list price and takes no discount",
      {
        listPrice: { amountCents: 7250, priceQuantity: 1 },
        lineKind: 'arbeit',
        leistungId: MONTEURSTUNDE,
        condition: condition(),
      },
      { amountCents: 6800, priceQuantity: 1, source: fromVersion2 },
    ],
    [
      'an own price applies even while the Leistung has no list price',
      { listPrice: null, lineKind: 'arbeit', leistungId: MONTEURSTUNDE, condition: condition() },
      { amountCents: 6800, priceQuantity: 1, source: fromVersion2 },
    ],
    [
      "another Leistung's own price does not apply; the discount of its kind does",
      {
        listPrice: { amountCents: 7250, priceQuantity: 1 },
        lineKind: 'arbeit',
        leistungId: ANFAHRT,
        condition: condition(),
      },
      // 7250 × 0,95 = 6887,5 → 6888
      { amountCents: 6888, priceQuantity: 1, source: fromVersion2 },
    ],
    [
      'material takes the material discount, rounded half away from zero once',
      {
        listPrice: { amountCents: 1234, priceQuantity: 1 },
        lineKind: 'material',
        leistungId: null,
        condition: condition(),
      },
      // 1234 × 0,9 = 1110,6 → 1111
      { amountCents: 1111, priceQuantity: 1, source: fromVersion2 },
    ],
    [
      'a price per 100 stays per 100 and keeps its precision',
      {
        listPrice: { amountCents: 1890, priceQuantity: 100 },
        lineKind: 'material',
        leistungId: null,
        condition: condition({ discountTenths: { material: 125, arbeit: 0, anfahrt: 0 } }),
      },
      // 1890 × 0,875 = 1653,75 → 1654 per 100
      { amountCents: 1654, priceQuantity: 100, source: fromVersion2 },
    ],
    [
      'a kind without a discount keeps the list price as its source',
      {
        listPrice: { amountCents: 4500, priceQuantity: 1 },
        lineKind: 'anfahrt',
        leistungId: ANFAHRT,
        condition: condition(),
      },
      { amountCents: 4500, priceQuantity: 1, source: { kind: 'listenpreis' } },
    ],
    [
      'a Leistung of another kind (a Pauschale) takes no discount',
      {
        listPrice: { amountCents: 15000, priceQuantity: 1 },
        lineKind: null,
        leistungId: ANFAHRT,
        condition: condition({ discountTenths: { material: 100, arbeit: 100, anfahrt: 100 } }),
      },
      { amountCents: 15000, priceQuantity: 1, source: { kind: 'listenpreis' } },
    ],
    [
      'neither an own price nor a list price: nothing to resolve',
      { listPrice: null, lineKind: 'arbeit', leistungId: ANFAHRT, condition: condition() },
      null,
    ],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => expect(resolveCatalogPrice(input)).toEqual(expected));
  }

  test('a discounted price rounds once per line: a negative line and a quantity with three decimals', () => {
    // 1001 × 0,95 = 950,95 → 951; the line −0,5 × 951 = −475,5 → −476, half away from zero.
    const resolved = resolveCatalogPrice({
      listPrice: { amountCents: 1001, priceQuantity: 1 },
      lineKind: 'material',
      leistungId: null,
      condition: condition({ discountTenths: { material: 50, arbeit: 0, anfahrt: 0 } }),
    });
    expect(resolved?.amountCents).toBe(951);
    expect(lineAmountCents('-0.5', 951, 1)).toBe(-476);
    // 250 pieces at 1654 per 100 = 4135; 2,125 m at 1111 = 2360,875 → 2361.
    expect(lineAmountCents('250', 1654, 100)).toBe(4135);
    expect(lineAmountCents('2.125', 1111, 1)).toBe(2361);
  });
});

describe('discountedPriceCents', () => {
  test('0 and 100 % are the bounds', () => {
    expect(discountedPriceCents(1234, 0)).toBe(1234);
    expect(discountedPriceCents(1234, 1000)).toBe(0);
    expect(() => discountedPriceCents(1234, 1001)).toThrow(RangeError);
    expect(() => discountedPriceCents(1234, -1)).toThrow(RangeError);
    expect(() => discountedPriceCents(1234, 12.5)).toThrow(RangeError);
  });
});

describe('conditionOnDay', () => {
  const version = (number: number, validFrom: string) =>
    condition({ id: `98000000-0000-4000-8000-00000000000${String(number)}`, version: number, validFrom });
  const versions = [version(3, '2027-03-01'), version(2, '2027-01-01'), version(1, '2026-12-01')];

  test('the version valid on the offer’s date applies', () => {
    expect(conditionOnDay(versions, '2026-11-30')).toBeNull();
    expect(conditionOnDay(versions, '2026-12-01')?.version).toBe(1);
    expect(conditionOnDay(versions, '2027-02-28')?.version).toBe(2);
    expect(conditionOnDay(versions, '2027-03-01')?.version).toBe(3);
  });

  test('of two versions with the same first day the newer applies, in any order', () => {
    const same = [version(4, '2027-01-01'), ...versions];
    expect(conditionOnDay(same, '2027-01-15')?.version).toBe(4);
    expect(conditionOnDay([...same].reverse(), '2027-01-15')?.version).toBe(4);
  });
});

describe('conditionLineKind', () => {
  test('an article is material; a Leistung of kind Arbeit or Anfahrt is its kind; any other none', () => {
    expect(conditionLineKind({ kind: 'article' })).toBe('material');
    expect(conditionLineKind({ kind: 'leistung', leistungKind: 'arbeit' })).toBe('arbeit');
    expect(conditionLineKind({ kind: 'leistung', leistungKind: 'anfahrt' })).toBe('anfahrt');
    for (const leistungKind of ['pauschale', 'gebuehr', 'fremdleistung'] as const) {
      expect(conditionLineKind({ kind: 'leistung', leistungKind })).toBeNull();
    }
  });
});

describe('savedPriceSource', () => {
  const article = { kind: 'article', id: '96000000-0000-4000-8000-000000000001' } as const;
  test('a source stays while the price is the one it answered', () => {
    expect(savedPriceSource({ kind: 'listenpreis', unitPriceCents: 1234 }, article, 1234)).toEqual({
      kind: 'listenpreis',
      conditionId: null,
    });
    expect(
      savedPriceSource(
        { kind: 'kundenkondition', conditionId: fromVersion2.condition.id, unitPriceCents: 1111 },
        article,
        1111,
      ),
    ).toEqual({ kind: 'kundenkondition', conditionId: fromVersion2.condition.id });
  });

  test('manual stays manual, and a changed price or a missing catalog entry becomes manual', () => {
    expect(savedPriceSource({ kind: 'manuell' }, article, 1234)).toEqual({
      kind: 'manuell',
      conditionId: null,
    });
    expect(savedPriceSource({ kind: 'listenpreis', unitPriceCents: 1234 }, article, 1300)).toEqual({
      kind: 'manuell',
      conditionId: null,
    });
    expect(
      savedPriceSource(
        { kind: 'kundenkondition', conditionId: fromVersion2.condition.id, unitPriceCents: 1111 },
        article,
        1234,
      ),
    ).toEqual({ kind: 'manuell', conditionId: null });
    expect(savedPriceSource({ kind: 'listenpreis', unitPriceCents: 1234 }, null, 1234)).toEqual({
      kind: 'manuell',
      conditionId: null,
    });
  });
});

test('discountText', () => {
  expect(discountText(100)).toBe('10');
  expect(discountText(125)).toBe('12,5');
  expect(discountText(5)).toBe('0,5');
});

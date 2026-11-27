import { describe, expect, test } from 'bun:test';

import { lineAmountCents } from '@/lib/inventory/line-amount';
import {
  conditionLineKind,
  discountText,
  resolveCatalogPrice,
  type DayCondition,
} from './customer-conditions';

/** Version 2 of a customer's conditions with 68,00 € per Monteurstunde; the Leistung priced decides `ownPriceCents`. */
const condition = (fields: Partial<DayCondition> = {}): DayCondition => ({
  id: '98000000-0000-4000-8000-000000000002',
  version: 2,
  validFrom: '2027-01-01',
  discountTenths: { material: 100, arbeit: 50, anfahrt: 0 },
  ownPriceCents: null,
  ...fields,
});
const OWN_HOUR = { ownPriceCents: 6800 };
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
        condition: null,
      },
      { amountCents: 7250, priceQuantity: 1, source: { kind: 'listenpreis' } },
    ],
    [
      "the Leistung's own price beats the list price and takes no discount",
      {
        listPrice: { amountCents: 7250, priceQuantity: 1 },
        lineKind: 'arbeit',
        condition: condition(OWN_HOUR),
      },
      { amountCents: 6800, priceQuantity: 1, source: fromVersion2 },
    ],
    [
      'an own price applies even while the Leistung has no list price',
      { listPrice: null, lineKind: 'arbeit', condition: condition(OWN_HOUR) },
      { amountCents: 6800, priceQuantity: 1, source: fromVersion2 },
    ],
    [
      'a Leistung without an own price takes the discount of its kind',
      {
        listPrice: { amountCents: 7250, priceQuantity: 1 },
        lineKind: 'arbeit',
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
        condition: condition(),
      },
      { amountCents: 4500, priceQuantity: 1, source: { kind: 'listenpreis' } },
    ],
    [
      'a Leistung of another kind (a Pauschale) takes no discount',
      {
        listPrice: { amountCents: 15000, priceQuantity: 1 },
        lineKind: null,
        condition: condition({ discountTenths: { material: 100, arbeit: 100, anfahrt: 100 } }),
      },
      { amountCents: 15000, priceQuantity: 1, source: { kind: 'listenpreis' } },
    ],
    [
      'a discount of 100 % prices at zero',
      {
        listPrice: { amountCents: 1234, priceQuantity: 1 },
        lineKind: 'material',
        condition: condition({ discountTenths: { material: 1000, arbeit: 0, anfahrt: 0 } }),
      },
      { amountCents: 0, priceQuantity: 1, source: fromVersion2 },
    ],
    [
      'neither an own price nor a list price: nothing to resolve',
      { listPrice: null, lineKind: 'arbeit', condition: condition() },
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
      condition: condition({ discountTenths: { material: 50, arbeit: 0, anfahrt: 0 } }),
    });
    expect(resolved?.amountCents).toBe(951);
    expect(lineAmountCents('-0.5', 951, 1)).toBe(-476);
    // 250 pieces at 1654 per 100 = 4135; 2,125 m at 1111 = 2360,875 → 2361.
    expect(lineAmountCents('250', 1654, 100)).toBe(4135);
    expect(lineAmountCents('2.125', 1111, 1)).toBe(2361);
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

test('discountText', () => {
  expect(discountText(100)).toBe('10');
  expect(discountText(125)).toBe('12,5');
  expect(discountText(5)).toBe('0,5');
});

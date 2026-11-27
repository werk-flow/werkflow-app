import { describe, expect, test } from 'bun:test';

import { conditionFieldId, conditionFormOf, parseConditionForm } from './customer-condition-form';
import type { CustomerCondition } from './customer-conditions';

const MONTEURSTUNDE = '97000000-0000-4000-8000-000000000001';
const newest: CustomerCondition = {
  id: '98000000-0000-4000-8000-000000000002',
  version: 2,
  validFrom: '2027-01-01',
  discountTenths: { material: 125, arbeit: 50, anfahrt: 0 },
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
};

describe('the conditions dialog', () => {
  test('a new version starts from the newest one, from today on, and records it unchanged', () => {
    const form = conditionFormOf(newest, '2026-11-27');
    expect(form).toEqual({
      validFrom: '2026-11-27',
      discounts: { material: '12,5', arbeit: '5', anfahrt: '' },
      prices: [{ key: MONTEURSTUNDE, leistungId: MONTEURSTUNDE, price: '68,00' }],
    });
    expect(parseConditionForm(form)).toEqual({
      ok: true,
      input: {
        validFrom: '2026-11-27',
        discountTenths: { material: 125, arbeit: 50, anfahrt: 0 },
        leistungPrices: [{ leistungId: MONTEURSTUNDE, salePriceCents: 6800 }],
      },
    });
  });

  test('a customer without conditions starts empty', () => {
    expect(parseConditionForm(conditionFormOf(null, '2026-11-27'))).toEqual({
      ok: true,
      input: {
        validFrom: '2026-11-27',
        discountTenths: { material: 0, arbeit: 0, anfahrt: 0 },
        leistungPrices: [],
      },
    });
  });

  test('a discount reads with comma, dot or percent sign, up to 100 %', () => {
    const form = conditionFormOf(null, '2026-11-27');
    const parsed = parseConditionForm({
      ...form,
      discounts: { material: '10 %', arbeit: '2.5', anfahrt: '100' },
    });
    expect(parsed.ok && parsed.input.discountTenths).toEqual({ material: 100, arbeit: 25, anfahrt: 1000 });
  });

  test('every field at fault names its sentence at its control', () => {
    const parsed = parseConditionForm({
      validFrom: '',
      discounts: { material: '100,1', arbeit: '-5', anfahrt: '1,25' },
      prices: [
        { key: 'a', leistungId: '', price: '68' },
        { key: 'b', leistungId: MONTEURSTUNDE, price: '' },
        { key: 'c', leistungId: MONTEURSTUNDE, price: '70,00' },
      ],
    });
    const discount =
      'Gib den Rabatt in Prozent von 0 bis 100 an, zum Beispiel 10 oder 12,5, oder lass das Feld leer.';
    expect(parsed).toEqual({
      ok: false,
      errors: {
        [conditionFieldId.validFrom]: 'Wähle den Tag, ab dem die Konditionen gelten.',
        [conditionFieldId.discount('material')]: discount,
        [conditionFieldId.discount('arbeit')]: discount,
        [conditionFieldId.discount('anfahrt')]: discount,
        [conditionFieldId.leistung('a')]: 'Wähle eine Leistung.',
        [conditionFieldId.price('b')]: 'Gib den Preis netto an, zum Beispiel 68,00.',
        [conditionFieldId.leistung('c')]: 'Diese Leistung hat schon einen eigenen Preis.',
      },
    });
  });
});

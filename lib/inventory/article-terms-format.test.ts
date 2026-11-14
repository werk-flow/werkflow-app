import { describe, expect, test } from 'bun:test';

import type { ArticlePriceEntry } from '@/lib/inventory/article-price-terms';
import { articlePriceState, describePack, formatArticlePrice } from './article-terms-format';

describe('article terms read as the office says them', () => {
  test('a price names the base units it is stated for', () => {
    expect(formatArticlePrice(412, 1, 'meter')).toBe('4,12 € je m');
    expect(formatArticlePrice(61000, 100, 'piece')).toBe('610,00 € je 100 Stk');
  });

  test('a pack reads as a sentence, and a supplier selling in the base unit says so', () => {
    expect(describePack({ purchaseUnit: 'roll', packQuantity: 1, baseQuantity: 50 }, 'meter')).toBe(
      '1 Rolle = 50 Meter',
    );
    expect(describePack({ purchaseUnit: 'box', packQuantity: 2, baseQuantity: 0.125 }, 'kilogram')).toBe(
      '2 Karton = 0,125 Kilogramm',
    );
    expect(describePack({ purchaseUnit: null, packQuantity: 1, baseQuantity: 1 }, 'meter')).toBe(
      'Bestellt in Meter',
    );
  });

  test('the price the database marked applies today; others are coming or earlier', () => {
    const price = (validFrom: string, isCurrent: boolean): ArticlePriceEntry => ({
      id: validFrom,
      kind: 'sale',
      unit: 'piece',
      amountCents: 100,
      priceQuantity: 1,
      validFrom,
      origin: 'manual',
      recordedAt: '2026-11-01T08:00:00Z',
      isCurrent,
    });
    expect(articlePriceState(price('2026-11-01', true), '2026-11-13')).toBe('current');
    expect(articlePriceState(price('2026-12-01', false), '2026-11-13')).toBe('upcoming');
    // A price of today replaced by a later recording of the same day is earlier, not current.
    expect(articlePriceState(price('2026-11-13', false), '2026-11-13')).toBe('earlier');
  });
});

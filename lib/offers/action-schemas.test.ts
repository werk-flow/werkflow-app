import { expect, test } from 'bun:test';
import { saveOfferContentSchema } from './action-schemas';

const save = (description: string, count: number) => ({
  offerId: '96000000-0000-4000-8000-000000000001',
  expectedContentVersion: 1,
  attemptKey: '96000000-0000-4000-8000-000000000002',
  sections: [
    {
      title: 'Vorbemerkungen',
      positions: Array.from({ length: count }, () => ({ kind: 'text', name: 'Hinweis', description })),
    },
  ],
});

// A caller without the editor meets the editor's byte limit too: otherwise an
// offer could be saved that the editor then refuses to save again.
test('a content save above the editor byte limit is refused for every caller', () => {
  expect(
    saveOfferContentSchema.safeParse(save('Ausführung nach Herstellerangabe. '.repeat(30), 80)).success,
  ).toBe(true);
  expect(saveOfferContentSchema.safeParse(save('x'.repeat(4000), 240)).success).toBe(false);
});

// A Position's cost is office input with the limits of a price: whole cents
// from zero, per a price quantity a price can have; none is null.
test('a content save takes a cost per a price quantity of a price, and refuses any other', () => {
  const withCost = (cost: unknown) => ({
    ...save('', 0),
    sections: [
      {
        title: 'Montage',
        positions: [
          {
            kind: 'free',
            name: 'Monteurstunde',
            description: '',
            quantity: '1',
            unit: 'hour',
            unitPriceCents: 7250,
            priceQuantity: 1,
            taxRateBasisPoints: 1900,
            source: null,
            cost,
          },
        ],
      },
    ],
  });
  for (const cost of [null, { amountCents: 0, priceQuantity: 1 }, { amountCents: 812, priceQuantity: 100 }]) {
    expect(saveOfferContentSchema.safeParse(withCost(cost)).success).toBe(true);
  }
  for (const cost of [
    { amountCents: -1, priceQuantity: 1 },
    { amountCents: 1.5, priceQuantity: 1 },
    { amountCents: 100, priceQuantity: 3 },
    { amountCents: 100_000_001, priceQuantity: 1 },
  ]) {
    expect(saveOfferContentSchema.safeParse(withCost(cost)).success).toBe(false);
  }
});

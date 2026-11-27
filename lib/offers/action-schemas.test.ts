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

// A Position's cost is whole cents from zero up to a line's bound, per a price
// quantity a price can have; none is null.
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
            priceSource: { kind: 'manuell' },
          },
        ],
      },
    ],
  });
  // Any article price may stand in the cost store: a wholesaler import takes up to 2^31 cents.
  for (const cost of [
    null,
    { amountCents: 0, priceQuantity: 1 },
    { amountCents: 812, priceQuantity: 100 },
    { amountCents: 2_147_483_647, priceQuantity: 1000 },
  ]) {
    expect(saveOfferContentSchema.safeParse(withCost(cost)).success).toBe(true);
  }
  for (const cost of [
    { amountCents: -1, priceQuantity: 1 },
    { amountCents: 1.5, priceQuantity: 1 },
    { amountCents: 100, priceQuantity: 3 },
    { amountCents: 1_000_000_000_001, priceQuantity: 1 },
  ]) {
    expect(saveOfferContentSchema.safeParse(withCost(cost)).success).toBe(false);
  }
});

// A tab opened before costs were saved sends no cost key: its save is refused, so
// it never clears the costs the office stored meanwhile.
test('a content save whose priced Position names no cost is refused, not taken as no cost', () => {
  const position = {
    kind: 'free',
    name: 'Monteurstunde',
    description: '',
    quantity: '1',
    unit: 'hour',
    unitPriceCents: 7250,
    priceQuantity: 1,
    taxRateBasisPoints: 1900,
    source: null,
    priceSource: { kind: 'manuell' },
  };
  const content = (positions: unknown[]) => ({ ...save('', 0), sections: [{ title: 'Montage', positions }] });
  expect(saveOfferContentSchema.safeParse(content([position])).success).toBe(false);
  expect(saveOfferContentSchema.safeParse(content([{ ...position, cost: null }])).success).toBe(true);
});

// Likewise a tab older than price sources sends none: its save is refused, so it
// never turns a source the office's Positionen keep into „manuell“.
test('a content save whose priced Position names no price source is refused', () => {
  const position = {
    kind: 'free',
    name: 'Monteurstunde',
    description: '',
    quantity: '1',
    unit: 'hour',
    unitPriceCents: 6800,
    priceQuantity: 1,
    taxRateBasisPoints: 1900,
    source: { kind: 'leistung', id: '97000000-0000-4000-8000-000000000001' },
    cost: null,
  };
  const content = (positions: unknown[]) => ({ ...save('', 0), sections: [{ title: 'Montage', positions }] });
  const conditionId = '98000000-0000-4000-8000-000000000002';
  expect(saveOfferContentSchema.safeParse(content([position])).success).toBe(false);
  for (const priceSource of [
    { kind: 'manuell' },
    { kind: 'listenpreis', unitPriceCents: 7250 },
    { kind: 'kundenkondition', conditionId, unitPriceCents: 6800 },
  ]) {
    expect(saveOfferContentSchema.safeParse(content([{ ...position, priceSource }])).success).toBe(true);
  }
  for (const priceSource of [
    { kind: 'kundenkondition', unitPriceCents: 6800 },
    { kind: 'kundenkondition', conditionId: 'K-2', unitPriceCents: 6800 },
    { kind: 'listenpreis' },
    { kind: 'listenpreis', unitPriceCents: -1 },
    { kind: 'rabatt', unitPriceCents: 6800 },
  ]) {
    expect(saveOfferContentSchema.safeParse(content([{ ...position, priceSource }])).success).toBe(false);
  }
});

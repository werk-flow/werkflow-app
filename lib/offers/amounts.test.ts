import { describe, expect, test } from 'bun:test';
import { offerAmounts, offerContentArgument } from './amounts';
import type { OfferFreePosition, OfferSection } from './types';

function free(
  name: string,
  quantity: string,
  unitPriceCents: number,
  options: Partial<Pick<OfferFreePosition, 'priceQuantity' | 'taxRateBasisPoints' | 'unit'>> = {},
): OfferFreePosition {
  return {
    kind: 'free',
    name,
    positionType: { kind: 'normal' },
    description: '',
    quantity,
    unit: options.unit ?? 'piece',
    unitPriceCents,
    priceQuantity: options.priceQuantity ?? 1,
    taxRateBasisPoints: options.taxRateBasisPoints ?? 1900,
    source: null,
    cost: null,
    priceSource: { kind: 'manuell' },
  };
}

// The table of cases of an offer's amounts: each priced position by the
// shared line rule, a Titel's subtotal as the sum of its positions, VAT per
// rate on the sum of that rate's positions, and net, VAT and gross.
const INSTALLATION: OfferSection[] = [
  {
    title: 'Heizung',
    positions: [
      free('Gas-Brennwerttherme', '1', 425_000),
      // Three decimals: 2,125 m at 12,49 € is 26,54125 €.
      free('Kupferrohr 15 mm', '2.125', 1249, { unit: 'meter' }),
      // A price per 100: 250 at 18,90 € per 100.
      free('Rohrschellen', '250', 1890, { priceQuantity: 100 }),
      {
        kind: 'text',
        name: 'Hinweis',
        description: 'Die Altanlage bleibt bis zur Inbetriebnahme in Betrieb.',
      },
    ],
  },
  {
    title: 'Nachlass und Zubehör',
    positions: [
      // A negative line: a discount of 150 €.
      free('Nachlass', '-1', 15_000),
      free('Wartungsheft', '1', 2995, { taxRateBasisPoints: 700 }),
    ],
  },
];

describe('offerAmounts', () => {
  test('an installation offer: two Titel, a negative line, three decimals, a price per 100, two VAT rates', () => {
    const amounts = offerAmounts(INSTALLATION);
    expect(amounts.sections).toEqual([
      { netCents: 432_379, positionCents: [425_000, 2654, 4725, null] },
      { netCents: -12_005, positionCents: [-15_000, 2995] },
    ]);
    expect(amounts.taxSubtotals.map(({ basisCents, taxCents }) => ({ basisCents, taxCents }))).toEqual([
      // 19 % on 4.173,79 € is 793,0201 €; 7 % on 29,95 € is 2,0965 €.
      { basisCents: 417_379, taxCents: 79_302 },
      { basisCents: 2995, taxCents: 210 },
    ]);
    expect(amounts.totals).toEqual({ lineNetCents: 420_374, taxCents: 79_512, grossCents: 499_886 });
  });

  test('VAT is computed on the sum of a rate, never per position', () => {
    // Per position 0,095 € would round to 0,10 € twice; on the sum it is 0,19 €.
    const amounts = offerAmounts([
      { title: 'Kleinteile', positions: [free('Dichtung', '1', 50), free('Dichtung', '1', 50)] },
    ]);
    expect(amounts.totals).toEqual({ lineNetCents: 100, taxCents: 19, grossCents: 119 });
  });

  test('a negative half cent rounds away from zero, once per position', () => {
    const amounts = offerAmounts([{ title: 'Gutschrift', positions: [free('Rest', '-0.5', 1)] }]);
    expect(amounts.sections).toEqual([{ netCents: -1, positionCents: [-1] }]);
  });

  test('a Bedarfs- and an Alternativposition take their own amounts and count in no subtotal, total or VAT', () => {
    const amounts = offerAmounts([
      {
        title: 'Heizung',
        positions: [
          free('Gas-Brennwerttherme 25 kW', '1', 425_000),
          // Three decimals at 7 %: 2,125 m at 12,49 € is 26,54125 €, offered if needed.
          {
            ...free('Kupferrohr 15 mm', '2.125', 1249, { unit: 'meter', taxRateBasisPoints: 700 }),
            positionType: { kind: 'bedarf' },
          },
          // Offered instead of 1.1, with a credit of its own: 388,00 € less 150,00 € back.
          {
            ...free('Gas-Brennwerttherme 20 kW', '1', 388_000),
            positionType: { kind: 'alternative', alternativeTo: 1 },
          },
          { ...free('Rücknahme Altgerät', '-1', 15_000), positionType: { kind: 'bedarf' } },
          free('Wartungsheft', '1', 2995, { taxRateBasisPoints: 700 }),
        ],
      },
    ]);
    expect(amounts.sections).toEqual([
      { netCents: 427_995, positionCents: [425_000, 2654, 388_000, -15_000, 2995] },
    ]);
    // 19 % on 4.250,00 € only; 7 % on 29,95 € only (2,0965 €).
    expect(amounts.taxSubtotals.map(({ basisCents, taxCents }) => ({ basisCents, taxCents }))).toEqual([
      { basisCents: 425_000, taxCents: 80_750 },
      { basisCents: 2995, taxCents: 210 },
    ]);
    expect(amounts.totals).toEqual({ lineNetCents: 427_995, taxCents: 80_960, grossCents: 508_955 });
  });

  test('an offer without priced positions totals zero', () => {
    expect(offerAmounts([]).totals).toEqual({ lineNetCents: 0, taxCents: 0, grossCents: 0 });
    const textOnly = offerAmounts([
      { title: 'Vorbemerkung', positions: [{ kind: 'text', name: 'Hinweis', description: '' }] },
    ]);
    expect(textOnly.sections).toEqual([{ netCents: 0, positionCents: [null] }]);
    expect(textOnly.totals.grossCents).toBe(0);
  });
});

// The save stores only content the office's calculation can show again.
test('a content whose line cost exceeds ten billion euros has no save argument', () => {
  const costly = {
    ...free('Pumpe', '100000', 100),
    cost: { amountCents: 100_000_001, priceQuantity: 1 as const },
  };
  expect(offerContentArgument([{ title: 'Heizung', positions: [costly] }])).toBeNull();
  expect(offerContentArgument([{ title: 'Heizung', positions: [{ ...costly, cost: null }] }])).not.toBeNull();
});

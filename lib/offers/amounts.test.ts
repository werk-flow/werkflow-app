import { describe, expect, test } from 'bun:test';
import { offerAmounts, offerContentArgument } from './amounts';
import { offerCalculation } from './calculation';
import type { OfferAdjustment, OfferAdjustmentPosition, OfferFreePosition, OfferSection } from './types';

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

function adjustment(name: string, value: OfferAdjustment): OfferAdjustmentPosition {
  return { kind: 'adjustment', name, description: '', adjustment: value };
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

  test('Bedarfspositionen at the line bound each take their amount, as no VAT basis sums them', () => {
    // 100.000 × 100.000,00 € is ten billion euros, the largest line amount.
    const atBound = {
      ...free('Fernwärmestation', '100000', 10_000_000),
      positionType: { kind: 'bedarf' as const },
    };
    const amounts = offerAmounts([
      { title: 'Optionen', positions: [atBound, atBound, atBound, free('Wartungsheft', '1', 2995)] },
    ]);
    expect(amounts.sections[0]?.positionCents).toEqual([
      1_000_000_000_000, 1_000_000_000_000, 1_000_000_000_000, 2995,
    ]);
    expect(amounts.totals.lineNetCents).toBe(2995);
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

// The table of cases of a Nachlass or Zuschlag: a percentage of the normal
// Positionen it covers, split by VAT rate, each part rounded once half away
// from zero, the parts adding up to its amount, and VAT per rate on the sum
// of that rate's lines and parts.
describe('a Nachlass or Zuschlag', () => {
  test('3 % off a Titel with two VAT rates splits per rate, each part rounded once', () => {
    const amounts = offerAmounts([
      {
        title: 'Heizung',
        positions: [
          free('Gas-Brennwerttherme', '1', 425_000),
          free('Wartungsheft', '1', 2995, { taxRateBasisPoints: 700 }),
          adjustment('Nachlass', { direction: 'rabatt', scope: 'titel', percentHundredths: 300 }),
        ],
      },
    ]);
    // 3 % of 4.250,00 € is 127,50 €; 3 % of 29,95 € is 0,8985 €, rounded to 0,90 €.
    expect(amounts.adjustmentParts).toEqual([
      [
        null,
        null,
        [
          { taxRateBasisPoints: 1900, amountCents: -12_750 },
          { taxRateBasisPoints: 700, amountCents: -90 },
        ],
      ],
    ]);
    expect(amounts.sections).toEqual([{ netCents: 415_155, positionCents: [425_000, 2995, -12_840] }]);
    // 19 % on 4.122,50 € is 783,275 €; 7 % on 29,05 € is 2,0335 €.
    expect(amounts.taxSubtotals.map(({ basisCents, taxCents }) => ({ basisCents, taxCents }))).toEqual([
      { basisCents: 412_250, taxCents: 78_328 },
      { basisCents: 2905, taxCents: 203 },
    ]);
    expect(amounts.totals).toEqual({ lineNetCents: 415_155, taxCents: 78_531, grossCents: 493_686 });
  });

  test('a half cent of a part rounds away from zero, for a Nachlass and a Zuschlag', () => {
    const amounts = offerAmounts([
      {
        title: 'Kleinteile',
        positions: [
          free('Dichtung', '1', 50, { taxRateBasisPoints: 700 }),
          adjustment('Nachlass', { direction: 'rabatt', scope: 'titel', percentHundredths: 100 }),
          adjustment('Zuschlag', { direction: 'zuschlag', scope: 'titel', percentHundredths: 100 }),
        ],
      },
    ]);
    expect(amounts.sections[0]?.positionCents).toEqual([50, -1, 1]);
  });

  test('a Zuschlag of the offer covers every Titel, never a Bedarfs- or Alternativposition', () => {
    const amounts = offerAmounts([
      { title: 'Heizung', positions: [free('Therme', '1', 10_000)] },
      {
        title: 'Zubehör',
        positions: [
          free('Wartungsheft', '1', 5000, { taxRateBasisPoints: 700 }),
          { ...free('Neutralisationsbox', '1', 20_000), positionType: { kind: 'bedarf' } },
          { ...free('Therme klein', '1', 8000), positionType: { kind: 'alternative', alternativeTo: 1 } },
          adjustment('Kleinmengenzuschlag', {
            direction: 'zuschlag',
            scope: 'angebot',
            percentHundredths: 1000,
          }),
        ],
      },
    ]);
    expect(amounts.adjustmentParts[1]?.[3]).toEqual([
      { taxRateBasisPoints: 1900, amountCents: 1000 },
      { taxRateBasisPoints: 700, amountCents: 500 },
    ]);
    // The Zuschlag counts in the Titel it stands in.
    expect(amounts.sections.map((section) => section.netCents)).toEqual([10_000, 6500]);
    expect(amounts.totals.lineNetCents).toBe(16_500);
  });

  test('a Nachlass beside a Bedarfsposition and a negative line covers the normal lines only', () => {
    const amounts = offerAmounts([
      {
        title: 'Bad',
        positions: [
          free('Waschtisch', '1', 10_000),
          // A credit lowers what the Nachlass is a percentage of.
          free('Rücknahme', '-1', 3000),
          { ...free('Spiegelschrank', '1', 40_000), positionType: { kind: 'bedarf' } },
          adjustment('Nachlass', { direction: 'rabatt', scope: 'titel', percentHundredths: 500 }),
        ],
      },
      // Another Titel's lines are no part of a Titel's Nachlass.
      { title: 'Heizung', positions: [free('Therme', '1', 90_000)] },
    ]);
    expect(amounts.sections[0]).toEqual({ netCents: 6650, positionCents: [10_000, -3000, 40_000, -350] });
  });

  test('a Nachlass covers no other Nachlass or Zuschlag', () => {
    const amounts = offerAmounts([
      {
        title: 'Heizung',
        positions: [
          free('Therme', '1', 10_000),
          adjustment('Zuschlag', { direction: 'zuschlag', scope: 'titel', percentHundredths: 2000 }),
          adjustment('Nachlass', { direction: 'rabatt', scope: 'angebot', percentHundredths: 1000 }),
        ],
      },
    ]);
    expect(amounts.sections[0]?.positionCents).toEqual([10_000, 2000, -1000]);
  });

  test('a fixed Nachlass is one part at its own VAT rate', () => {
    const amounts = offerAmounts([
      {
        title: 'Heizung',
        positions: [
          free('Therme', '1', 425_000),
          free('Wartungsheft', '1', 2995, { taxRateBasisPoints: 700 }),
          adjustment('Treuenachlass', {
            direction: 'rabatt',
            scope: 'betrag',
            amountCents: 5000,
            taxRateBasisPoints: 1900,
          }),
        ],
      },
    ]);
    expect(amounts.adjustmentParts[0]?.[2]).toEqual([{ taxRateBasisPoints: 1900, amountCents: -5000 }]);
    expect(amounts.taxSubtotals.map(({ basisCents }) => basisCents)).toEqual([420_000, 2995]);
  });

  test('a part above one line bound is computed, as its lines each kept within it', () => {
    // Two lines of 6 billion euros each at 19 %: 100 % off brings net and VAT to zero.
    const sixBillion = free('Fernwärmeanschluss', '60000', 10_000_000);
    const amounts = offerAmounts([
      {
        title: 'Groß',
        positions: [
          sixBillion,
          sixBillion,
          adjustment('Nachlass', { direction: 'rabatt', scope: 'titel', percentHundredths: 10_000 }),
        ],
      },
    ]);
    expect(amounts.sections[0]?.positionCents[2]).toBe(-1_200_000_000_000);
    expect(amounts.totals).toEqual({ lineNetCents: 0, taxCents: 0, grossCents: 0 });
  });

  test('the order of Nachlässe and Zuschläge never changes a total, near the safe range too', () => {
    // An odd total just below 5 · 10^14 cents at 0 %, then 19 Zuschläge of 100 % of the offer and 19
    // Nachlässe: added one by one, the Zuschläge alone would pass the safe integer range.
    const atBound = free('Fernwärmestation', '100000', 10_000_000, { taxRateBasisPoints: 0 });
    const of = (direction: 'rabatt' | 'zuschlag') =>
      adjustment('Anpassung', { direction, scope: 'angebot', percentHundredths: 10_000 });
    type Direction = 'rabatt' | 'zuschlag';
    const offer = (order: ReadonlyArray<Direction>): OfferSection[] => [
      {
        title: 'Material',
        positions: [
          ...Array.from({ length: 499 }, () => atBound),
          free('Restposten', '1', 999_999_999_999, { taxRateBasisPoints: 0 }),
        ],
      },
      { title: 'Nachlässe', positions: order.map(of) },
    ];
    const grouped = Array.from({ length: 38 }, (_, index): Direction => (index < 19 ? 'zuschlag' : 'rabatt'));
    const alternating = Array.from(
      { length: 38 },
      (_, index): Direction => (index % 2 === 0 ? 'zuschlag' : 'rabatt'),
    );
    expect(offerAmounts(offer(grouped)).totals).toEqual(offerAmounts(offer(alternating)).totals);
    expect(offerAmounts(offer(grouped)).totals.lineNetCents).toBe(499_999_999_999_999);
    // The Titel's subtotal the save stores and „Kalkulation“'s sums add up exactly too.
    for (const order of [grouped, alternating]) {
      const sections = offer(order);
      const amounts = offerAmounts(sections);
      expect(amounts.sections.map((section) => section.netCents)).toEqual([499_999_999_999_999, 0]);
      expect(offerContentArgument(sections)?.sections[1]?.netCents).toBe(0);
      const calculation = offerCalculation(sections, amounts);
      expect(calculation.sections[1]).toMatchObject({ saleCents: 0, adjustmentCents: 0 });
      expect(calculation.offer).toMatchObject({ saleCents: 499_999_999_999_999, adjustmentCents: 0 });
    }
  });

  test('a percentage of nothing is zero and has no part', () => {
    const amounts = offerAmounts([
      {
        title: 'Leer',
        positions: [adjustment('Nachlass', { direction: 'rabatt', scope: 'titel', percentHundredths: 300 })],
      },
    ]);
    expect(amounts.sections).toEqual([{ netCents: 0, positionCents: [0] }]);
    expect(amounts.adjustmentParts).toEqual([[[]]]);
  });

  test('the save stores each one with its amount and its parts', () => {
    const argument = offerContentArgument([
      {
        title: 'Heizung',
        positions: [
          free('Therme', '1', 10_000),
          adjustment('Nachlass', { direction: 'rabatt', scope: 'titel', percentHundredths: 250 }),
        ],
      },
    ]);
    expect(argument?.sections[0]?.positions[1]).toEqual({
      ...adjustment('Nachlass', { direction: 'rabatt', scope: 'titel', percentHundredths: 250 }),
      amountCents: -250,
      taxSplit: [{ taxRateBasisPoints: 1900, amountCents: -250 }],
    });
    expect(argument?.sections[0]?.netCents).toBe(9750);
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

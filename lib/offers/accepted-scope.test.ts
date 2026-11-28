import { describe, expect, test } from 'bun:test';

import { acceptedScopeTotals, offerOptions, type RevisionContent } from './accepted-scope';

// The Auftragsumfang's totals: the revision's normal Positionen, each chosen
// Bedarfsposition in, each chosen Alternativposition in place of the
// Position it names, VAT per rate on the sum of that rate's lines.

type Line = RevisionContent[number]['positions'][number];

function priced(number: string, values: Partial<Extract<Line, { kind: 'free' }>>): Line {
  return {
    number,
    kind: 'free',
    name: `Position ${number}`,
    description: '',
    quantity: '1',
    unit: 'piece',
    unitLabel: 'Stk.',
    unitPriceCents: 10000,
    priceQuantity: 1,
    taxRateBasisPoints: 1900,
    amountCents: 10000,
    ...values,
  };
}

// Titel 1: a boiler, a text line, a Neutralisationsbox if needed (7 %), and a smaller boiler
// instead of 1.1. Titel 2: a credit and 2,5 m pipe priced per 100.
const content: RevisionContent = [
  {
    number: '1',
    title: 'Wärmeerzeuger',
    netCents: 489000,
    positions: [
      priced('1.1', { unitPriceCents: 489000, amountCents: 489000 }),
      { kind: 'text', name: 'Hinweis', description: '' },
      priced('1.2', {
        unitPriceCents: 18500,
        amountCents: 18500,
        taxRateBasisPoints: 700,
        positionType: 'bedarf',
      }),
      priced('1.3', {
        unitPriceCents: 452000,
        amountCents: 452000,
        positionType: 'alternative',
        alternativeTo: '1.1',
      }),
    ],
  },
  {
    number: '2',
    title: 'Montage',
    netCents: 3273,
    positions: [
      priced('2.1', { quantity: '-1', unitPriceCents: 5000, amountCents: -5000 }),
      priced('2.2', {
        quantity: '2.555',
        unit: 'meter',
        unitPriceCents: 323800,
        priceQuantity: 100,
        amountCents: 8273,
      }),
    ],
  },
];

describe('acceptedScopeTotals', () => {
  test.each([
    {
      case: 'no option: the revision as sent',
      chosen: [],
      totals: { netCents: 492273, taxCents: 93532, grossCents: 585805 },
    },
    {
      case: 'the Bedarfsposition at 7 % joins its own VAT rate',
      chosen: ['1.2'],
      totals: { netCents: 510773, taxCents: 94827, grossCents: 605600 },
    },
    {
      case: 'the Alternativposition replaces 1.1',
      chosen: ['1.3'],
      totals: { netCents: 455273, taxCents: 86502, grossCents: 541775 },
    },
    {
      case: 'both options',
      chosen: ['1.3', '1.2'],
      totals: { netCents: 473773, taxCents: 87797, grossCents: 561570 },
    },
  ])('$case', ({ chosen, totals }) => {
    expect(acceptedScopeTotals(content, chosen)).toEqual(totals);
  });

  test('refuses a choice that is not an option of the revision', () => {
    expect(acceptedScopeTotals(content, ['1.1'])).toBeNull();
    expect(acceptedScopeTotals(content, ['9.9'])).toBeNull();
    expect(acceptedScopeTotals(content, ['1.2', '1.2'])).toBeNull();
  });

  test('refuses two Alternativpositionen for one Position', () => {
    const twoAlternatives: RevisionContent = [
      {
        number: '1',
        title: 'Wärmeerzeuger',
        netCents: 489000,
        positions: [
          priced('1.1', { amountCents: 489000 }),
          priced('1.2', { positionType: 'alternative', alternativeTo: '1.1' }),
          priced('1.3', { positionType: 'alternative', alternativeTo: '1.1' }),
        ],
      },
    ];
    expect(acceptedScopeTotals(twoAlternatives, ['1.2', '1.3'])).toBeNull();
  });
});

describe('offerOptions', () => {
  test('lists each Bedarfs- and Alternativposition with what it changes', () => {
    expect(offerOptions(content)).toEqual([
      { number: '1.2', name: 'Position 1.2', amountCents: 18500, kind: 'bedarf' },
      {
        number: '1.3',
        name: 'Position 1.3',
        amountCents: 452000,
        kind: 'alternative',
        replaces: { number: '1.1', name: 'Position 1.1' },
        differenceCents: -37000,
      },
    ]);
  });
});

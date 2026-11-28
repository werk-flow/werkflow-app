import { describe, expect, test } from 'bun:test';
import { fieldScopeFrom } from './field-scope';
import type { FieldScopeOrder } from './types';

// The keys of a type and of every object type inside it.
type DeepKeys<T> = T extends readonly (infer Item)[]
  ? DeepKeys<Item>
  : T extends object
    ? { [Key in keyof T]-?: Key | DeepKeys<T[Key]> }[keyof T]
    : never;
type MoneyWord =
  | 'cent'
  | 'price'
  | 'cost'
  | 'discount'
  | 'total'
  | 'amount'
  | 'margin'
  | 'tax'
  | 'gross'
  | 'net';
type MoneyKey = `${string}${MoneyWord | Capitalize<MoneyWord>}${string}` | MoneyWord;

describe('the field scope of an order', () => {
  test('its type holds no price, cost, discount or total at any depth', () => {
    const moneyKeys: [Extract<DeepKeys<FieldScopeOrder>, MoneyKey>] extends [never] ? true : false = true;
    const line: FieldScopeOrder['sections'][number]['lines'][number] = {
      kind: 'position',
      number: '1.1',
      name: 'Gas-Brennwerttherme',
      description: '',
      quantity: '1.000',
      unitLabel: 'Stk.',
      // @ts-expect-error A scope line has no field for its price.
      amountCents: 489000,
    };
    expect(moneyKeys).toBe(true);
    expect(line.kind).toBe('position');
  });

  test('keeps text, quantity and unit, and leaves out text lines about prices and empty Titel', () => {
    const position = { kind: 'free', description: '', quantity: '12.500', unitLabel: 'm' };
    const text = { kind: 'text', number: null, quantity: null, unitLabel: null, description: '' };
    expect(
      fieldScopeFrom([
        {
          offerNumber: 'ANG-2026-014',
          workKind: 'job',
          sections: [
            {
              number: '1',
              title: 'Wärmeerzeuger',
              lines: [
                { ...position, number: '1.1', name: 'Kupferrohr 15 mm' },
                {
                  ...text,
                  name: 'Bestandsanlage vorher entleeren',
                  description: 'Mit Hausmeister abstimmen.',
                },
                { ...text, name: 'Hinweis', description: 'Alle Preise gelten vier Wochen.' },
              ],
            },
            { number: '2', title: 'Konditionen', lines: [{ ...text, name: 'Zahlbar in 14 Tagen netto' }] },
          ],
        },
      ]),
    ).toEqual([
      {
        offerNumber: 'ANG-2026-014',
        workKind: 'job',
        sections: [
          {
            number: '1',
            title: 'Wärmeerzeuger',
            lines: [
              {
                kind: 'position',
                number: '1.1',
                name: 'Kupferrohr 15 mm',
                description: '',
                quantity: '12.500',
                unitLabel: 'm',
              },
              {
                kind: 'text',
                name: 'Bestandsanlage vorher entleeren',
                description: 'Mit Hausmeister abstimmen.',
              },
            ],
          },
        ],
      },
    ]);
  });

  // One text line in one Titel, as the field reads it: kept, or left out with its empty Titel.
  const shownText = (name: string) =>
    fieldScopeFrom([
      {
        offerNumber: 'ANG-2026-014',
        workKind: 'job',
        sections: [
          {
            number: '1',
            title: 'Montage',
            lines: [{ kind: 'text', number: null, quantity: null, unitLabel: null, name, description: '' }],
          },
        ],
      },
    ])[0]?.sections.length === 1;

  test.each([
    ['Alle Preise gelten vier Wochen', false],
    ['Festpreis inkl. Anfahrt', false],
    ['3 % Skonto bei Zahlung in 10 Tagen', false],
    ['Zuzüglich 19 % MwSt.', false],
    ['Pauschal 450 €', false],
    ['Pauschal 450,-', false],
    ['Anfahrt pauschal 450 Euro', false],
    ['Anfahrt pauschal 450EUR', false],
    ['EUR 450 pauschal', false],
    ['Eurostecker setzen', true],
    ['Monteur-Stundensatz 85,00', false],
    ['Anfahrt 45,00', false],
    ['Entsorgungskosten trägt der Kunde', false],
    ['Heizkostenverteiler montieren', true],
    ['Rohr auf 1,50 m kürzen', true],
    ['Kosten für Entsorgung trägt der Kunde', false],
    ['Heizungssteuerung neu verdrahten', true],
    ['Heizlastberechnung liegt vor', true],
    ['Zugang über den Hof', true],
  ])('the text line „%s“ reaches the field: %p', (name, expected) => {
    expect(shownText(name)).toBe(expected);
  });

  test('empties a Position’s description about money, leaves out a Position named after money and hides a Titel about money', () => {
    const position = { kind: 'free', number: '1.1', quantity: '1.000', unitLabel: 'Stk.' };
    expect(
      fieldScopeFrom([
        {
          offerNumber: 'ANG-2026-014',
          workKind: 'job',
          sections: [
            {
              number: '1',
              title: 'Preise Montage',
              lines: [
                { ...position, name: 'Montage', description: 'Montage inkl. Anfahrt für 450 €' },
                { ...position, number: '1.2', name: 'Anfahrt pauschal 45,-', description: '' },
              ],
            },
          ],
        },
      ])[0]?.sections,
    ).toEqual([
      {
        number: '1',
        title: 'Titel 1',
        lines: [
          {
            kind: 'position',
            number: '1.1',
            name: 'Montage',
            description: '',
            quantity: '1.000',
            unitLabel: 'Stk.',
          },
        ],
      },
    ]);
  });

  test('refuses a malformed answer instead of showing a part of it', () => {
    expect(() => fieldScopeFrom([{ offerNumber: 'ANG-2026-014' }])).toThrow('work_scope_read_failed');
  });
});

import { describe, expect, test } from 'bun:test';
import { fieldScopeFrom, isPriceText } from './field-scope';
import type { FieldScopeOrder } from './types';

// The keys of a type and of every object type inside it.
type DeepKeys<T> = T extends readonly (infer Item)[]
  ? DeepKeys<Item>
  : T extends object
    ? { [Key in keyof T]-?: Key | DeepKeys<T[Key]> }[keyof T]
    : never;
type MoneyWord = 'cent' | 'price' | 'cost' | 'discount' | 'total' | 'amount' | 'margin' | 'tax' | 'gross' | 'net';
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
                { ...text, name: 'Bestandsanlage vorher entleeren', description: 'Mit Hausmeister abstimmen.' },
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
              { kind: 'text', name: 'Bestandsanlage vorher entleeren', description: 'Mit Hausmeister abstimmen.' },
            ],
          },
        ],
      },
    ]);
  });

  test.each([
    ['Alle Preise gelten vier Wochen', true],
    ['Festpreis inkl. Anfahrt', true],
    ['3 % Skonto bei Zahlung in 10 Tagen', true],
    ['Zuzüglich 19 % MwSt.', true],
    ['Pauschal 450 €', true],
    ['Kosten für Entsorgung trägt der Kunde', true],
    ['Heizungssteuerung neu verdrahten', false],
    ['Heizlastberechnung liegt vor', false],
    ['Zugang über den Hof', false],
  ])('„%s“ is about money: %p', (name, expected) => {
    expect(isPriceText({ name, description: '' })).toBe(expected);
  });

  test('refuses a malformed answer instead of showing a part of it', () => {
    expect(() => fieldScopeFrom([{ offerNumber: 'ANG-2026-014' }])).toThrow('work_scope_read_failed');
  });
});

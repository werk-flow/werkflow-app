import { describe, expect, test } from 'bun:test';
import { emptyLine, parseDraftForm, type DraftForm } from '@/lib/invoices/draft-form';
import {
  catalogPositionForm,
  contentFieldId,
  contentFormOf,
  contentLimitSentence,
  emptyPosition,
  liveContentFigures,
  markupSentence,
  parseContentForm,
  withCostOrMarkup,
  withTypedPrice,
  withUnit,
} from './content-form';
import type { OfferSection } from './types';

function textLines(count: number, description: string): OfferSection[] {
  return [
    {
      title: 'Vorbemerkungen',
      positions: Array.from({ length: count }, () => ({
        kind: 'text' as const,
        name: 'Hinweis',
        description,
      })),
    },
  ];
}

// What one save cannot take is said before it is sent: the server refuses
// the same limits (OFFER_CONTENT_LIMITS), and Next caps a Server Action body at 1 MB.
describe('contentLimitSentence', () => {
  test('an offer with long descriptions fits', () => {
    expect(contentLimitSentence(textLines(80, 'Ausführung nach Herstellerangabe. '.repeat(30)))).toBeNull();
  });

  test('ninety descriptions of 4.000 euro signs do not fit, counted in UTF-8 bytes', () => {
    expect(contentLimitSentence(textLines(90, '€'.repeat(4000)))).toContain('Kürze lange Beschreibungen');
  });

  test('a Titel with 501 positions names the limit per Titel', () => {
    expect(contentLimitSentence(textLines(501, ''))).toContain('höchstens 500 Positionen');
  });

  test('101 Titel name the limit of Titel', () => {
    const sections = Array.from({ length: 101 }, () => ({ title: 'Titel', positions: [] }));
    expect(contentLimitSentence(sections)).toContain('höchstens 100 Titel');
  });
});

// One parse for a priced line typed by hand: an offer position and an invoice
// line refuse the same input with the same sentences (parsePricedLine).
test('an offer position and an invoice line refuse an empty priced line with the same sentences', () => {
  const offer = parseContentForm([{ key: 's', title: 'Wartung', positions: [emptyPosition('p', 'free')] }]);
  const invoiceForm: DraftForm = {
    serviceStart: '',
    serviceEnd: '',
    paymentDueDays: '14',
    discountPercent: '',
    discountDays: '',
    orderReference: '',
    buyerReference: '',
    openingText: '',
    closingText: '',
    lines: [emptyLine('l')],
  };
  const invoice = parseDraftForm(invoiceForm);
  const offerSentences = offer.ok ? [] : Object.values(offer.errors);
  expect(offerSentences).toEqual([
    'Gib der Position eine Bezeichnung.',
    'Gib den Netto-Einzelpreis an, zum Beispiel 72,50.',
  ]);
  expect(invoice.ok ? [] : Object.values(invoice.errors)).toEqual(offerSentences);
});

// The totals follow the positions while a Titel still has no name, also one of only spaces.
test('the live amounts stand while a Titel name is blank', () => {
  const position = { ...emptyPosition('p', 'free'), name: 'Wartung', price: '72,50' };
  const figures = liveContentFigures([{ key: 's', title: '   ', positions: [position] }]);
  expect(figures?.amounts.totals.lineNetCents).toBe(7250);
});

// An article or a Leistung becomes a Position with the reader's sale price,
// unit, VAT rate and cost as editable text; the save names the entry, and one
// whose stored unit is outside the list waits for the office's unit.
describe('catalogPositionForm', () => {
  const source = {
    kind: 'article' as const,
    id: '96000000-0000-4000-8000-000000000001',
    number: 'KR-15',
    name: 'Kupferrohr 15 mm',
    archived: false,
  };
  const line = {
    name: 'Kupferrohr 15 mm',
    description: 'Hartkupfer, Stange 5 m',
    unit: 'meter' as const,
    unitPriceCents: 1234,
    priceQuantity: 10 as const,
    taxRateBasisPoints: 700 as const,
    source,
    cost: { amountCents: 812, priceQuantity: 10 as const },
    priceSource: { kind: 'listenpreis' as const },
  };

  test('the reader answer fills one unit of the article at its price and cost per price quantity', () => {
    const position = catalogPositionForm('a', line);
    expect(position).toEqual({
      key: 'a',
      kind: 'free',
      name: 'Kupferrohr 15 mm',
      description: 'Hartkupfer, Stange 5 m',
      quantity: '1',
      unit: 'meter',
      price: '12,34',
      priceQuantity: 10,
      taxRateBasisPoints: 700,
      source,
      cost: '8,12',
      costPriceQuantity: 10,
      markup: '',
      priceSource: { kind: 'listenpreis', unitPriceCents: 1234 },
    });
    const parsed = parseContentForm([{ key: 's', title: 'Material', positions: [position] }]);
    expect(parsed.ok && parsed.sections[0]?.positions[0]).toEqual({
      kind: 'free',
      name: 'Kupferrohr 15 mm',
      description: 'Hartkupfer, Stange 5 m',
      quantity: '1',
      unit: 'meter',
      unitPriceCents: 1234,
      priceQuantity: 10,
      taxRateBasisPoints: 700,
      source: { kind: 'article', id: source.id },
      cost: { amountCents: 812, priceQuantity: 10 },
      priceSource: { kind: 'listenpreis', unitPriceCents: 1234 },
    });
  });

  // The price source the customer's conditions set stays through the editor
  // and the save, until the office types a price or a markup sets one.
  test("a customer's condition stays the source until the office changes the price", () => {
    const condition = { id: '98000000-0000-4000-8000-000000000002', version: 2, validFrom: '2027-01-01' };
    const position = catalogPositionForm('a', {
      ...line,
      unitPriceCents: 1111,
      priceSource: { kind: 'kundenkondition', condition },
    });
    const parse = (form: typeof position) =>
      parseContentForm([{ key: 's', title: 'Material', positions: [form] }]);
    const parsed = parse(position);
    expect(parsed.ok && parsed.sections[0]?.positions[0]).toMatchObject({
      unitPriceCents: 1111,
      priceSource: { kind: 'kundenkondition', conditionId: condition.id, unitPriceCents: 1111 },
    });
    // Typing the same price again is still the office's own price.
    const typed = withTypedPrice(position, '11,11');
    expect([typed.price, typed.priceSource]).toEqual(['11,11', { kind: 'manuell' }]);
    const typedParse = parse(typed);
    expect(typedParse.ok && typedParse.sections[0]?.positions[0]).toMatchObject({
      priceSource: { kind: 'manuell' },
    });
    // A cost alone keeps the source; a markup that sets the price makes it manual.
    expect(withCostOrMarkup(position, { cost: '8,00' }).priceSource).toEqual(position.priceSource);
    const marked = withCostOrMarkup(withCostOrMarkup(position, { cost: '8,00' }), { markup: '50' });
    expect([marked.price, marked.priceSource]).toEqual(['12,00', { kind: 'manuell' }]);
  });

  test('a Leistung is named as the source, and one without a cost rate leaves the cost to the office', () => {
    const leistung = {
      kind: 'leistung' as const,
      id: '97000000-0000-4000-8000-000000000001',
      number: 'L-7',
      name: 'Monteurstunde',
      archived: false,
    };
    const position = catalogPositionForm('l', {
      ...line,
      unit: 'hour',
      priceQuantity: 1,
      source: leistung,
      cost: null,
    });
    expect([position.cost, position.costPriceQuantity]).toEqual(['', 1]);
    const parsed = parseContentForm([{ key: 's', title: 'Montage', positions: [position] }]);
    expect(parsed.ok && parsed.sections[0]?.positions[0]).toMatchObject({
      source: { kind: 'leistung', id: leistung.id },
      cost: null,
    });
  });

  test('a unit outside the list stays empty and the parse asks for one at the unit field', () => {
    const position = catalogPositionForm('a', { ...line, unit: null });
    expect([position.unit, position.cost]).toEqual(['', '']);
    const parsed = parseContentForm([{ key: 's', title: 'Material', positions: [position] }]);
    expect(parsed.ok ? {} : parsed.errors).toEqual({
      [contentFieldId(0, { position: 0, field: 'unit' })]: 'Wähle eine Einheit.',
    });
    expect(liveContentFigures([{ key: 's', title: 'Material', positions: [position] }])).toBeNull();
  });

  test('a stored Position keeps its article and cost through the editor and the next save', () => {
    const [section] = contentFormOf([
      {
        title: 'Material',
        positions: [
          {
            kind: 'free',
            name: 'Kupferrohr 15 mm',
            description: '',
            quantity: '2.500',
            unit: 'meter',
            unitPriceCents: 1234,
            priceQuantity: 10,
            taxRateBasisPoints: 700,
            source: { ...source, archived: true },
            cost: { amountCents: 812, priceQuantity: 100 },
            priceSource: { kind: 'listenpreis', unitPriceCents: 1234 },
          },
        ],
      },
    ]);
    expect(section?.positions[0]?.source).toEqual({ ...source, archived: true });
    const parsed = parseContentForm(section ? [section] : []);
    expect(parsed.ok && parsed.sections[0]?.positions[0]).toMatchObject({
      quantity: '2.5',
      source: { kind: 'article', id: source.id },
      cost: { amountCents: 812, priceQuantity: 100 },
      priceSource: { kind: 'listenpreis', unitPriceCents: 1234 },
    });
  });
});

// A markup on the cost sets the price by the shared line rule and is not kept;
// the price the office types last is what counts.
describe('cost and markup', () => {
  const typed = { ...emptyPosition('p', 'free'), name: 'Pumpe', price: '100,00' };
  const fieldOf = (field: 'cost' | 'markup') => contentFieldId(0, { position: 0, field });
  const parse = (position: typeof typed) =>
    parseContentForm([{ key: 's', title: 'Heizung', positions: [position] }]);

  test('a markup on a cost sets the price, and a changed cost keeps the markup applied', () => {
    const marked = withCostOrMarkup(withCostOrMarkup(typed, { cost: '1,99' }), { markup: '12,5' });
    expect(marked.price).toBe('2,24');
    expect(withCostOrMarkup(marked, { cost: '80' }).price).toBe('90,00');
  });

  test('a cost alone keeps the typed price, and its margin follows', () => {
    const costed = withCostOrMarkup(typed, { cost: '60' });
    expect(costed.price).toBe('100,00');
    const figures = liveContentFigures([{ key: 's', title: 'Heizung', positions: [costed] }]);
    expect(figures?.calculation.offer).toMatchObject({
      costCents: 6000,
      marginCents: 4000,
      marginPermille: 400,
    });
  });

  test('a new unit clears the cost stated in the old one, and an unknown catalog unit brings no cost', () => {
    const costed = withCostOrMarkup(withCostOrMarkup(typed, { cost: '60' }), { markup: '10' });
    expect(withUnit(costed, 'meter')).toMatchObject({ unit: 'meter', cost: '', markup: '', price: '66,00' });
    expect(withUnit(costed, 'piece')).toBe(costed);
  });

  test('a markup whose price would exceed the price limit keeps the price and says so', () => {
    const fitting = { ...typed, quantity: '1000', priceQuantity: 1000 as const, price: '980000,00' };
    const marked = withCostOrMarkup(withCostOrMarkup(fitting, { cost: '950000' }), { markup: '10' });
    expect(marked.price).toBe('980000,00');
    expect(markupSentence(marked)).toBe(
      'Der Preis läge über 1.000.000 € je Preismenge. Der Preis bleibt, wie er ist.',
    );
    expect(
      liveContentFigures([{ key: 's', title: 'Heizung', positions: [marked] }])?.amounts.totals.lineNetCents,
    ).toBe(98_000_000);
  });

  test('a cost still being typed leaves the sale amounts and totals standing', () => {
    const figures = liveContentFigures([
      { key: 's', title: 'Heizung', positions: [{ ...typed, cost: '41,' }] },
    ]);
    expect(figures?.amounts.totals.lineNetCents).toBe(10_000);
    expect(figures?.calculation.offer.withoutCost).toBe(1);
  });

  test('a stored cost above a price limit keeps through the editor and the next save', () => {
    const [section] = contentFormOf([
      {
        title: 'Material',
        positions: [
          {
            kind: 'free',
            name: 'Pressfitting 15 mm',
            description: '',
            quantity: '1000',
            unit: 'piece',
            unitPriceCents: 99_000_000,
            priceQuantity: 1000,
            taxRateBasisPoints: 1900,
            source: null,
            cost: { amountCents: 250_000_000, priceQuantity: 1000 },
            priceSource: { kind: 'manuell' },
          },
        ],
      },
    ]);
    const parsed = parseContentForm(section ? [section] : []);
    expect(parsed.ok && parsed.sections[0]?.positions[0]).toMatchObject({
      cost: { amountCents: 250_000_000, priceQuantity: 1000 },
    });
  });

  test('a cost too high for its line stops the save at its field, and the totals stand meanwhile', () => {
    const position = { ...typed, quantity: '10001', price: '1,00', cost: '1000000' };
    expect(parse(position)).toEqual({
      ok: false,
      errors: {
        [fieldOf('cost')]:
          'Die Kosten dieser Position übersteigen zehn Milliarden Euro. Prüfe Menge und Kosten.',
      },
    });
    const figures = liveContentFigures([{ key: 's', title: 'Heizung', positions: [position] }]);
    expect(figures?.amounts.totals.lineNetCents).toBe(1_000_100);
    expect(figures?.calculation.offer.withoutCost).toBe(1);
  });

  test('a cost that cannot be read stops the save at its field', () => {
    expect(parse({ ...typed, cost: '12,345' })).toEqual({
      ok: false,
      errors: { [fieldOf('cost')]: 'Gib die Kosten netto an, zum Beispiel 48,20, oder lass das Feld leer.' },
    });
  });

  test('a markup that sets no price says why while typing, and never stops the save', () => {
    expect(markupSentence({ ...typed, cost: '10', markup: '1000' })).toBe(
      'Gib den Aufschlag in Prozent von 0 bis 999,9 an, zum Beispiel 25 oder 12,5.',
    );
    expect(markupSentence({ ...typed, markup: '25' })).toBe('Trag zuerst die Kosten ein.');
    expect(markupSentence({ ...typed, cost: '10', markup: '25' })).toBeNull();
    for (const markup of ['1000', '25']) {
      const parsed = parse({ ...typed, markup });
      expect(parsed.ok && parsed.sections[0]?.positions[0]).toMatchObject({
        unitPriceCents: 10_000,
        cost: null,
      });
    }
  });
});

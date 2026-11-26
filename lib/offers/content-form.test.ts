import { describe, expect, test } from 'bun:test';
import { emptyLine, parseDraftForm, type DraftForm } from '@/lib/invoices/draft-form';
import {
  articlePositionForm,
  contentFieldId,
  contentFormOf,
  contentLimitSentence,
  emptyPosition,
  liveContentAmounts,
  parseContentForm,
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
  const amounts = liveContentAmounts([{ key: 's', title: '   ', positions: [position] }]);
  expect(amounts?.totals.lineNetCents).toBe(7250);
});

// An article becomes a Position with the reader's sale price, unit and VAT
// rate as editable text; the save names the article, and an article whose
// stored unit is outside the list waits for the office's unit.
describe('articlePositionForm', () => {
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
  };

  test('the reader answer fills one unit of the article at its price per price quantity', () => {
    const position = articlePositionForm('a', line);
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
    });
  });

  test('a unit outside the list stays empty and the parse asks for one at the unit field', () => {
    const position = articlePositionForm('a', { ...line, unit: null });
    expect(position.unit).toBe('');
    const parsed = parseContentForm([{ key: 's', title: 'Material', positions: [position] }]);
    expect(parsed.ok ? {} : parsed.errors).toEqual({
      [contentFieldId(0, { position: 0, field: 'unit' })]: 'Wähle eine Einheit.',
    });
    expect(liveContentAmounts([{ key: 's', title: 'Material', positions: [position] }])).toBeNull();
  });

  test('a stored Position keeps its article through the editor and the next save', () => {
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
          },
        ],
      },
    ]);
    expect(section?.positions[0]?.source).toEqual({ ...source, archived: true });
    const parsed = parseContentForm(section ? [section] : []);
    expect(parsed.ok && parsed.sections[0]?.positions[0]).toMatchObject({
      quantity: '2.5',
      source: { kind: 'article', id: source.id },
    });
  });
});

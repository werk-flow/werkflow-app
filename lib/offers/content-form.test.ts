import { describe, expect, test } from 'bun:test';
import { emptyLine, parseDraftForm, type DraftForm } from '@/lib/invoices/draft-form';
import { contentLimitSentence, emptyPosition, parseContentForm } from './content-form';
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

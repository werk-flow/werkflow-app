import { expect, test } from 'bun:test';

import type { DocumentPosition } from '@/lib/document-rendering/model';
import { offerDocument, type PrintedOffer } from './document';
import type { OfferCostedSection, OfferPriceSource } from './types';

const values = {
  name: 'Wartung Gastherme',
  description: 'Jährliche Wartung mit Abgasmessung',
  quantity: '1.000',
  unit: 'flat_rate',
  unitPriceCents: 12900,
  priceQuantity: 1,
  taxRateBasisPoints: 1900,
} satisfies Partial<OfferCostedSection['positions'][number]>;
// The price source is the editor's; the document never carries it.
const priceSource: OfferPriceSource = { kind: 'manuell' };
const cost = { amountCents: 8000, priceQuantity: 1 } satisfies { amountCents: number; priceQuantity: 1 };

// The editor's content of one Titel: the same values typed by hand, taken
// from a Leistung and taken from an article, each with its cost.
const costed: OfferCostedSection[] = [
  {
    title: 'Wartung',
    positions: [
      { kind: 'free', ...values, source: null, cost, priceSource },
      {
        kind: 'free',
        ...values,
        source: {
          kind: 'leistung',
          id: crypto.randomUUID(),
          number: 'L-001',
          name: 'Wartung',
          archived: false,
        },
        cost,
        priceSource,
      },
      { kind: 'text', name: 'Hinweis', description: 'Nach Absprache.' },
      {
        kind: 'free',
        ...values,
        source: { kind: 'article', id: crypto.randomUUID(), number: 'A-7', name: 'Wartung', archived: true },
        cost,
        priceSource,
      },
    ],
  },
];

const offer: PrintedOffer = {
  offerNumber: 'ANG-2037-001',
  title: 'Wartung',
  validUntil: '2037-12-20',
  openingText: '',
  closingText: '',
  client: { id: 'client', name: 'WEG Lindenstraße 5' },
  site: null,
  recipient: { id: 'client', name: 'WEG Lindenstraße 5', address: 'Hofweg 1, 10117 Berlin' },
  sections: costed,
};
const letterhead = {
  sender: { name: 'Haustechnik Sonnenberg GmbH', addressLines: [], logo: null },
  footerColumns: [],
  stationery: null,
};

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, entry]) => [key, ...keysOf(entry)]);
}

test('a Position from a Leistung or an article prints as one typed by hand, and no cost reaches the PDF', () => {
  const document = offerDocument(offer, letterhead, { issuedOn: '2037-11-20', revision: 1 });
  const printed = {
    kind: 'standard',
    text: 'Wartung Gastherme',
    description: 'Jährliche Wartung mit Abgasmessung',
    quantity: '1.000',
    unitLabel: 'psch',
    unitPriceCents: 12900,
    priceQuantity: 1,
    amountCents: 12900,
  } satisfies Omit<DocumentPosition, 'number'>;
  expect(document.sections[0]?.positions).toEqual([
    { ...printed, number: '1.1' },
    { ...printed, number: '1.2' },
    { kind: 'text', text: 'Hinweis', description: 'Nach Absprache.' },
    { ...printed, number: '1.3' },
  ]);
  expect(document.sections[0]?.subtotalCents).toBe(3 * 12900);
  expect(document.totals.grossCents).toBe(3 * 12900 + 7353);
  // Built from the editor's costed content, the model still names no cost, margin or source.
  expect(keysOf(document).filter((key) => /cost|margin|source/i.test(key))).toEqual([]);
  expect(JSON.stringify(document)).not.toContain(String(cost.amountCents));
});

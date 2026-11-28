import { expect, test } from 'bun:test';

import { lieferscheinCard } from '@/lib/ui/ki-lieferschein';

const doc = (text: string) => ({ source: 'document', text });
const record = (text: string) => ({ source: 'record_text', text });

const RESULT = {
  hinweis: 'KI-Entwurf: aus dem Dokument gelesen, von niemandem geprüft und nicht gebucht.',
  lieferant: doc('GC Großhandel Stuttgart'),
  lieferscheinnummer: doc('LS-2026-1187'),
  datum: '2026-11-20',
  positionen: [
    {
      nr: 1,
      artikelnummer: doc('GC-15015'),
      ean: '4012345000158',
      beschreibung: doc('Kupferrohr 15 x 1 mm'),
      menge: 4,
      einheit: doc('Stange'),
      packungsinhalt: null,
      abgleich: {
        artikel: { name: record('Kupferrohr 15 mm'), nummer: record('CU-15'), einheit: 'meter' },
        gefundenUeber: 'artikelnummer',
        mengeInBasiseinheit: 20,
        katalog: null,
        hinweise: [],
      },
    },
    {
      nr: 2,
      artikelnummer: doc('GC-99999'),
      ean: null,
      beschreibung: doc('Flexschlauch'),
      menge: 2.5,
      einheit: doc('Bündel'),
      packungsinhalt: null,
      abgleich: {
        artikel: null,
        gefundenUeber: null,
        mengeInBasiseinheit: null,
        katalog: {
          lieferant: record('GC Großhandel'),
          name: record('Flexschlauch 3/8 Zoll'),
          einheit: 'piece',
        },
        hinweise: ['nur_im_katalog', 'einheit_unbekannt'],
      },
    },
  ],
  weggelassenePositionen: 3,
  abgleichGelesen: true,
};

test('a read Lieferschein shows as delivered, its own article with the converted quantity, and each mismatch in German', () => {
  expect(lieferscheinCard(RESULT)).toEqual({
    title: 'Lieferschein LS-2026-1187',
    facts: 'GC Großhandel Stuttgart · 20.11.2026',
    left: 3,
    matched: true,
    lines: [
      {
        nr: 1,
        delivered: '4 Stange · GC-15015 · Kupferrohr 15 x 1 mm',
        match: 'Kupferrohr 15 mm · CU-15 · 20 Meter',
        problems: [],
      },
      {
        nr: 2,
        delivered: '2,5 Bündel · GC-99999 · Flexschlauch',
        match: 'Flexschlauch 3/8 Zoll · GC Großhandel',
        problems: ['Nur im Großhandelskatalog', 'Einheit nicht in der Einheitenliste'],
      },
    ],
  });
});

test('another tool’s detail is no Lieferschein', () => {
  expect(lieferscheinCard({ auftraege: [], gesamt: 0 })).toBeNull();
  expect(lieferscheinCard(undefined)).toBeNull();
});

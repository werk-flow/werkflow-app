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
        fits: true,
      },
      {
        nr: 2,
        delivered: '2,5 Bündel · GC-99999 · Flexschlauch',
        match: 'Flexschlauch 3/8 Zoll · GC Großhandel',
        problems: ['Nur im Großhandelskatalog', 'Einheit nicht in der Einheitenliste'],
        fits: false,
      },
    ],
  });
});

test('another tool’s detail is no Lieferschein', () => {
  expect(lieferscheinCard({ auftraege: [], gesamt: 0 })).toBeNull();
  expect(lieferscheinCard(undefined)).toBeNull();
});

test('a Lieferschein whose count of left-out lines is unknown still shows as a card and says so', () => {
  const card = lieferscheinCard({ ...RESULT, weggelassenePositionen: null });
  expect([card?.title, card?.left]).toEqual(['Lieferschein LS-2026-1187', null]);
});

test('lines the articles could not be matched to never show as fitting', () => {
  const unmatched = {
    ...RESULT,
    abgleichGelesen: false,
    positionen: RESULT.positionen.map((line) => ({ ...line, abgleich: null })),
  };
  expect(lieferscheinCard(unmatched)?.lines.map((line) => [line.fits, line.match])).toEqual([
    [false, null],
    [false, null],
  ]);
});

test('a line shows its printed pack content, and its EAN when it has no article number', () => {
  const [first] = RESULT.positionen;
  const line = { ...first, artikelnummer: null, menge: 2, einheit: doc('VE'), packungsinhalt: 10, nr: 1 };
  expect(lieferscheinCard({ ...RESULT, positionen: [line] })?.lines[0]?.delivered).toBe(
    '2 VE à 10 · EAN 4012345000158 · Kupferrohr 15 x 1 mm',
  );
});

test('a line without a quantity still shows its unit and pack content', () => {
  const [first] = RESULT.positionen;
  const line = { ...first, menge: null, einheit: doc('VE'), packungsinhalt: 10, nr: 1 };
  expect(lieferscheinCard({ ...RESULT, positionen: [line] })?.lines[0]?.delivered).toBe(
    'VE à 10 · GC-15015 · Kupferrohr 15 x 1 mm',
  );
});

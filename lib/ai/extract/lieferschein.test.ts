import { expect, test } from 'bun:test';

import { cappedLieferschein } from '@/lib/ai/extract/lieferschein';
import { AI_EXTRACT_LIMITS } from '@/lib/ai/limits';

const line = {
  artikelnummer: 'GC-15015',
  ean: '4012345000158',
  beschreibung: 'Kupferrohr 15 x 1 mm',
  menge: 4,
  einheit: 'Stange',
  packungsinhalt: null,
};
const answer = {
  lieferant: 'GC Großhandel',
  lieferscheinnummer: 'LS-1187',
  datum: '2026-11-20',
  positionen: [line],
};

test('a Lieferschein of the schema keeps its fields', () => {
  expect(cappedLieferschein(answer)).toEqual({ ...answer, weggelassen: 0 });
});

test('a field that does not fit is none, and a long text is cut by code point', () => {
  const capped = cappedLieferschein({
    lieferant: `${'ü'.repeat(200)}`,
    lieferscheinnummer: 'x'.repeat(41),
    datum: '20.11.2026',
    positionen: [
      {
        artikelnummer: '  ',
        ean: '40123450001X8',
        beschreibung: 'Rohr '.repeat(60),
        menge: -1,
        einheit: 'Stück, aber eigentlich zehn',
        packungsinhalt: 0,
      },
      { ...line, menge: Number.POSITIVE_INFINITY, packungsinhalt: 1_000_001 },
    ],
  });
  expect(capped?.lieferant).toBe('ü'.repeat(120));
  expect(capped?.lieferscheinnummer).toBeNull();
  expect(capped?.datum).toBeNull();
  expect(capped?.positionen[0]).toEqual({
    artikelnummer: null,
    ean: null,
    beschreibung: 'Rohr '.repeat(24).trim(),
    menge: null,
    einheit: null,
    packungsinhalt: null,
  });
  expect(capped?.positionen[1]?.menge).toBeNull();
  expect(capped?.positionen[1]?.packungsinhalt).toBeNull();
});

test('lines past the cap are counted, never dropped silently', () => {
  const lines = Array.from({ length: AI_EXTRACT_LIMITS.maxLines + 7 }, () => line);
  const capped = cappedLieferschein({ ...answer, positionen: lines });
  expect(capped?.positionen).toHaveLength(AI_EXTRACT_LIMITS.maxLines);
  expect(capped?.weggelassen).toBe(7);
});

test('the lines the model reports as left out are counted with those past the cap', () => {
  expect(cappedLieferschein({ ...answer, weiterePositionen: 12 })?.weggelassen).toBe(12);
  const lines = Array.from({ length: AI_EXTRACT_LIMITS.maxLines + 2 }, () => line);
  expect(cappedLieferschein({ ...answer, positionen: lines, weiterePositionen: 3 })?.weggelassen).toBe(5);
  expect(cappedLieferschein({ ...answer, weiterePositionen: -1 })?.weggelassen).toBe(0);
});

test('an answer that is no Lieferschein of the schema reads as nothing', () => {
  expect(cappedLieferschein('Das ist kein Lieferschein.')).toBeNull();
  expect(cappedLieferschein({ ...answer, positionen: 'alle' })).toBeNull();
  expect(cappedLieferschein({ ...answer, positionen: ['Zeile 1'] })).toBeNull();
});

import { describe, expect, test } from 'bun:test';
import { cryptoRandom, fakeText } from './fake-text';
import { isUiString } from './ui-string-catalog';

/** A fixed sequence, so a failure reproduces. */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

describe('fake text keeps the shape', () => {
  test('a letter becomes a letter of the same case, a digit another digit, punctuation and spacing stay', () => {
    const original = 'Erika Müller-Lüdenscheid, Tel. +49 40/123 456-78';
    const fake = fakeText(original, sequence(0.1, 0.7, 0.3, 0.9, 0.5));
    expect(fake).toHaveLength(original.length);
    [...original].forEach((character, index) => {
      const replaced = fake[index] ?? '';
      if (/\p{Lu}/u.test(character)) expect(replaced).toMatch(/^[A-Z]$/u);
      else if (/\p{Ll}/u.test(character)) expect(replaced).toMatch(/^[a-z]$/u);
      else if (/\d/u.test(character)) {
        expect(replaced).toMatch(/^\d$/u);
        expect(replaced).not.toBe(character);
      } else expect(replaced).toBe(character);
    });
  });

  test('a digit never keeps its value, whatever the random source draws', () => {
    for (const draw of [0, 0.1, 0.5, 0.99])
      for (const digit of '0123456789') expect(fakeText(digit, () => draw)).not.toBe(digit);
  });

  test('two redraws of one text differ, so a fake cannot be mapped back', () => {
    const original = 'Musterbau Nord GmbH, Lindenallee 17';
    expect(fakeText(original, cryptoRandom)).not.toBe(fakeText(original, cryptoRandom));
  });
});

describe('a UI string matches only as a whole text', () => {
  const catalog = new Set(['Speichern', 'Neuer Auftrag', '12']);

  test('the whole text, with its whitespace collapsed, matches', () => {
    expect(isUiString(catalog, '  Neuer\n   Auftrag ')).toBe(true);
  });

  test('a UI string inside a longer text does not match', () => {
    expect(isUiString(catalog, 'Speichern bei Erika Musterfrau')).toBe(false);
  });

  test('a text without a letter never matches, even when the catalog holds it', () => {
    expect(isUiString(catalog, '12')).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';
import { contentTooLarge } from './content-form';
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

// A save travels as one Server Action body, which Next caps at 1 MB.
describe('contentTooLarge', () => {
  test('an offer with long descriptions fits', () => {
    expect(contentTooLarge(textLines(80, 'Ausführung nach Herstellerangabe. '.repeat(30)))).toBe(false);
  });

  test('ninety descriptions of 4.000 euro signs do not fit, counted in UTF-8 bytes', () => {
    expect(contentTooLarge(textLines(90, '€'.repeat(4000)))).toBe(true);
  });
});

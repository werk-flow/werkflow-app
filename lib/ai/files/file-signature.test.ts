import { describe, expect, test } from 'bun:test';

import { hasSignatureOf } from './file-signature';

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : part)),
  );

describe('the leading bytes of an uploaded file', () => {
  test('match the signature of the type it was uploaded as', () => {
    expect(hasSignatureOf(bytes('%PDF-1.7\n'), 'application/pdf')).toBe(true);
    expect(hasSignatureOf(bytes([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe(true);
    expect(hasSignatureOf(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png')).toBe(true);
    expect(hasSignatureOf(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '), 'image/webp')).toBe(true);
  });

  test('of another type, too short or of a type outside the list are refused', () => {
    expect(hasSignatureOf(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]), 'image/jpeg')).toBe(false);
    expect(hasSignatureOf(bytes('<html><img src=x>'), 'image/png')).toBe(false);
    expect(hasSignatureOf(bytes('RIFF', [1, 2, 3, 4], 'WAVE'), 'image/webp')).toBe(false);
    expect(hasSignatureOf(bytes([0xff, 0xd8]), 'image/jpeg')).toBe(false);
    expect(hasSignatureOf(bytes('kein PDF'), 'application/pdf')).toBe(false);
    expect(hasSignatureOf(bytes('GIF89a'), 'image/gif')).toBe(false);
  });
});

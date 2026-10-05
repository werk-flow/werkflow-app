import { describe, expect, test } from 'bun:test';
import { firstAvailableName, getCopyDisplayName } from './names';

describe('firstAvailableName', () => {
  test('keeps a free name', () => {
    expect(
      firstAvailableName({
        preferredName: 'Plan.pdf',
        takenNames: new Set(['Other.pdf']),
        keepExtension: true,
      }),
    ).toBe('Plan.pdf');
  });

  test('counts before the extension of a file and compares without case', () => {
    expect(
      firstAvailableName({
        preferredName: 'Plan.pdf',
        takenNames: new Set(['plan.PDF', 'Plan (1).pdf']),
        keepExtension: true,
      }),
    ).toBe('Plan (2).pdf');
  });

  test('counts at the end of a folder name, even with a dot', () => {
    expect(
      firstAvailableName({
        preferredName: 'Bau 1.2',
        takenNames: new Set(['bau 1.2']),
        keepExtension: false,
      }),
    ).toBe('Bau 1.2 (1)');
  });

  test('treats a leading or trailing dot as part of the base name', () => {
    expect(
      firstAvailableName({ preferredName: '.env', takenNames: new Set(['.env']), keepExtension: true }),
    ).toBe('.env (1)');
  });
});

describe('getCopyDisplayName', () => {
  test('prefixes the trimmed name and falls back for a blank one', () => {
    expect(getCopyDisplayName('  Plan.pdf ')).toBe('Kopie von Plan.pdf');
    expect(getCopyDisplayName('   ')).toBe('Kopie von Dokument');
  });
});

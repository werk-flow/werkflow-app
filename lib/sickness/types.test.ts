import { describe, expect, test } from 'bun:test';

import { formatSicknessRange } from './types';

describe('formatSicknessRange (P1-08)', () => {
  test('an open-ended report reads „bis auf Weiteres"', () => {
    expect(
      formatSicknessRange({ startDate: '2026-08-03', endDate: null })
    ).toBe('03.08.2026 – bis auf Weiteres');
  });

  test('a single day renders without a range', () => {
    expect(
      formatSicknessRange({ startDate: '2026-08-03', endDate: '2026-08-03' })
    ).toBe('03.08.2026');
  });

  test('a dated range renders inclusively', () => {
    expect(
      formatSicknessRange({ startDate: '2026-08-03', endDate: '2026-08-05' })
    ).toBe('03.08.2026 – 05.08.2026');
  });
});

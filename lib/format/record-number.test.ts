import { describe, expect, test } from 'bun:test';
import { compareRecordNumbers } from './record-number';

describe('compareRecordNumbers', () => {
  test('orders by year, then by the numeric sequence past three digits', () => {
    const numbers = ['ANL-2026-1000', 'ANL-2026-101', 'ANL-2026-100', 'ANL-2025-1200', 'ANL-2026-099'];
    expect(numbers.sort(compareRecordNumbers)).toEqual([
      'ANL-2025-1200',
      'ANL-2026-099',
      'ANL-2026-100',
      'ANL-2026-101',
      'ANL-2026-1000',
    ]);
  });

  test('sorts a missing number first', () => {
    expect([null, 'AUF-2026-001'].sort(compareRecordNumbers)).toEqual([null, 'AUF-2026-001']);
    expect(['AUF-2026-001', null].sort(compareRecordNumbers)).toEqual([null, 'AUF-2026-001']);
  });
});

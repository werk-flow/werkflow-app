import { describe, expect, test } from 'bun:test';
import { documentDateRange, earlyDeletionRefusal, isDocumentDateInRange } from './retention';

describe('earlyDeletionRefusal', () => {
  test('a filed document is never deleted, also after its period', () => {
    expect(
      earlyDeletionRefusal({ filedAt: '2020-01-01T08:00:00Z', retentionEndsOn: '2030-12-31' }, '2040-01-01'),
    ).toBe('document_filed');
    expect(
      earlyDeletionRefusal({ filedAt: '2020-01-01T08:00:00Z', retentionEndsOn: null }, '2040-01-01'),
    ).toBe('document_filed');
  });

  test('the last day of the period still retains the document, the next day releases it', () => {
    expect(earlyDeletionRefusal({ filedAt: null, retentionEndsOn: '2036-12-31' }, '2036-12-31')).toBe(
      'retention_period_running',
    );
    expect(earlyDeletionRefusal({ filedAt: null, retentionEndsOn: '2036-12-31' }, '2037-01-01')).toBeNull();
  });

  test('a document without a period may go', () => {
    expect(earlyDeletionRefusal({ filedAt: null, retentionEndsOn: null }, '2026-11-07')).toBeNull();
  });
});

describe('documentDateRange', () => {
  test('a paused partial year and a date before 1900 lie outside, 1900-01-01 inside', () => {
    const range = documentDateRange('2026-11-07');
    expect(isDocumentDateInRange('0020-03-14', range)).toBe(false);
    expect(isDocumentDateInRange('1899-12-31', range)).toBe(false);
    expect(isDocumentDateInRange('1900-01-01', range)).toBe(true);
  });

  test('a date up to one year after today lies inside, the day after outside', () => {
    const range = documentDateRange('2026-11-07');
    expect(isDocumentDateInRange('2027-11-07', range)).toBe(true);
    expect(isDocumentDateInRange('2027-11-08', range)).toBe(false);
  });

  test('a year after the 29th of February is the 28th', () => {
    expect(documentDateRange('2028-02-29').latest).toBe('2029-02-28');
  });
});

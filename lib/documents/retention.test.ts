import { describe, expect, test } from 'bun:test';
import { earlyDeletionRefusal } from './retention';

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

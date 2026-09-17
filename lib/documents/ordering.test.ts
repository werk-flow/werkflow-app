import { describe, expect, test } from 'bun:test';
import { newestDocumentsFirst } from './ordering';

describe('contextual document ordering', () => {
  test('merges interleaved batch dates and breaks equal timestamps by id without mutating input', () => {
    const rows = [
      { id: 'c', created_at: '2026-09-08T10:00:00Z' },
      { id: 'a', created_at: '2026-09-06T10:00:00Z' },
      { id: 'b', created_at: '2026-09-08T10:00:00Z' },
      { id: 'd', created_at: '2026-09-07T10:00:00Z' },
    ];
    expect(newestDocumentsFirst(rows).map((row) => row.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(rows.map((row) => row.id)).toEqual(['c', 'a', 'b', 'd']);
  });
});

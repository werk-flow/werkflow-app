import { expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));
const { applyDocumentSearch } = await import('./reads');

/** The PostgREST `or` filter applyDocumentSearch builds for one search text. */
function searchFilter(searchQuery: string): string | null {
  let filter: string | null = null;
  const query = {
    ilike: () => query,
    or: (filters: string) => {
      filter = filters;
      return query;
    },
  };
  applyDocumentSearch(query, searchQuery);
  return filter;
}

test('the link search matches an old number by its literal prefix, never through a wildcard', () => {
  // PostgREST reads `*` in an ilike pattern as `%`, so the prefix is an anchored, escaped regular expression.
  expect(searchFilter(' RE*2019.0_ ')).toBe(
    'display_name.ilike."%RE*2019.0\\_%",original_file_name.ilike."%RE*2019.0\\_%",' +
      'source_reference.imatch."^RE\\\\*2019\\\\.0\\\\_"',
  );
  expect(searchFilter('Ä"\\')).toContain('source_reference.imatch."^Ä\\\\\\"\\\\\\\\"');
  expect(searchFilter('   ')).toBeNull();
});

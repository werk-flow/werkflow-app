import { expect, test } from 'bun:test';

import { parseServiceCaseListQuery } from './list-page';

test('the URL state of the service-case list falls back to the first page of open cases', () => {
  expect(parseServiceCaseListQuery({})).toEqual({ search: '', status: 'open', page: 1 });
  expect(parseServiceCaseListQuery({ q: '  heizung ', status: 'archived', page: 'zwei' })).toEqual({
    search: 'heizung',
    status: 'open',
    page: 1,
  });
  expect(parseServiceCaseListQuery({ status: ['all'] })).toEqual({ search: '', status: 'open', page: 1 });
});

test('a valid URL state reaches the reader unchanged and the search stays bounded', () => {
  expect(parseServiceCaseListQuery({ q: 'SRV-1', status: 'all', page: '3' })).toEqual({
    search: 'SRV-1',
    status: 'all',
    page: 3,
  });
  expect(parseServiceCaseListQuery({ status: 'duplicate' }).status).toBe('duplicate');
  expect(parseServiceCaseListQuery({ q: 'x'.repeat(400) }).search).toHaveLength(250);
});

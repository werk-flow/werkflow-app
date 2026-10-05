import { describe, expect, test } from 'bun:test';

import { parseRequestListQuery, requestCategoriesMatching } from './list-page';

describe('parseRequestListQuery', () => {
  test('defaults to the first page of the active requests', () => {
    expect(parseRequestListQuery({})).toEqual({ status: 'aktiv', search: '', page: 1 });
  });

  test('reads the status scope, the trimmed search and the page from the URL', () => {
    expect(parseRequestListQuery({ status: 'geschlossen', q: '  Heizung ', page: '3' })).toEqual({
      status: 'geschlossen',
      search: 'Heizung',
      page: 3,
    });
  });

  test('falls back on an unknown status, a repeated parameter and an invalid page', () => {
    expect(parseRequestListQuery({ status: 'offen', q: ['a', 'b'], page: '-2' })).toEqual({
      status: 'aktiv',
      search: '',
      page: 1,
    });
  });

  test('bounds the search text', () => {
    expect(parseRequestListQuery({ q: 'x'.repeat(400) }).search).toHaveLength(250);
  });
});

describe('requestCategoriesMatching', () => {
  test('matches the German label without regard to case', () => {
    expect(requestCategoriesMatching('störung')).toEqual(['stoerung_reparatur']);
    expect(requestCategoriesMatching('  WARTUNG ')).toEqual(['wartung']);
  });

  test('returns every category whose label contains the text', () => {
    expect(requestCategoriesMatching('an')).toEqual(['angebotsanfrage', 'garantie_mangel']);
  });

  test('matches nothing for an empty search or an unrelated word', () => {
    expect(requestCategoriesMatching('   ')).toEqual([]);
    expect(requestCategoriesMatching('Müller')).toEqual([]);
  });
});

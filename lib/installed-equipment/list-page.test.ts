import { expect, test } from 'bun:test';

import { parseEquipmentListQuery } from './list-page';

test('the URL state of the equipment list falls back to the first page of active equipment', () => {
  expect(parseEquipmentListQuery({})).toEqual({
    search: '',
    category: 'all',
    includeArchived: false,
    page: 1,
  });
  expect(
    parseEquipmentListQuery({ q: '  kessel  ', category: 'boiler', archived: 'yes', page: '-2' }),
  ).toEqual({ search: 'kessel', category: 'all', includeArchived: false, page: 1 });
  expect(parseEquipmentListQuery({ q: ['a', 'b'], category: ['ventilation'] })).toEqual({
    search: '',
    category: 'all',
    includeArchived: false,
    page: 1,
  });
});

test('a valid URL state reaches the reader unchanged and the search stays bounded', () => {
  expect(parseEquipmentListQuery({ q: 'SER-1', category: 'ventilation', archived: '1', page: '4' })).toEqual({
    search: 'SER-1',
    category: 'ventilation',
    includeArchived: true,
    page: 4,
  });
  expect(parseEquipmentListQuery({ q: 'x'.repeat(400) }).search).toHaveLength(250);
});

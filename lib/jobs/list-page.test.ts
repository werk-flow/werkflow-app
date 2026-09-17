import { describe, expect, test } from 'bun:test';
import { parseJobListQuery } from './list-page';

describe('server list selection', () => {
  test('the default includes every active status and keeps the archive independently closed', () => {
    expect(parseJobListQuery({}, 'active')).toMatchObject({ page: 1, pageSize: 50, status: 'alle', entryType: 'alle', enabled: true });
    expect(parseJobListQuery({}, 'archived').enabled).toBe(false);
    expect(parseJobListQuery({ archived_open: '1' }, 'archived').enabled).toBe(true);
  });
  test('section parameters do not bleed into another list and accept production UUIDs', () => {
    const params = { active_clients: 'b2000001-0000-0000-0000-000000000001,broken', active_q: '  Boiler  ', active_page: '2', archived_q: 'Finished', active_sort: 'title;delete', active_direction: 'sideways' };
    expect(parseJobListQuery(params, 'active')).toMatchObject({ clientIds: ['b2000001-0000-0000-0000-000000000001'], search: 'Boiler', page: 2, sort: 'datum', direction: 'desc' });
    expect(parseJobListQuery(params, 'archived')).toMatchObject({ clientIds: [], search: 'Finished', page: 1 });
  });
  test('server selection resolves hidden sort columns before the page boundary in every section', () => {
    for (const section of ['active', 'parked', 'archived'] as const) {
      expect(parseJobListQuery({}, section, ['nr', 'bezeichnung'])).toMatchObject({ sort: 'nr', direction: 'desc' });
      expect(parseJobListQuery({ [`${section}_sort`]: 'kunde', [`${section}_direction`]: 'asc' }, section, ['bezeichnung', 'datum'])).toMatchObject({ sort: 'bezeichnung', direction: 'asc' });
      expect(parseJobListQuery({ [`${section}_sort`]: 'datum' }, section, ['nr', 'datum']).sort).toBe('datum');
    }
  });
});

import { describe, expect, test } from 'bun:test';

import type { RealtimeChangeEvent } from '@/components/realtime/realtime-provider';
import {
  shouldScheduleRealtimeRefresh,
  normalizeRealtimeDeletion,
} from './events';

function event(
  eventType: RealtimeChangeEvent['eventType'],
  row: Record<string, unknown> | null
): RealtimeChangeEvent {
  return {
    table: 'client_requests',
    eventType,
    new: eventType === 'DELETE' ? null : row,
    old: eventType === 'DELETE' ? row : null,
  };
}

describe('Realtime refresh event handling', () => {
  const clientFilter = (change: RealtimeChangeEvent) => {
    const row = change.new ?? change.old;
    return row?.client_id === 'client-1';
  };

  test('visibility refreshes bypass row filters', () => {
    expect(
      shouldScheduleRealtimeRefresh(
        { table: 'client_requests', eventType: 'UPDATE', new: null, old: null },
        clientFilter
      )
    ).toBe(true);
  });

  test('DELETE events remain filterable from their old row', () => {
    expect(
      shouldScheduleRealtimeRefresh(
        event('DELETE', { client_id: 'client-1' }),
        clientFilter
      )
    ).toBe(true);
  });


});

describe('authorized deletion transport', () => {
  const organization = '10000000-0000-0000-0000-000000000001';
  const row = '20000000-0000-0000-0000-000000000001';
  test('retains the existing minimal DELETE shape without copying extra fields', () => {
    expect(normalizeRealtimeDeletion({ table_name: 'clients', row_id: row, organization_id: organization, secret: 'never forwarded' }, organization))
      .toEqual({ table: 'clients', eventType: 'DELETE', new: null, old: { id: row, organization_id: organization } });
  });
  test('rejects wrong organizations, unknown tables and malformed identities', () => {
    for (const value of [null, {}, { table_name: 'realtime_deletions', row_id: row, organization_id: organization },
      { table_name: 'clients', row_id: row, organization_id: 'foreign' },
      { table_name: 'clients', row_id: 'invalid', organization_id: organization }]) {
      expect(normalizeRealtimeDeletion(value, organization)).toBeNull();
    }
  });
  test('organization-keyed tables and profile invalidations use the same contract', () => {
    for (const table of ['organization_settings', 'organization_qualification_settings', 'profiles'] as const) {
      expect(normalizeRealtimeDeletion({ table_name: table, row_id: organization, organization_id: organization }, organization)?.table).toBe(table);
    }
  });
});

import { describe, expect, test } from 'bun:test';

import type { RealtimeChangeEvent } from '@/components/realtime/realtime-provider';
import {
  coalesceRealtimeEvents,
  shouldScheduleRealtimeRefresh,
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

  test('a matching event cannot be replaced by a later non-matching event', () => {
    const combined = coalesceRealtimeEvents(
      event('UPDATE', { client_id: 'client-1' }),
      event('UPDATE', { client_id: 'client-2' })
    );
    expect(shouldScheduleRealtimeRefresh(combined, clientFilter)).toBe(true);
  });
});

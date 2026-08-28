import type { RealtimeChangeEvent } from '@/components/realtime/realtime-provider';

// The one Realtime debounce boundary (client freshness contract rule 1).
// The provider coalesces per-table events on it, and every consumer-side
// refetch or route refresh schedules on it — never on a shorter, hand-picked
// value: a shorter debounce raced server cache invalidation in P1-16 and
// produced stale reads.
export const REALTIME_DEBOUNCE_MS = 150;

export function isSyntheticRealtimeEvent(event: RealtimeChangeEvent): boolean {
  return event.new === null && event.old === null;
}

export function coalesceRealtimeEvents(
  previous: RealtimeChangeEvent | undefined,
  next: RealtimeChangeEvent
): RealtimeChangeEvent {
  if (!previous) return next;
  return {
    table: next.table,
    eventType: 'UPDATE',
    new: null,
    old: null,
  };
}

export function shouldScheduleRealtimeRefresh(
  event: RealtimeChangeEvent,
  eventFilter?: (event: RealtimeChangeEvent) => boolean
): boolean {
  return isSyntheticRealtimeEvent(event) || !eventFilter || eventFilter(event);
}

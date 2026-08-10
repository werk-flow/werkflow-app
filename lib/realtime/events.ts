import type { RealtimeChangeEvent } from '@/components/realtime/realtime-provider';

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

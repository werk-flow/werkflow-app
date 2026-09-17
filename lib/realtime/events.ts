import type { RealtimeChangeEvent } from '@/components/realtime/realtime-provider';
import { REALTIME_TABLES, type RealtimeTable } from './tables';

function isRealtimeTable(value: unknown): value is RealtimeTable {
  return typeof value === 'string' && REALTIME_TABLES.some(table => table === value);
}

/** Server RLS owns authorization. Reject malformed/misrouted transport records
 * before passing the same minimal DELETE shape to existing invalidation users. */
export function normalizeRealtimeDeletion(value: unknown, activeOrgId: string): RealtimeChangeEvent | null {
  if (!value || typeof value !== 'object' || !('table_name' in value) || !isRealtimeTable(value.table_name)
    || !('organization_id' in value) || value.organization_id !== activeOrgId
    || !('row_id' in value) || typeof value.row_id !== 'string'
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.row_id)) return null;
  return { table: value.table_name, eventType: 'DELETE', new: null,
    old: { id: value.row_id, organization_id: activeOrgId } };
}

// One debounce per feature across its subscribed tables. The provider delivers
// identities immediately; useLiveView and useRealtimeRouterRefresh retain this
// shared guard. Do not shorten it: P1-16 exposed cache invalidation races.
export const REALTIME_DEBOUNCE_MS = 150;

function isSyntheticRealtimeEvent(event: RealtimeChangeEvent): boolean {
  return event.new === null && event.old === null;
}


export function shouldScheduleRealtimeRefresh(
  event: RealtimeChangeEvent,
  eventFilter?: (event: RealtimeChangeEvent) => boolean
): boolean {
  return isSyntheticRealtimeEvent(event) || !eventFilter || eventFilter(event);
}

// Upper bound on how long a sustained event stream may defer a scheduled
// read or route refresh (Step 2, PF-12). The trailing debounce above still
// coalesces bursts; this only caps the deferral so a stream of related
// changes cannot postpone freshness until it pauses.
export const REALTIME_MAX_DEFER_MS = 1_000;

// A focus or visibility return triggers one catch-up only after the tab was
// away at least this long while the socket stayed subscribed (pre-Wave-3 step
// 3, decision D5). Shorter absences (a glance at another window) cannot have
// missed events the open socket did not deliver, and the earlier 50 ms rule
// serialized five to eight reads on every such return. Reconnects keep their
// immediate catch-up regardless of this threshold.
export const REALTIME_FOCUS_CATCH_UP_MIN_ABSENCE_MS = 30_000;

import type { RealtimeChangeEvent } from '@/lib/realtime/events';
import type { RealtimeTable } from '@/lib/realtime/tables';

/**
 * The lead's Realtime signal. A „Projektleitung“ who works on none of a
 * project's jobs reads no row of them, so no event of those jobs, their
 * instructions or Arbeitsnachweise reaches them. The database touches the
 * project's open lead holding instead (migration 20261210120000), and the
 * lead may read their own holding. Only a lead's view listens to it.
 */
export function withLeadSignal(tables: readonly RealtimeTable[], leadView: boolean): RealtimeTable[] {
  return leadView ? [...tables, 'work_leads'] : [...tables];
}

/** Whether the event is the touch of a lead holding, which always calls for a fresh read. */
export function isLeadSignal(event: Pick<RealtimeChangeEvent, 'table'>): boolean {
  return event.table === 'work_leads';
}

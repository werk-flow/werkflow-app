import type { RealtimeTable } from '@/lib/realtime/tables';
import { isCorrectionEventFor, type ClockStateEvent } from './clock-state-events';

/**
 * The published roots behind a job's and a project's time list. Their reads
 * count only the corrections of the record each person holds now
 * (`getTimeEntriesForJob`), so a relink re-reads them too: the office hears
 * `employee_records`, the person their own `employment_target_signals` row.
 */
export const JOB_TIME_LIVE_TABLES = [
  'time_entries',
  'time_sessions',
  'time_segments',
  'time_correction_requests',
  'employee_records',
  'employment_target_signals',
] as const satisfies readonly RealtimeTable[];

/** Approvals can introduce participants; other request edits use the clock's person filter. */
export function isJobTimeEventRelevant(event: ClockStateEvent, participantIds: readonly string[]): boolean {
  if (event.table !== 'time_correction_requests' || participantIds.length === 0) return true;
  const status = event.new?.status;
  // Requests name no jobs, so an approval may add a first participant's time.
  // A missing new status cannot rule out that approval, even if old has one.
  if (status === undefined || status === 'approved') return true;
  return isCorrectionEventFor(event, participantIds);
}

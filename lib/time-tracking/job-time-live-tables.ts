import type { RealtimeTable } from '@/lib/realtime/tables';

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
  'employee_records',
  'employment_target_signals',
] as const satisfies readonly RealtimeTable[];

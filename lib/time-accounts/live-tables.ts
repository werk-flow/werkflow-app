import type { RealtimeTable } from '@/lib/realtime/tables';

/**
 * The published roots behind the period list. Every period RPC, including a
 * finding decision, bumps `time_periods`; export generation writes
 * `payroll_exports`.
 */
export const TIME_PERIOD_LIST_LIVE_TABLES = [
  'time_periods',
  'payroll_exports',
] as const satisfies readonly RealtimeTable[];

/**
 * The period detail also shows the sessions that still run in the period,
 * because they block the close: a clock-out elsewhere must lift the block.
 */
export const TIME_PERIOD_DETAIL_LIVE_TABLES = [
  ...TIME_PERIOD_LIST_LIVE_TABLES,
  'time_sessions',
] as const satisfies readonly RealtimeTable[];

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
 * Its Berufsschule minutes are read live from `school_days`.
 */
export const TIME_PERIOD_DETAIL_LIVE_TABLES = [
  ...TIME_PERIOD_LIST_LIVE_TABLES,
  'time_sessions',
  'school_days',
] as const satisfies readonly RealtimeTable[];

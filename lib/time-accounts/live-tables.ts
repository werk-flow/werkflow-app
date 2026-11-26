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
 * The published roots behind each person's Berufsschule minutes in the period
 * review (lib/time-accounts/period-school-minutes.ts), which are read live,
 * not stored: the school days, every other absence and target source, and the
 * absence policy.
 */
const PERIOD_SCHOOL_MINUTE_LIVE_TABLES = [
  'school_days',
  'vacation_requests',
  'sickness_reports',
  'work_schedules',
  'employment_conditions',
  'employee_records',
  'organization_settings',
  'organization_closure_days',
  'time_account_policies',
  'time_account_policy_assignments',
] as const satisfies readonly RealtimeTable[];

/**
 * The period detail also shows the sessions that still run in the period,
 * because they block the close: a clock-out elsewhere must lift the block.
 */
export const TIME_PERIOD_DETAIL_LIVE_TABLES = [
  ...TIME_PERIOD_LIST_LIVE_TABLES,
  'time_sessions',
  ...PERIOD_SCHOOL_MINUTE_LIVE_TABLES,
] as const satisfies readonly RealtimeTable[];

/**
 * The published roots behind Zeiterfassung → Regeln & Export. A new policy
 * version bumps its `time_account_policies` row; an opening-date correction
 * and an approved adjustment bump `time_accounts`; a closed period locks
 * opening dates. Two reads stay without a refresh: the payroll mapping is not
 * published, and a table saved from an older version is refused with
 * `stale_version` (werk-flow/werkflow-planning#360); the suggested start date
 * follows the earliest time record, and clock events would re-read the page
 * on every punch for a suggestion.
 */
export const TIME_ACCOUNT_SETTINGS_LIVE_TABLES = [
  'time_account_policies',
  'time_account_policy_assignments',
  'time_accounts',
  'time_account_adjustment_requests',
  'time_periods',
  'employee_records',
] as const satisfies readonly RealtimeTable[];

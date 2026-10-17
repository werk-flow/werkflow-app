import { formatBerlin } from '@/lib/utils';

export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? '−' : minutes > 0 ? '+' : '';
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `${sign}${hours}:${String(remainder).padStart(2, '0')} Std.`;
}

/** September 2026: the month a period starting on `startDate` covers. */
export function formatPeriod(startDate: string): string {
  return formatBerlin(startDate, 'monthYear');
}

export const PERIOD_STATE_LABELS: Readonly<Record<TimePeriodState, string>> = {
  prepared: 'Vorbereitet',
  closed: 'Abgeschlossen',
  reopened: 'Wieder geöffnet',
};

/** The badge color of a period state: an open period waits for its close, a closed one is done. */
export const PERIOD_STATE_BADGE_VARIANTS: Readonly<Record<TimePeriodState, 'warning' | 'success'>> = {
  prepared: 'warning',
  closed: 'success',
  reopened: 'warning',
};

export const FINDING_LABELS: Readonly<Record<TimeFindingKind, string>> = {
  missing_policy: 'Arbeitszeitregel fehlt',
  missing_opening_balance: 'Zeitkonto fehlt',
  missing_schedule: 'Arbeitsplan fehlt',
  open_session: 'Laufende Zeiterfassung',
  recovery_session: 'Zeiterfassung muss geklärt werden',
  missing_clock: 'Fehlende Buchung',
  overlap: 'Überlappende Zeiten',
  pending_correction: 'Offene Zeitkorrektur',
  absence_conflict: 'Abwesenheitskonflikt',
  unallocated_time: 'Zeit ohne Zuordnung',
  positive_overtime: 'Positive Mehrarbeit',
  stale_calculation: 'Berechnung ist veraltet',
  break_duration: 'Pausenregel prüfen',
  daily_duration: 'Tagesarbeitszeit prüfen',
  rest_duration: 'Ruhezeit prüfen',
  night_work: 'Nachtarbeit',
  sunday_work: 'Sonntagsarbeit',
  public_holiday_work: 'Feiertagsarbeit',
};

export const FINDING_DECISION_LABELS: Readonly<Record<TimeFindingDecision, string>> = {
  acknowledged: 'Bestätigt',
  approved: 'Freigegeben',
  rejected: 'Abgelehnt',
};

export const PAYROLL_EXPORT_STATE_LABELS: Readonly<Record<PayrollExportState, string>> = {
  requested: 'Angefordert',
  generating: 'Wird erstellt',
  ready: 'Bereit',
  failed: 'Fehlgeschlagen',
  superseded: 'Ersetzt',
};
import type { Database } from '@/lib/supabase/database.types';

export type TimePeriodState = Database['public']['Enums']['time_period_state'];
export type TimeFindingKind = Database['public']['Enums']['time_period_finding_kind'];
export type TimeFindingDecision = Database['public']['Enums']['time_period_finding_decision'];
export type PayrollExportState = Database['public']['Enums']['payroll_export_state'];

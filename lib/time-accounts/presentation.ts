export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? "−" : minutes > 0 ? "+" : "";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `${sign}${hours}:${String(remainder).padStart(2, "0")} Std.`;
}

export function formatPeriod(startDate: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(`${startDate}T12:00:00.000Z`));
}

export function todayBerlin(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
  }).format(new Date());
}

export const PERIOD_STATE_LABELS: Record<TimePeriodState, string> = {
  prepared: "Vorbereitet",
  closed: "Abgeschlossen",
  reopened: "Wieder geöffnet",
};

export const FINDING_LABELS: Record<TimeFindingKind, string> = {
  missing_policy: "Arbeitszeitregel fehlt",
  missing_opening_balance: "Zeitkonto fehlt",
  missing_schedule: "Arbeitsplan fehlt",
  open_session: "Laufende Zeiterfassung",
  recovery_session: "Zeiterfassung muss geklärt werden",
  missing_clock: "Fehlende Buchung",
  overlap: "Überlappende Zeiten",
  pending_correction: "Offene Zeitkorrektur",
  absence_conflict: "Abwesenheitskonflikt",
  unallocated_time: "Zeit ohne Zuordnung",
  positive_overtime: "Positive Mehrarbeit",
  stale_calculation: "Berechnung ist veraltet",
  break_duration: "Pausenregel prüfen",
  daily_duration: "Tagesarbeitszeit prüfen",
  rest_duration: "Ruhezeit prüfen",
  night_work: "Nachtarbeit",
  sunday_work: "Sonntagsarbeit",
  public_holiday_work: "Feiertagsarbeit",
};

export const FINDING_DECISION_LABELS: Record<TimeFindingDecision, string> = {
  acknowledged: "Bestätigt",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
};

export const PAYROLL_EXPORT_STATE_LABELS: Record<PayrollExportState, string> = {
  requested: "Angefordert",
  generating: "Wird erstellt",
  ready: "Bereit",
  failed: "Fehlgeschlagen",
  superseded: "Ersetzt",
};
import type { Database } from "@/lib/supabase/database.types";

type TimePeriodState = Database["public"]["Enums"]["time_period_state"];
type TimeFindingKind = Database["public"]["Enums"]["time_period_finding_kind"];
type TimeFindingDecision =
  Database["public"]["Enums"]["time_period_finding_decision"];
type PayrollExportState = Database["public"]["Enums"]["payroll_export_state"];

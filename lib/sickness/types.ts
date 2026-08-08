import type { Database } from '@/lib/supabase/database.types';
import type { VacationDayPortion } from '@/lib/vacation/types';

// ============================================
// Database Row Aliases
// ============================================

export type SicknessReportRow =
  Database['public']['Tables']['sickness_reports']['Row'];
export type SicknessReportEventRow =
  Database['public']['Tables']['sickness_report_events']['Row'];

// Text columns with CHECK constraints; keep these unions in sync with the
// database (migration add_sickness_reports).
//
// A sickness report is a REPORTED FACT, not a request: there is no approval
// lifecycle. 'reported' is effective immediately; 'cancelled' is the
// recorded-in-error correction. Everything else (end date set, dates changed)
// is a correction on the same row, traceable through sickness_report_events.
export type SicknessReportStatus = 'reported' | 'cancelled';

// Neutral operational absence-type vocabulary (owner decision, 2026-08-08).
// These are labels for planning and paperwork, never legal categories, and no
// field anywhere may invite diagnosis detail.
export type SicknessAbsenceType = 'krankheit' | 'kind_krank' | 'sonstige';

export type SicknessEvidenceStatus = 'not_required' | 'pending' | 'received';

export const SICKNESS_TYPE_LABELS: Record<SicknessAbsenceType, string> = {
  krankheit: 'Krankheit',
  kind_krank: 'Kind krank',
  sonstige: 'Sonstige Abwesenheit',
};

export const SICKNESS_STATUS_LABELS: Record<SicknessReportStatus, string> = {
  reported: 'Gemeldet',
  cancelled: 'Storniert',
};

export const SICKNESS_EVIDENCE_LABELS: Record<SicknessEvidenceStatus, string> =
  {
    not_required: 'Kein Nachweis erforderlich',
    pending: 'Nachweis ausstehend',
    received: 'Nachweis erhalten',
  };

// Centralized German error copy for every sickness action result (AGENTS.md:
// keep UI text centralized where practical). Both the employee section and
// the manager section render from this one map.
export const SICKNESS_ERROR_MESSAGES: Record<string, string> = {
  invalid_dates: 'Bitte gib gültige Daten an.',
  invalid_range: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
  invalid_type: 'Bitte wähle eine Art der Abwesenheit aus.',
  range_too_long:
    'Eine Meldung kann höchstens ein Jahr umfassen. Bitte wende dich an dein Büro.',
  start_too_far_past:
    'Das Startdatum liegt zu weit in der Vergangenheit. Bitte wende dich an dein Büro.',
  start_too_far_future: 'Das Startdatum liegt zu weit in der Zukunft.',
  invalid_portion: 'Bitte wähle Ganztägig oder Halbtägig aus.',
  half_day_needs_single_day:
    'Ein halber Tag gilt nur für einen einzelnen Tag mit Enddatum.',
  overlap_conflict:
    'Für diesen Zeitraum ist bereits eine Krankmeldung erfasst.',
  no_employee_record:
    'Zu deinem Zugang wurde keine Personalakte gefunden. Bitte wende dich an dein Büro.',
  not_authenticated: 'Bitte melde dich erneut an.',
  not_a_member: 'Du gehörst dieser Organisation nicht mehr an.',
  not_authorized: 'Du darfst diese Meldung nicht ändern.',
  report_not_active: 'Die Meldung ist nicht mehr aktiv.',
  not_found: 'Die Meldung wurde nicht gefunden.',
  reason_required: 'Bitte gib einen Grund an.',
  invalid_evidence_state: 'Der Nachweis-Status ist ungültig.',
  insert_failed: 'Die Meldung konnte nicht gespeichert werden.',
  update_failed: 'Die Meldung konnte nicht gespeichert werden.',
  load_failed: 'Die Daten konnten nicht geladen werden.',
  unexpected_error: 'Die Meldung konnte nicht gespeichert werden.',
};

// ============================================
// Application-Level Type (camelCase)
// ============================================

export type SicknessReport = {
  id: string;
  organizationId: string;
  employeeRecordId: string;
  absenceType: SicknessAbsenceType;
  startDate: string;
  /** null = open-ended („bis auf Weiteres"). */
  endDate: string | null;
  dayPortion: VacationDayPortion;
  status: SicknessReportStatus;
  evidenceRequired: boolean;
  evidenceStatus: SicknessEvidenceStatus;
  reportedBy: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toSicknessReport(row: SicknessReportRow): SicknessReport {
  return {
    id: row.id,
    organizationId: row.organization_id,
    employeeRecordId: row.employee_record_id,
    absenceType: row.absence_type as SicknessAbsenceType,
    startDate: row.start_date,
    endDate: row.end_date,
    dayPortion: row.day_portion as VacationDayPortion,
    status: row.status as SicknessReportStatus,
    evidenceRequired: row.evidence_required,
    evidenceStatus: row.evidence_status as SicknessEvidenceStatus,
    reportedBy: row.reported_by,
    cancelledBy: row.cancelled_by,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Range text for aria-labels and list rows, honest about open-ended reports:
 * „05.03.2026 – bis auf Weiteres" / „05.03.2026 – 07.03.2026" / „05.03.2026".
 */
export function formatSicknessRange(report: {
  startDate: string;
  endDate: string | null;
}): string {
  const start = formatIsoDateGerman(report.startDate);
  if (report.endDate === null) return `${start} – bis auf Weiteres`;
  if (report.endDate === report.startDate) return start;
  return `${start} – ${formatIsoDateGerman(report.endDate)}`;
}

function formatIsoDateGerman(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

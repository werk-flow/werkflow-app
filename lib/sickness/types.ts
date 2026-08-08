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

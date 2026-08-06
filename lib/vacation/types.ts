import type { Database } from '@/lib/supabase/database.types';

// ============================================
// Database Row Aliases
// ============================================

export type VacationRequestRow =
  Database['public']['Tables']['vacation_requests']['Row'];
export type VacationRequestEventRow =
  Database['public']['Tables']['vacation_request_events']['Row'];

// status and day_portion are text columns with CHECK constraints; keep these
// unions in sync with the database (migration add_vacation_requests).
export type VacationRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'withdrawn'
  | 'cancelled';

export type VacationDayPortion = 'full' | 'half_day';

export const VACATION_STATUS_LABELS: Record<VacationRequestStatus, string> = {
  pending: 'Offen',
  approved: 'Genehmigt',
  rejected: 'Abgelehnt',
  withdrawn: 'Zurückgezogen',
  cancelled: 'Storniert',
};

export const VACATION_PORTION_LABELS: Record<VacationDayPortion, string> = {
  full: 'Ganztägig',
  half_day: 'Halbtägig',
};

// ============================================
// Application-Level Types (camelCase)
// ============================================

export type VacationRequest = {
  id: string;
  organizationId: string;
  employeeRecordId: string;
  requestedBy: string | null;
  startDate: string;
  endDate: string;
  dayPortion: VacationDayPortion;
  status: VacationRequestStatus;
  comment: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  /** Entitlement days consumed per vacation year, snapshotted at approval. */
  approvedDaysByYear: Record<string, number> | null;
  createdAt: string;
  updatedAt: string;
};

export function toVacationRequest(row: VacationRequestRow): VacationRequest {
  return {
    id: row.id,
    organizationId: row.organization_id,
    employeeRecordId: row.employee_record_id,
    requestedBy: row.requested_by,
    startDate: row.start_date,
    endDate: row.end_date,
    dayPortion: row.day_portion as VacationDayPortion,
    status: row.status as VacationRequestStatus,
    comment: row.comment,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionComment: row.decision_comment,
    cancelledBy: row.cancelled_by,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    approvedDaysByYear: parseApprovedDaysByYear(row.approved_days_by_year),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseApprovedDaysByYear(
  value: unknown
): Record<string, number> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const result: Record<string, number> = {};
  for (const [year, days] of Object.entries(value as Record<string, unknown>)) {
    if (typeof days === 'number' && Number.isFinite(days)) {
      result[year] = days;
    }
  }
  return result;
}

/** Sum of all snapshotted consumed days of one request. */
export function sumApprovedDays(request: VacationRequest): number {
  if (!request.approvedDaysByYear) return 0;
  return Object.values(request.approvedDaysByYear).reduce(
    (total, days) => total + days,
    0
  );
}

import type { Database } from '@/lib/supabase/database.types';

// ============================================
// Database Row Aliases
// ============================================

export type EmployeeRecordRow =
  Database['public']['Tables']['employee_records']['Row'];
export type EmploymentConditionRow =
  Database['public']['Tables']['employment_conditions']['Row'];
export type EmployeeRecordEventRow =
  Database['public']['Tables']['employee_record_events']['Row'];

// employment_type is a text column with a CHECK constraint; keep this union in
// sync with the database constraint (migration add_employee_records_and_conditions).
export type EmploymentType =
  | 'vollzeit'
  | 'teilzeit'
  | 'ausbildung'
  | 'minijob'
  | 'sonstiges';

export const EMPLOYMENT_TYPES: EmploymentType[] = [
  'vollzeit',
  'teilzeit',
  'ausbildung',
  'minijob',
  'sonstiges',
];

// ============================================
// Application-Level Types (camelCase)
// ============================================

export type EmployeeRecord = {
  id: string;
  organizationId: string;
  userId: string | null;
  inviteId: string | null;
  employeeNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  privateEmail: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  entryDate: string | null;
  exitDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmploymentCondition = {
  id: string;
  organizationId: string;
  employeeRecordId: string;
  validFrom: string;
  employmentType: EmploymentType;
  weeklyHours: number | null;
  vacationDaysPerYear: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeRecordEvent = {
  id: string;
  organizationId: string;
  employeeRecordId: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
};

export function toEmployeeRecord(row: EmployeeRecordRow): EmployeeRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    inviteId: row.invite_id,
    employeeNumber: row.employee_number,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    privateEmail: row.private_email,
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    entryDate: row.entry_date,
    exitDate: row.exit_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toEmploymentCondition(
  row: EmploymentConditionRow
): EmploymentCondition {
  return {
    id: row.id,
    organizationId: row.organization_id,
    employeeRecordId: row.employee_record_id,
    validFrom: row.valid_from,
    employmentType: row.employment_type as EmploymentType,
    weeklyHours: row.weekly_hours,
    vacationDaysPerYear: row.vacation_days_per_year,
    note: row.note,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toEmployeeRecordEvent(
  row: EmployeeRecordEventRow
): EmployeeRecordEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    employeeRecordId: row.employee_record_id,
    eventType: row.event_type,
    eventPayload: (row.event_payload ?? {}) as Record<string, unknown>,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// ============================================
// Derived States (owner-approved vocabulary, P1-03)
// ============================================

// Employment dimension: derived from entry/exit dates, never stored, so the
// state can not drift out of sync with the dates that define it.
export type EmploymentState = 'aktiv' | 'geplant' | 'ausgeschieden';

// Access dimension: whether the person can sign in to WerkFlow. Orthogonal to
// the employment dimension (an exited person may still have a login until
// offboarding, P1-33, revokes it).
export type AccessState = 'mit_zugang' | 'eingeladen' | 'ohne_zugang';

export const EMPLOYMENT_STATE_LABELS: Record<EmploymentState, string> = {
  aktiv: 'Aktiv',
  geplant: 'Geplant',
  ausgeschieden: 'Ausgeschieden',
};

export const ACCESS_STATE_LABELS: Record<AccessState, string> = {
  mit_zugang: 'Mit Zugang',
  eingeladen: 'Eingeladen',
  ohne_zugang: 'Ohne Zugang',
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  vollzeit: 'Vollzeit',
  teilzeit: 'Teilzeit',
  ausbildung: 'Ausbildung',
  minijob: 'Minijob',
  sonstiges: 'Sonstiges',
};

// Business dates are Europe/Berlin dates regardless of where the code runs:
// the server (UTC on Vercel) and every browser must agree on "today" or
// derived states flip around midnight. sv-SE formats as YYYY-MM-DD.
const BERLIN_DATE_FORMATTER = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function toBusinessIsoDate(date: Date): string {
  return BERLIN_DATE_FORMATTER.format(date);
}

export function getBusinessTodayIso(): string {
  return toBusinessIsoDate(new Date());
}

export function getEmploymentState(
  record: Pick<EmployeeRecord, 'entryDate' | 'exitDate'>,
  today: Date = new Date()
): EmploymentState {
  const todayIso = toBusinessIsoDate(today);
  // A person counts as exited from their exit date on — a member removed today
  // must immediately read as ausgeschieden, not tomorrow.
  if (record.exitDate && record.exitDate <= todayIso) return 'ausgeschieden';
  if (record.entryDate && record.entryDate > todayIso) return 'geplant';
  return 'aktiv';
}

export function getAccessState(
  record: Pick<EmployeeRecord, 'userId' | 'inviteId'>,
  hasPendingInvite: boolean
): AccessState {
  if (record.userId) return 'mit_zugang';
  if (record.inviteId && hasPendingInvite) return 'eingeladen';
  return 'ohne_zugang';
}

// The condition effective on a date is the version with the greatest
// valid_from on or before that date (see the time-tracking contract: historical
// time must use the conditions effective on that date; P1-04 is the first consumer).
export function getEffectiveCondition(
  conditions: EmploymentCondition[],
  onDate: Date = new Date()
): EmploymentCondition | null {
  const dateIso = toBusinessIsoDate(onDate);
  const applicable = conditions
    .filter((condition) => condition.validFrom <= dateIso)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  return applicable[0] ?? null;
}

export function formatEmployeeRecordName(
  record: Pick<EmployeeRecord, 'firstName' | 'lastName'>,
  profileName?: string | null
): string {
  if (profileName) return profileName;
  return (
    [record.firstName, record.lastName].filter(Boolean).join(' ') || 'Unbekannt'
  );
}

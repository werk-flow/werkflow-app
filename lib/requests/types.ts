import type { ActionResult } from '@/lib/action-result';
import type { QualificationWarningResult } from '@/lib/jobs/types';
import type { PlanningWarningFailure } from '@/lib/planning/conflict-acknowledgement';
import type { Database } from '@/lib/supabase/database.types';
import { jsonRecordOrEmpty } from '@/lib/supabase/json';

// ============================================
// Database Row Aliases
// ============================================

export type ClientRequestRow = Database['public']['Tables']['client_requests']['Row'];
export type ClientRequestEventRow = Database['public']['Tables']['client_request_events']['Row'];

export type RequestStatus = Database['public']['Enums']['request_status'];
export type RequestCategory = Database['public']['Enums']['request_category'];
export type RequestUrgency = Database['public']['Enums']['request_urgency'];
export type RequestSource = Database['public']['Enums']['request_source'];
export type RequestCloseReason = Database['public']['Enums']['request_close_reason'];

// ============================================
// Application-Level Types (camelCase)
// ============================================

export type ClientRequest = {
  id: string;
  organizationId: string;
  requestNumber: string | null;
  clientId: string | null;
  contactId: string | null;
  siteId: string | null;
  /** The Anlage of the request's site the caller named. */
  equipmentId: string | null;
  callerName: string | null;
  callerPhone: string | null;
  callerEmail: string | null;
  callerAddress: string | null;
  summary: string;
  details: string | null;
  category: RequestCategory;
  urgency: RequestUrgency;
  source: RequestSource;
  status: RequestStatus;
  assignedTo: string | null;
  receivedAt: string;
  /** The promised callback („Rückruf bis“). */
  callbackDueAt: string | null;
  closedReason: RequestCloseReason | null;
  closedNote: string | null;
  closedBy: string | null;
  closedAt: string | null;
  convertedJobId: string | null;
  convertedProjectId: string | null;
  convertedBy: string | null;
  convertedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClientRequestEvent = {
  id: string;
  organizationId: string;
  requestId: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
};

// ============================================
// German UI Vocabulary (owner-approved)
// ============================================

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  offen: 'Offen',
  in_klaerung: 'In Klärung',
  umgewandelt: 'Umgewandelt',
  geschlossen: 'Geschlossen',
};

export const REQUEST_CATEGORY_LABELS: Record<RequestCategory, string> = {
  notfall: 'Notfall',
  stoerung_reparatur: 'Störung / Reparatur',
  wartung: 'Wartung',
  angebotsanfrage: 'Angebotsanfrage',
  installation_umbau: 'Installation / Umbau',
  garantie_mangel: 'Garantie / Mangel',
  allgemeine_frage: 'Allgemeine Frage',
  sonstiges: 'Sonstiges',
};

export const REQUEST_URGENCY_LABELS: Record<RequestUrgency, string> = {
  niedrig: 'Niedrig',
  normal: 'Normal',
  hoch: 'Hoch',
  notfall: 'Notfall',
};

export const REQUEST_SOURCE_LABELS: Record<RequestSource, string> = {
  telefon: 'Telefon',
  email: 'E-Mail',
  vor_ort: 'Vor Ort',
  sonstiges: 'Sonstiges',
};

export const REQUEST_CLOSE_REASON_LABELS: Record<RequestCloseReason, string> = {
  kein_bedarf: 'Kein Bedarf mehr',
  abgelehnt: 'Abgelehnt',
  duplikat: 'Duplikat',
  anderweitig_geloest: 'Anderweitig gelöst',
  sonstiges: 'Sonstiges',
};

export const REQUEST_CATEGORY_ORDER: RequestCategory[] = [
  'notfall',
  'stoerung_reparatur',
  'wartung',
  'angebotsanfrage',
  'installation_umbau',
  'garantie_mangel',
  'allgemeine_frage',
  'sonstiges',
];

export const REQUEST_URGENCY_ORDER: RequestUrgency[] = ['niedrig', 'normal', 'hoch', 'notfall'];

export const REQUEST_SOURCE_ORDER: RequestSource[] = ['telefon', 'email', 'vor_ort', 'sonstiges'];

export const REQUEST_CLOSE_REASON_ORDER: RequestCloseReason[] = [
  'kein_bedarf',
  'abgelehnt',
  'duplikat',
  'anderweitig_geloest',
  'sonstiges',
];

/**
 * An open request whose promised callback has passed. The overdue read of
 * `Aufgaben` (list_overdue_request_callbacks) applies the same rule.
 */
export function isCallbackOverdue(
  request: Pick<ClientRequest, 'status' | 'callbackDueAt'>,
  now: Date,
): boolean {
  return (
    (request.status === 'offen' || request.status === 'in_klaerung') &&
    request.callbackDueAt !== null &&
    Date.parse(request.callbackDueAt) < now.getTime()
  );
}

// Conversion maps the request urgency onto the existing job priority
// vocabulary; "notfall" has no job equivalent and becomes "hoch".
export function requestUrgencyToJobPriority(
  urgency: RequestUrgency,
): Database['public']['Enums']['job_priority'] {
  switch (urgency) {
    case 'niedrig':
      return 'niedrig';
    case 'normal':
      return 'mittel';
    case 'hoch':
    case 'notfall':
      return 'hoch';
  }
}

/** What a caller and a customer share: the phone, the email or the name. */
const CALLER_MATCH_FIELDS = ['phone', 'email', 'name'] as const;
export type CallerMatchField = (typeof CALLER_MATCH_FIELDS)[number];

/** A customer of the organization the caller of an unmatched request may already be. */
export type CallerMatch = {
  clientId: string;
  clientName: string;
  matchedOn: CallerMatchField[];
};

export const CALLER_MATCH_FIELD_LABELS: Record<CallerMatchField, string> = {
  phone: 'Telefon',
  email: 'E-Mail',
  name: 'Name',
};

// ============================================
// Result Types
// ============================================

export type ClientRequestResult = ActionResult<{ request: ClientRequest }>;

/** The strongest matches; `moreMatches` says that more customers match than are listed. */
export type CallerMatchList = { matches: CallerMatch[]; moreMatches: boolean };

export type CallerMatchesResult = ActionResult<CallerMatchList>;

/** A job conversion forwards createJob's failures, including its qualification warning. */
export type ConvertRequestResult =
  | { success: true; target: 'job'; jobId: string; jobNumber: string | null }
  | QualificationWarningResult
  | PlanningWarningFailure
  | ActionResult<{ target: 'project'; projectId: string; projectNumber: string | null }>;

// ============================================
// Converters
// ============================================

export function toClientRequest(row: ClientRequestRow): ClientRequest {
  return {
    id: row.id,
    organizationId: row.organization_id,
    requestNumber: row.request_number,
    clientId: row.client_id,
    contactId: row.contact_id,
    siteId: row.site_id,
    equipmentId: row.equipment_id,
    callerName: row.caller_name,
    callerPhone: row.caller_phone,
    callerEmail: row.caller_email,
    callerAddress: row.caller_address,
    summary: row.summary,
    details: row.details,
    category: row.category,
    urgency: row.urgency,
    source: row.source,
    status: row.status,
    assignedTo: row.assigned_to,
    receivedAt: row.received_at,
    callbackDueAt: row.callback_due_at,
    closedReason: row.closed_reason,
    closedNote: row.closed_note,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    convertedJobId: row.converted_job_id,
    convertedProjectId: row.converted_project_id,
    convertedBy: row.converted_by,
    convertedAt: row.converted_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type CallerMatchRow =
  Database['public']['Functions']['find_client_request_caller_matches']['Returns'][number];

function isCallerMatchField(value: string): value is CallerMatchField {
  return CALLER_MATCH_FIELDS.some((field) => field === value);
}

export function toCallerMatch(row: CallerMatchRow): CallerMatch {
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    matchedOn: row.matched_on.filter(isCallerMatchField),
  };
}

export function toClientRequestEvent(row: ClientRequestEventRow): ClientRequestEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    requestId: row.request_id,
    eventType: row.event_type,
    eventPayload: jsonRecordOrEmpty(row.event_payload),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

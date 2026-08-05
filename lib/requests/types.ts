import type { Database } from '@/lib/supabase/database.types';

// ============================================
// Database Row Aliases
// ============================================

export type ClientRequestRow =
  Database['public']['Tables']['client_requests']['Row'];
export type ClientRequestEventRow =
  Database['public']['Tables']['client_request_events']['Row'];

export type RequestStatus = Database['public']['Enums']['request_status'];
export type RequestCategory = Database['public']['Enums']['request_category'];
export type RequestUrgency = Database['public']['Enums']['request_urgency'];
export type RequestSource = Database['public']['Enums']['request_source'];
export type RequestCloseReason =
  Database['public']['Enums']['request_close_reason'];

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
// German UI Vocabulary (owner-approved, P1-02)
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

export const REQUEST_STATUS_ORDER: RequestStatus[] = [
  'offen',
  'in_klaerung',
  'umgewandelt',
  'geschlossen',
];

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

export const REQUEST_URGENCY_ORDER: RequestUrgency[] = [
  'niedrig',
  'normal',
  'hoch',
  'notfall',
];

export const REQUEST_SOURCE_ORDER: RequestSource[] = [
  'telefon',
  'email',
  'vor_ort',
  'sonstiges',
];

export const REQUEST_CLOSE_REASON_ORDER: RequestCloseReason[] = [
  'kein_bedarf',
  'abgelehnt',
  'duplikat',
  'anderweitig_geloest',
  'sonstiges',
];

// Conversion maps the request urgency onto the existing job priority
// vocabulary; "notfall" has no job equivalent and becomes "hoch".
export function requestUrgencyToJobPriority(
  urgency: RequestUrgency
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

// ============================================
// Result Types
// ============================================

export type ClientRequestResult =
  | { success: true; request: ClientRequest }
  | { success: false; error: string };

export type ClientRequestListResult =
  | { success: true; requests: ClientRequest[] }
  | { success: false; error: string };

export type ConvertRequestResult =
  | { success: true; jobId?: string; jobNumber?: string; projectId?: string; projectNumber?: string }
  | { success: false; error: string };

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

export function toClientRequestEvent(
  row: ClientRequestEventRow
): ClientRequestEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    requestId: row.request_id,
    eventType: row.event_type,
    eventPayload:
      row.event_payload && typeof row.event_payload === 'object' && !Array.isArray(row.event_payload)
        ? (row.event_payload as Record<string, unknown>)
        : {},
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

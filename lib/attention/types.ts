import type { Database } from '@/lib/supabase/database.types';
import type { VacationDayPortion } from '@/lib/vacation/types';
import type { RequestStatus, RequestUrgency } from '@/lib/requests/types';

// ============================================
// Database Row Aliases
// ============================================

export type AttentionReadStateRow =
  Database['public']['Tables']['attention_read_states']['Row'];
export type AttentionEventRow =
  Database['public']['Tables']['attention_events']['Row'];

// ============================================
// Item identity (P1-07 pattern contract)
// ============================================

// Attention items are derived live from the owning domains; this identity is
// the only thing pattern-level storage (read markers, pattern events) keys on.
// Keep in sync with the CHECK constraints in migrations
// add_attention_pattern_state + extend_attention_taxonomy_sickness. Later
// slices (qualifications P1-09, follow-ups P1-10, corrections P1-22,
// procurement P1-29) extend this union plus the database CHECK — they never
// add parallel storage.
export type AttentionSourceType =
  | 'time_session_approval'
  | 'time_change_request_approval'
  | 'vacation_request_approval'
  | 'client_request_open'
  | 'vacation_decision'
  | 'sickness_report'
  | 'employee_certification_expiry';

export type AttentionItemIdentity = {
  sourceType: AttentionSourceType;
  sourceId: string;
};

export function attentionItemKey(identity: AttentionItemIdentity): string {
  return `${identity.sourceType}:${identity.sourceId}`;
}

// ============================================
// Derived items (never stored)
// ============================================

// Actionable work for the current viewer. Authorization is resolved by the
// owning domain's own loaders at derivation time (time_approval /
// leave_approval responsibility for approvals, manager role for requests) —
// an item only exists for a viewer who can act on it right now.
export type AttentionTask =
  | {
      sourceType: 'time_session_approval';
      sourceId: string;
      personName: string;
      date: string;
      jobTitle: string | null;
    }
  | {
      sourceType: 'time_change_request_approval';
      sourceId: string;
      personName: string;
      requestType: 'edit' | 'delete';
    }
  | {
      sourceType: 'vacation_request_approval';
      sourceId: string;
      personName: string;
      startDate: string;
      endDate: string;
      dayPortion: VacationDayPortion;
      totalDays: number;
    }
  | {
      sourceType: 'client_request_open';
      sourceId: string;
      requestNumber: string | null;
      summary: string;
      status: RequestStatus;
      urgency: RequestUrgency;
      receivedAt: string;
      openSinceDays: number;
      assigneeName: string | null;
      assignedToMe: boolean;
    };

// Informational notices, deduplicated per source record: a domain state
// change (approve → cancel, sickness correction) changes the state version of
// the SAME item instead of creating a second one.
export type VacationDecisionNotification = {
  sourceType: 'vacation_decision';
  sourceId: string;
  status: 'approved' | 'rejected' | 'cancelled';
  startDate: string;
  endDate: string;
  dayPortion: VacationDayPortion;
  comment: string | null;
  stateVersion: string;
  occurredAt: string;
  unread: boolean;
};

// P1-08: sickness notice. Two audiences share the item identity — managers
// learn of reports they did not record themselves; the affected person learns
// of reports the office recorded or cancelled for them. The payload is
// deliberately minimal (privacy matrix): dates and portion only, NEVER the
// absence type — that stays on the self/manager management surfaces.
export type SicknessReportNotification = {
  sourceType: 'sickness_report';
  sourceId: string;
  /** null = the viewer's own report (person audience). */
  personName: string | null;
  isOwn: boolean;
  status: 'reported' | 'cancelled';
  startDate: string;
  /** null = open-ended („bis auf Weiteres"). */
  endDate: string | null;
  dayPortion: VacationDayPortion;
  stateVersion: string;
  occurredAt: string;
  unread: boolean;
};

export type CertificationExpiryNotification = {
  sourceType: 'employee_certification_expiry';
  sourceId: string;
  employeeRecordId: string;
  personName: string;
  capabilityName: string;
  validUntil: string;
  phase: 'approaching' | 'expired';
  stateVersion: string;
  occurredAt: string;
  unread: boolean;
};

export type AttentionNotification =
  | VacationDecisionNotification
  | SicknessReportNotification
  | CertificationExpiryNotification;

// Own requests for the employee-transparency section ("Meine Anträge").
export type OwnAttentionRequest = {
  sourceId: string;
  startDate: string;
  endDate: string;
  dayPortion: VacationDayPortion;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled';
  totalDays: number;
};

export type AttentionOverview = {
  businessDate: string;
  tasks: AttentionTask[];
  notifications: AttentionNotification[];
  ownRequests: OwnAttentionRequest[];
};

export type AttentionCounts = {
  /** Items the viewer can act on right now (approvals + open requests). */
  actionableCount: number;
  /** Approval items only — the Zeiterfassung Anträge tab's content. */
  approvalsCount: number;
  /** Unread decision notifications for the viewer. */
  unreadNotificationCount: number;
};

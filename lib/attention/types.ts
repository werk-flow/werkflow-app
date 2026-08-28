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
  | 'employee_certification_expiry'
  | 'client_follow_up'
  | 'dispatch_acknowledgement'
  | 'dispatch_challenge_open'
  // Kept for persisted P1-12 read/event identities; new tasks use
  // work_blocker_review after the P1-14 parking migration.
  | 'job_parking_review'
  | 'work_blocker_review'
  | 'work_artifact_review'
  | 'work_artifact_correction'
  | 'work_defect_due'
  | 'work_handover_review';

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
    }
  | {
      sourceType: 'client_follow_up';
      sourceId: string;
      clientId: string;
      clientName: string;
      title: string;
      dueAt: string;
      ownerName: string;
      ownerUnavailable: boolean;
    }
  // P1-12: the recipient's pending confirmation of the CURRENT dispatch
  // revision. The state version is the revision id — a superseding revision
  // re-surfaces the SAME item instead of creating a second one.
  | {
      sourceType: 'dispatch_acknowledgement';
      sourceId: string;
      jobId: string;
      jobNumber: string | null;
      jobTitle: string;
      revisionNumber: number;
      startAt: string | null;
      startDate: string | null;
      stateVersion: string;
    }
  // P1-12: an open employee challenge awaiting a manager decision.
  | {
      sourceType: 'dispatch_challenge_open';
      sourceId: string;
      personName: string;
      reason: string;
      jobTitle: string;
      acknowledgementId: string;
      stateVersion: string;
    }
  // P1-14: an open blocker or parking record whose review date is due.
  | {
      sourceType: 'work_blocker_review';
      sourceId: string;
      targetLabel: string;
      targetHref: string;
      blockerKind: 'blocker' | 'parking';
      nextReviewDate: string;
      responsibleName: string | null;
      stateVersion: string;
    }
  | {
      sourceType: 'work_artifact_review';
      sourceId: string;
      artifactTitle: string;
      artifactKind: Database['public']['Enums']['work_artifact_kind'];
      revisionNumber: number;
      targetLabel: string;
      targetHref: string;
      stateVersion: string;
    }
  | {
      sourceType: 'work_artifact_correction';
      sourceId: string;
      artifactTitle: string;
      artifactKind: Database['public']['Enums']['work_artifact_kind'];
      revisionNumber: number;
      targetLabel: string;
      targetHref: string;
      stateVersion: string;
    }
  | {
      sourceType: 'work_defect_due';
      sourceId: string;
      artifactTitle: string;
      targetLabel: string;
      targetHref: string;
      dueDate: string;
      severity: Database['public']['Enums']['work_artifact_defect_severity'];
      stateVersion: string;
    }
  | {
      sourceType: 'work_handover_review';
      sourceId: string;
      targetType: 'job' | 'project';
      targetLabel: string;
      targetHref: string;
      packageState: 'missing' | Exclude<
        Database['public']['Enums']['work_handover_package_state'],
        'released'
      >;
      stateVersion: string;
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
  // The reason belonging to the current status: the cancellation reason for
  // cancelled requests, otherwise the decision comment. Sourced from the
  // authoritative vacation request row — no parallel reason storage.
  decisionReason: string | null;
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

import type { Database } from '@/lib/supabase/database.types';
import type { VacationDayPortion } from '@/lib/vacation/types';
import type { RequestStatus, RequestUrgency } from '@/lib/requests/types';
import type { CalendarDispatchState } from '@/lib/calendar/board';

// ============================================
// Item identity (P1-07 pattern contract)
// ============================================

// Attention items are derived live from the owning domains; this identity is
// the only thing pattern-level storage (read markers, pattern events) keys on.
// Every kind that storage may key on stays in the CHECK constraints of
// attention_read_states and attention_events (latest in migration
// 20261201100004); a later slice extends this union plus the CHECK and never
// adds parallel storage. The overdue job and due maintenance kinds take no
// marker or event, so the CHECK leaves them out until one does.
type AttentionSourceType =
  | 'time_session_approval'
  | 'time_change_request_approval'
  | 'time_correction_approval'
  | 'vacation_request_approval'
  | 'client_request_open'
  | 'client_request_callback_overdue'
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
  | 'work_handover_review'
  | 'organization_join_request'
  | 'planning_visit_replan'
  | 'site_access_proposal'
  | 'job_past_last_visit'
  | 'maintenance_due';

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
// an item only exists for a viewer who can act on it right now. An approval
// or an open request carries `openSinceDays`: Berlin calendar days since it
// was submitted (a correction: since its current revision).
export type AttentionTask =
  | {
      sourceType: 'time_session_approval';
      sourceId: string;
      personName: string;
      date: string;
      jobTitle: string | null;
      openSinceDays: number;
    }
  | {
      sourceType: 'time_change_request_approval';
      sourceId: string;
      personName: string;
      requestType: 'edit' | 'delete';
      openSinceDays: number;
    }
  | {
      sourceType: 'time_correction_approval';
      sourceId: string;
      personName: string;
      correctionLabel: string;
      stateVersion: string;
      openSinceDays: number;
    }
  | {
      sourceType: 'vacation_request_approval';
      sourceId: string;
      personName: string;
      startDate: string;
      endDate: string;
      dayPortion: VacationDayPortion;
      totalDays: number;
      openSinceDays: number;
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
      /** When it becomes this viewer's overdue callback; null when it never does. */
      callbackDueAt: string | null;
    }
  // An open request whose promised callback has passed: its owner's task,
  // every manager's while it has no owner who is still a manager, and every
  // Admin's once it is overdue past the owner start's threshold
  // (owner-exceptions.ts). It replaces the request's client_request_open task
  // for that viewer.
  | {
      sourceType: 'client_request_callback_overdue';
      sourceId: string;
      requestNumber: string | null;
      summary: string;
      urgency: RequestUrgency;
      callbackDueAt: string;
      /** Null without an owner. */
      ownerName: string | null;
      ownerUnavailable: boolean;
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
      packageState:
        | 'missing'
        | Exclude<Database['public']['Enums']['work_handover_package_state'], 'released'>;
      /** Berlin date the execution completed; null while a finished child job of a project carries none. */
      completedOn: string | null;
      stateVersion: string;
    }
  // Someone entered the organization code and waits for Admin or Büro.
  | {
      sourceType: 'organization_join_request';
      sourceId: string;
      personName: string;
      email: string | null;
    }
  // An approved vacation takes a person away from a scheduled visit. The
  // identity is the visit's assignment of that person: it resolves once the
  // person leaves the visit or the vacation is withdrawn. It never names the
  // absence's kind.
  | {
      sourceType: 'planning_visit_replan';
      sourceId: string;
      personName: string;
      /** Berlin date the visit starts on. */
      date: string;
      /** Berlin start time HH:MM; null for an all-day visit. */
      time: string | null;
      visitTitle: string;
      jobNumber: string | null;
      dispatchState: CalendarDispatchState;
    }
  // A field worker's open proposal for the access to their job's Einsatzort.
  // Every manager decides it on the customer page of its Einsatzort; the
  // proposal is the identity.
  | {
      sourceType: 'site_access_proposal';
      sourceId: string;
      /** The customer the Einsatzort is filed under: its page holds the review. */
      clientId: string;
      siteName: string;
      jobNumber: string | null;
      proposerName: string;
      proposedAt: string;
    }
  // An open job whose last scheduled visit lies before today: the visits are
  // over and the work is neither complete nor planned again. Admin and Büro
  // get it; the job is the identity.
  | {
      sourceType: 'job_past_last_visit';
      sourceId: string;
      jobLabel: string;
      jobHref: string;
      /** Berlin date of the last scheduled visit's last day. */
      lastVisitDate: string;
    }
  // An open due maintenance item without a visit job that is überfällig or
  // due within the lead time (lib/maintenance/overdue.ts). Admin and Büro get
  // it; the due item is the identity. A visit job, an exception or a
  // completion resolves it.
  | {
      sourceType: 'maintenance_due';
      sourceId: string;
      /** The Anlagen of the item, else its plan. */
      equipmentLabel: string;
      /** The plan's Einsatzort; null when the site is not readable. */
      siteName: string | null;
      dueDate: string;
      /** Due before the Berlin day of the overview. */
      overdue: boolean;
      /** The Wartung workspace, searched for the item's plan. */
      href: string;
    };

// Informational notices, deduplicated per source record: a domain state
// change (approve → cancel, sickness correction) changes the state version of
// the SAME item instead of creating a second one.
type VacationDecisionNotification = {
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
type SicknessReportNotification = {
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

type CertificationExpiryNotification = {
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

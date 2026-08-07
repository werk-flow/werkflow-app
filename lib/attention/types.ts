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
// Keep in sync with the CHECK constraints in migration
// add_attention_pattern_state. Later slices (sickness P1-08, qualifications
// P1-09, follow-ups P1-10, corrections P1-22, procurement P1-29) extend this
// union plus the database CHECK — they never add parallel storage.
export type AttentionSourceType =
  | 'time_session_approval'
  | 'time_change_request_approval'
  | 'vacation_request_approval'
  | 'client_request_open'
  | 'vacation_decision';

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

// Informational decision notice for the affected person. Deduplicated per
// request: re-deciding (approve → cancel) changes the state version of the
// same item instead of creating a second one.
export type AttentionNotification = {
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

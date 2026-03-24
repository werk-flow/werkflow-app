import type { Database } from '@/lib/supabase/database.types';

// Database types
export type TimeEntryRow = Database['public']['Tables']['time_entries']['Row'];
export type TimeEntryInsert =
  Database['public']['Tables']['time_entries']['Insert'];
export type TimeEntryUpdate =
  Database['public']['Tables']['time_entries']['Update'];

// Entry type and status
export type TimeEntryType = 'clock_in' | 'clock_out';
export type TimeEntryStatus = Database['public']['Enums']['time_entry_status'];
export type OrgRole = Database['public']['Enums']['org_role'];

/**
 * Application-level time entry type with camelCase properties
 */
export type TimeEntry = {
  id: string;
  userId: string;
  organizationId: string;
  entryType: TimeEntryType;
  timestamp: string;
  isManual: boolean;
  jobId: string | null;
  status: TimeEntryStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * A work session calculated from paired clock-in/clock-out events
 * Can also represent orphan entries (unpaired clock_in or clock_out)
 */
export type WorkSession = {
  clockIn: TimeEntry | null; // null for orphan clock_out
  clockOut: TimeEntry | null; // null if session is open or orphan clock_in
  durationMinutes: number | null; // null if session is open or orphan
  /** Job linked to this session (derived from clockIn entry) */
  jobId: string | null;
  /** True if this is an orphan entry (unpaired clock_out without preceding clock_in) */
  isOrphan?: boolean;
  /**
   * Pending state of the session:
   * - 'none': All entries are approved
   * - 'partial': Some entries are pending (e.g., clock_in approved, clock_out pending)
   * - 'full': All entries are pending (awaiting approval)
   */
  pendingState?: 'none' | 'partial' | 'full';
};

/**
 * Input for adding a manual entry
 */
export type ManualEntryInput = {
  entryType: TimeEntryType;
  timestamp: string; // ISO timestamp
};

/**
 * Parameters for adding manual entries
 */
export type AddManualEntryParams = {
  organizationId: string;
  targetUserId: string;
  entries: ManualEntryInput[];
  jobId?: string;
};

/**
 * Parameters for querying time entries
 */
export type GetTimeEntriesParams = {
  organizationId: string;
  from: string; // ISO date
  to: string; // ISO date
  userId?: string; // Filter by user (admin/manager only)
  status?: TimeEntryStatus;
};

/**
 * Result types for server actions
 */
export type ClockJobInfo = {
  id: string;
  title: string;
  jobNumber: string | null;
  status: string;
  projectName: string | null;
  clientName: string | null;
};

export type WeeklyTimeDataPoint = {
  date: string;
  label: string;
  totalMinutes: number;
  workMinutes: number;
  breakMinutes: number;
  overtimeMinutes: number;
};

export type WeeklyTimeLabel = {
  dateRange: string;
  kw: string;
};

export type LiveClockState = {
  organizationId: string;
  isClockedIn: boolean;
  clockInTime: string | null;
  todayMinutes: number;
  activeJobId: string | null;
  activeJobInfo: ClockJobInfo | null;
  fetchedAt: string;
};

export type ZeiterfassungOverview = {
  clockState: LiveClockState;
  weekData: WeeklyTimeDataPoint[];
  todayIndex: number;
  weekLabel: WeeklyTimeLabel;
};

export type ClockResult =
  | { success: true; entry: TimeEntry; jobInfo?: ClockJobInfo | null }
  | {
      success: false;
      error: 'working_in_other_org';
      otherOrgId: string;
      otherOrgName: string;
    }
  | { success: false; error: string };

export type AddManualEntryResult =
  | { success: true; entries: TimeEntry[] }
  | {
      success: false;
      error: 'working_in_other_org';
      otherOrgId: string;
      otherOrgName: string;
    }
  | { success: false; error: string };

export type ReviewEntryResult =
  | { success: true; entry: TimeEntry }
  | { success: false; error: string };

export type UpdateEntryResult =
  | { success: true; entry: TimeEntry }
  | { success: false; error: string };

export type DeleteEntryResult =
  | { success: true }
  | { success: false; error: string };

export type GetTimeEntriesResult =
  | { success: true; entries: TimeEntry[] }
  | { success: false; error: string };

/**
 * A pending session awaiting approval (may be a single entry or a pair)
 */
export type PendingSession = {
  /** Unique ID for the session (uses clockIn.id or single entry id) */
  id: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  clockIn: TimeEntry | null;
  clockOut: TimeEntry | null;
  /** Entry date for display */
  date: string;
  createdAt: string;
};

export type GetPendingEntriesResult =
  | { success: true; entries: TimeEntry[] }
  | { success: false; error: string };

export type GetPendingSessionsResult =
  | { success: true; sessions: PendingSession[] }
  | { success: false; error: string };

export type GetCurrentlyClockedInResult =
  | {
      success: true;
      users: Array<{
        userId: string;
        clockInTime: string;
        firstName: string | null;
        lastName: string | null;
      }>;
    }
  | { success: false; error: string };

/**
 * Validation result for overlap checks
 */
export type ValidationResult = {
  valid: boolean;
  error?: string;
};

/**
 * Roles that a manager can manage (roles below manager)
 */
export const MANAGED_ROLES: OrgRole[] = ['employee'];

/**
 * Roles that can approve entries for others
 */
export const APPROVER_ROLES: OrgRole[] = ['admin', 'buero'];

/**
 * Convert database row to application type
 */
export function toTimeEntry(row: TimeEntryRow): TimeEntry {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    entryType: row.entry_type as TimeEntryType,
    timestamp: row.timestamp,
    isManual: row.is_manual,
    jobId: row.job_id ?? null,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Convert multiple database rows to application types
 */
export function toTimeEntries(rows: TimeEntryRow[]): TimeEntry[] {
  return rows.map(toTimeEntry);
}

// ============================================
// Change Request Types
// ============================================

export type ChangeRequestRow =
  Database['public']['Tables']['entry_change_requests']['Row'];
export type ChangeRequestType =
  Database['public']['Enums']['entry_change_type'];
export type ChangeRequestStatus =
  Database['public']['Enums']['change_request_status'];

/**
 * Application-level change request type with camelCase properties
 */
export type ChangeRequest = {
  id: string;
  entryId: string;
  pairedEntryId: string | null;
  organizationId: string;
  requestedBy: string;
  changeType: ChangeRequestType;
  proposedTimestamp: string | null;
  /** Original timestamp before edit - used to revert on rejection */
  originalTimestamp: string | null;
  status: ChangeRequestStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Change request with entry and requester info for display
 */
export type ChangeRequestWithDetails = ChangeRequest & {
  entry: TimeEntry;
  pairedEntry: TimeEntry | null;
  requesterFirstName: string | null;
  requesterLastName: string | null;
};

/**
 * Result types for change request actions
 */
export type RequestChangeResult =
  | { success: true; request: ChangeRequest }
  | { success: false; error: string };

export type ReviewChangeRequestResult =
  | { success: true; request: ChangeRequest }
  | { success: false; error: string };

export type GetChangeRequestsResult =
  | { success: true; requests: ChangeRequestWithDetails[] }
  | { success: false; error: string };

/**
 * Convert database row to application type
 */
export function toChangeRequest(row: ChangeRequestRow): ChangeRequest {
  return {
    id: row.id,
    entryId: row.entry_id,
    pairedEntryId: row.paired_entry_id,
    organizationId: row.organization_id,
    requestedBy: row.requested_by,
    changeType: row.change_type,
    proposedTimestamp: row.proposed_timestamp,
    originalTimestamp: row.original_timestamp,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ============================================
// Calendar Visualization Types
// ============================================

/**
 * Information about a pending edit for calendar visualization
 */
export type PendingEditInfo = {
  /** Type of edit: 'add_time' (extended) or 'remove_time' (shortened) */
  editType: 'add_time' | 'remove_time';
  /** The entry type that was edited (clock_in or clock_out) */
  editedEntryType: TimeEntryType;
  /** Original timestamp before the edit */
  originalTimestamp: string;
  /** New timestamp after the edit (current value) */
  newTimestamp: string;
  /** The change request ID */
  changeRequestId: string;
};

/**
 * Information about a pending deletion for calendar visualization
 */
export type PendingDeleteInfo = {
  /** The change request ID */
  changeRequestId: string;
  /** Whether this is a paired deletion (both clock_in and clock_out) */
  isPairedDelete: boolean;
};

/**
 * Extended WorkSession with pending change information for calendar visualization
 */
export type WorkSessionWithPendingChanges = WorkSession & {
  /** Pending edit info for clock_in entry */
  clockInPendingEdit?: PendingEditInfo;
  /** Pending edit info for clock_out entry */
  clockOutPendingEdit?: PendingEditInfo;
  /** Pending deletion info (applies to whole session) */
  pendingDelete?: PendingDeleteInfo;
};

/**
 * Map of entry IDs to their pending change requests
 */
export type EntryChangeRequestMap = Record<string, ChangeRequest>;

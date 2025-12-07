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
  /** True if this is an orphan entry (unpaired clock_out without preceding clock_in) */
  isOrphan?: boolean;
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
export type ClockResult =
  | { success: true; entry: TimeEntry }
  | { success: false; error: string };

export type AddManualEntryResult =
  | { success: true; entries: TimeEntry[] }
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
export const MANAGED_ROLES: OrgRole[] = ['accountant', 'secretary', 'employee'];

/**
 * Roles that can approve entries for others
 */
export const APPROVER_ROLES: OrgRole[] = ['admin', 'manager'];

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

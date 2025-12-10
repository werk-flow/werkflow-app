import type { TimeEntry, TimeEntryStatus, OrgRole, WorkSession } from './types';
import { MANAGED_ROLES } from './types';

/**
 * Role hierarchy for permission checks
 * Lower number = higher rank
 */
export const ROLE_HIERARCHY: Record<OrgRole, number> = {
  admin: 1,
  manager: 2,
  accountant: 3,
  secretary: 4,
  employee: 5
};

/**
 * Check if a user has an open session (currently working)
 *
 * An open session only exists if:
 * 1. The most recent entry TODAY is a clock_in
 * 2. Clock_ins from previous days without clock_outs are NOT considered open sessions
 *    (they are orphan entries that should be displayed but don't mean the user is working)
 *
 * IMPORTANT: This now includes PENDING entries because they take "immediate effect"
 * in the new optimistic approval model. Pending entries affect the working state
 * immediately - approval just confirms they stay, rejection removes them.
 */
export function hasOpenSession(entries: TimeEntry[]): boolean {
  if (entries.length === 0) return false;

  // Get today's date boundaries (local time)
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  );

  // Filter to approved OR pending entries from today and sort by timestamp descending
  // (Rejected and pending_delete entries are excluded as they should not affect state)
  const todayActiveEntries = entries
    .filter((e) => {
      if (e.status === 'rejected' || e.status === 'pending_delete')
        return false;
      const entryDate = new Date(e.timestamp);
      return entryDate >= todayStart && entryDate <= todayEnd;
    })
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

  if (todayActiveEntries.length === 0) return false;

  // Check if the most recent entry TODAY is a clock_in
  return todayActiveEntries[0].entryType === 'clock_in';
}

/**
 * Get the most recent entry for a user (approved OR pending entries)
 * Pending entries are included because they take immediate effect.
 * Entries marked for deletion (pending_delete) are excluded.
 */
export function getLastEntry(entries: TimeEntry[]): TimeEntry | null {
  const activeEntries = entries
    .filter((e) => e.status !== 'rejected' && e.status !== 'pending_delete')
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

  return activeEntries[0] || null;
}

/**
 * Determine the approval status based on caller and target roles
 *
 * Rules:
 * - Admin adding any entry → approved
 * - Manager adding for managed roles (accountant, secretary, employee) → approved
 * - Manager adding for self → pending (needs admin approval)
 * - Other roles adding for self → pending (needs admin/manager approval)
 */
export function determineApprovalStatus(
  callerRole: OrgRole,
  targetUserId: string,
  callerId: string
): TimeEntryStatus {
  const isForSelf = targetUserId === callerId;

  // Admin adding any entry → immediately approved
  if (callerRole === 'admin') {
    return 'approved';
  }

  // Manager adding entry
  if (callerRole === 'manager') {
    // For self → needs admin approval
    if (isForSelf) {
      return 'pending';
    }
    // For others (managed roles) → immediately approved
    // Note: The caller must be adding for managed roles; this is checked elsewhere
    return 'approved';
  }

  // All other roles → needs approval
  return 'pending';
}

/**
 * Check if a user can manage another user's time entries
 *
 * Rules:
 * - Admin can manage all entries in their org
 * - Manager can manage entries for roles below them (accountant, secretary, employee)
 * - Others cannot manage anyone's entries
 */
export function canManageEntries(
  callerRole: OrgRole,
  targetRole: OrgRole,
  isOwnEntry: boolean
): boolean {
  // Admin can manage all entries
  if (callerRole === 'admin') {
    return true;
  }

  // Manager can manage entries for managed roles
  if (callerRole === 'manager') {
    // Managers can manage their own entries (with approval required)
    if (isOwnEntry) {
      return true;
    }
    return MANAGED_ROLES.includes(targetRole);
  }

  // Others cannot manage entries (not even their own for updates/deletes)
  return false;
}

/**
 * Check if a change request is needed (requires admin approval)
 * This is true when a manager is trying to edit/delete their own entries
 */
export function needsChangeRequest(
  callerRole: OrgRole,
  targetRole: OrgRole,
  isOwnEntry: boolean
): boolean {
  // Manager editing their own entry needs admin approval
  if (callerRole === 'manager' && isOwnEntry) {
    return true;
  }

  return false;
}

/**
 * Check if a user can approve/reject entries
 *
 * Rules:
 * - Admin can approve/reject all pending entries
 * - Manager can approve/reject pending entries for managed roles only
 */
export function canApproveEntries(
  callerRole: OrgRole,
  targetRole: OrgRole
): boolean {
  // Admin can approve all entries
  if (callerRole === 'admin') {
    return true;
  }

  // Manager can approve entries for managed roles only
  if (callerRole === 'manager') {
    return MANAGED_ROLES.includes(targetRole);
  }

  return false;
}

/**
 * Check if a user can view another user's entries
 *
 * Rules:
 * - Everyone can see their own entries
 * - Admin can see all entries in their org
 * - Manager can see entries for roles below them
 */
export function canViewEntries(
  callerRole: OrgRole,
  targetUserId: string,
  callerId: string,
  targetRole?: OrgRole
): boolean {
  // Everyone can see their own entries
  if (targetUserId === callerId) {
    return true;
  }

  // Admin can see all entries
  if (callerRole === 'admin') {
    return true;
  }

  // Manager can see entries for managed roles
  if (callerRole === 'manager' && targetRole) {
    return MANAGED_ROLES.includes(targetRole);
  }

  return false;
}

/**
 * Calculate work sessions from a list of entries
 * Re-exported from validation for convenience
 */
export { calculateWorkSessions } from './validation';

/**
 * Calculate total worked minutes from work sessions
 */
export function calculateTotalMinutes(sessions: WorkSession[]): number {
  return sessions.reduce((total, session) => {
    return total + (session.durationMinutes || 0);
  }, 0);
}

/**
 * Format duration in minutes to human-readable string (German)
 * Rounds to nearest minute for display purposes
 */
export function formatDuration(minutes: number): string {
  // Round to nearest minute for display (prevents long decimal numbers)
  const totalMins = Math.round(minutes);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;

  if (hours === 0) {
    return `${mins} Min.`;
  }

  if (mins === 0) {
    return `${hours} Std.`;
  }

  return `${hours} Std. ${mins} Min.`;
}

/**
 * Get entries for a specific date range
 */
export function filterEntriesByDateRange(
  entries: TimeEntry[],
  from: Date,
  to: Date
): TimeEntry[] {
  const fromTime = from.getTime();
  const toTime = to.getTime();

  return entries.filter((entry) => {
    const entryTime = new Date(entry.timestamp).getTime();
    return entryTime >= fromTime && entryTime <= toTime;
  });
}

/**
 * Group entries by date (YYYY-MM-DD)
 */
export function groupEntriesByDate(
  entries: TimeEntry[]
): Record<string, TimeEntry[]> {
  const grouped: Record<string, TimeEntry[]> = {};

  for (const entry of entries) {
    const date = new Date(entry.timestamp).toISOString().split('T')[0];
    if (!grouped[date]) {
      grouped[date] = [];
    }
    grouped[date].push(entry);
  }

  // Sort entries within each date
  for (const date of Object.keys(grouped)) {
    grouped[date].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  return grouped;
}

/**
 * Check if the caller can add entries for a target user
 *
 * Rules:
 * - Everyone can add entries for themselves (as manual entries needing approval)
 * - Admin can add entries for anyone
 * - Manager can add entries for managed roles
 */
export function canAddEntriesFor(
  callerRole: OrgRole,
  targetRole: OrgRole,
  callerId: string,
  targetUserId: string
): boolean {
  // Everyone can add entries for themselves
  if (callerId === targetUserId) {
    return true;
  }

  // Admin can add entries for anyone
  if (callerRole === 'admin') {
    return true;
  }

  // Manager can add entries for managed roles
  if (callerRole === 'manager') {
    return MANAGED_ROLES.includes(targetRole);
  }

  return false;
}

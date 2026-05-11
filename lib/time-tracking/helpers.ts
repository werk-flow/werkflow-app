import type {
  BreakSession,
  ClockStatus,
  ClockTimelineSegment,
  OrgRole,
  TimeEntry,
  TimeEntryStatus,
  WorkSession,
} from './types';
import { MANAGED_ROLES } from './types';
import {
  getLocalDayEnd,
  getLocalDayKey,
  isSameLocalDay
} from './day-utils';
import { getEffectiveTimeEntries } from './effective-entries';

// ── Time model constants ──────────────────────────────────────────────
export const TOTAL_RING_MINUTES = 510;        // 8.5h = one full rotation of main ring
export const BREAK_THRESHOLD_MINUTES = 360;   // 6h total clocked → break applies
export const BREAK_DURATION_MINUTES = 30;
export const BREAK_START_MINUTES = 330;       // 5.5h mark on ring where yellow starts
export const OVERTIME_THRESHOLD_MINUTES = 510; // legacy threshold for fixed-break fallback
export const WORK_GOAL_MINUTES = 480;         // 8h = actual work goal
export const OVERTIME_RING_MAX_MINUTES = 240; // 4h = full outer overtime ring

export interface TimeBreakdown {
  workMinutes: number;
  breakMinutes: number;
  overtimeMinutes: number;
}

export function computeTimeBreakdown(
  totalMinutes: number,
  actualBreakMinutes?: number
): TimeBreakdown {
  if (actualBreakMinutes !== undefined) {
    const clampedBreakMinutes = Math.max(0, Math.min(actualBreakMinutes, totalMinutes));
    const netWorkMinutes = Math.max(0, totalMinutes - clampedBreakMinutes);
    const overtimeMinutes = Math.max(0, netWorkMinutes - WORK_GOAL_MINUTES);
    const workMinutes = Math.max(0, netWorkMinutes - overtimeMinutes);
    return { workMinutes, breakMinutes: clampedBreakMinutes, overtimeMinutes };
  }

  const breakMinutes =
    totalMinutes >= BREAK_THRESHOLD_MINUTES ? BREAK_DURATION_MINUTES : 0;
  const overtimeMinutes = Math.max(0, totalMinutes - OVERTIME_THRESHOLD_MINUTES);
  const workMinutes = totalMinutes - breakMinutes - overtimeMinutes;
  return { workMinutes, breakMinutes, overtimeMinutes };
}

/**
 * Compute elapsed milliseconds for a live session.
 * Client and server clocks can drift slightly, so never return a negative duration.
 */
export function getNonNegativeElapsedMs(clockInTime: string | null): number {
  if (!clockInTime) return 0;

  const startMs = new Date(clockInTime).getTime();
  if (Number.isNaN(startMs)) return 0;

  return Math.max(0, Date.now() - startMs);
}

export interface RingSegment {
  startFraction: number; // 0-1, position on ring
  endFraction: number;   // 0-1, position on ring
  type: 'work' | 'break';
}

export interface RingData {
  segments: RingSegment[];
  overtimeFraction: number; // 0-1, how full the outer overtime ring is
}

type ClockTimelineOptions = {
  sameLocalDayOnly?: boolean;
  includeOpenSegment?: boolean;
};

function pushTimelineSegment(
  segments: ClockTimelineSegment[],
  type: 'work' | 'break',
  startMs: number,
  endMs: number
) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return;
  }

  segments.push({
    type,
    minutes: (endMs - startMs) / 60000
  });
}

export function buildClockTimelineSegments(
  entries: TimeEntry[],
  referenceDate = new Date(),
  options?: ClockTimelineOptions
): ClockTimelineSegment[] {
  const effectiveEntries = getEffectiveTimeEntries(entries, {
    referenceDate,
    sameLocalDayOnly: options?.sameLocalDayOnly ?? true
  });
  const includeOpenSegment = options?.includeOpenSegment ?? false;

  const segments: ClockTimelineSegment[] = [];
  let activeType: 'work' | 'break' | null = null;
  let activeStartMs: number | null = null;
  let activeStartDate: Date | null = null;

  for (const entry of effectiveEntries) {
    const entryDate = new Date(entry.timestamp);
    const entryMs = entryDate.getTime();

    switch (entry.entryType) {
      case 'clock_in':
        if (activeType && activeStartMs !== null) {
          pushTimelineSegment(segments, activeType, activeStartMs, entryMs);
        }
        activeType = 'work';
        activeStartMs = entryMs;
        activeStartDate = entryDate;
        break;
      case 'break_start':
        if (activeType === 'work' && activeStartMs !== null) {
          pushTimelineSegment(segments, 'work', activeStartMs, entryMs);
          activeType = 'break';
          activeStartMs = entryMs;
          activeStartDate = entryDate;
        }
        break;
      case 'break_end':
        if (activeType === 'break' && activeStartMs !== null) {
          pushTimelineSegment(segments, 'break', activeStartMs, entryMs);
          activeType = 'work';
          activeStartMs = entryMs;
          activeStartDate = entryDate;
        } else {
          activeType = 'work';
          activeStartMs = entryMs;
          activeStartDate = entryDate;
        }
        break;
      case 'clock_out':
        if (activeType && activeStartMs !== null) {
          pushTimelineSegment(segments, activeType, activeStartMs, entryMs);
        }
        activeType = null;
        activeStartMs = null;
        activeStartDate = null;
        break;
    }
  }

  if (includeOpenSegment && activeType && activeStartMs !== null && activeStartDate) {
    const openSegmentEndMs = isSameLocalDay(activeStartDate, referenceDate)
      ? referenceDate.getTime()
      : getLocalDayEnd(activeStartDate).getTime();
    pushTimelineSegment(segments, activeType, activeStartMs, openSegmentEndMs);
  }

  return segments;
}

/**
 * Computes multi-segment ring data from raw total minutes.
 * Main ring: 0 → TOTAL_RING_MINUTES (510 min / 8.5h).
 * Break window: always at 5.5h–6h mark once total >= 6h.
 * Overtime: separate outer ring that fills over 4h.
 */
export function computeRingSegments(
  totalMinutes: number,
  actualBreakMinutes?: number
): RingData {
  if (actualBreakMinutes !== undefined) {
    const clamped = Math.max(0, totalMinutes);
    const mainMinutes = Math.min(clamped, TOTAL_RING_MINUTES);
    const clampedBreakMinutes = Math.max(0, Math.min(actualBreakMinutes, mainMinutes));
    const clampedWorkMinutes = Math.max(0, mainMinutes - clampedBreakMinutes);
    const overtimeMinutes = Math.max(
      0,
      Math.max(0, totalMinutes - actualBreakMinutes) - WORK_GOAL_MINUTES
    );
    const overtimeFraction = Math.min(overtimeMinutes / OVERTIME_RING_MAX_MINUTES, 1);

    const segments: RingSegment[] = [];

    if (clampedWorkMinutes > 0) {
      segments.push({
        startFraction: 0,
        endFraction: clampedWorkMinutes / TOTAL_RING_MINUTES,
        type: 'work',
      });
    }

    if (clampedBreakMinutes > 0) {
      segments.push({
        startFraction: clampedWorkMinutes / TOTAL_RING_MINUTES,
        endFraction: (clampedWorkMinutes + clampedBreakMinutes) / TOTAL_RING_MINUTES,
        type: 'break',
      });
    }

    return { segments, overtimeFraction };
  }

  const clamped = Math.max(0, totalMinutes);
  const mainMinutes = Math.min(clamped, TOTAL_RING_MINUTES);
  const overtimeMinutes = Math.max(0, clamped - TOTAL_RING_MINUTES);
  const overtimeFraction = Math.min(overtimeMinutes / OVERTIME_RING_MAX_MINUTES, 1);

  const breakStart = BREAK_START_MINUTES / TOTAL_RING_MINUTES;  // 330/510
  const breakEnd = BREAK_THRESHOLD_MINUTES / TOTAL_RING_MINUTES; // 360/510
  const currentFraction = mainMinutes / TOTAL_RING_MINUTES;

  const segments: RingSegment[] = [];

  if (clamped < BREAK_THRESHOLD_MINUTES) {
    // Haven't reached 6h yet → single green arc
    if (currentFraction > 0) {
      segments.push({ startFraction: 0, endFraction: currentFraction, type: 'work' });
    }
  } else {
    // Past 6h → green up to 5.5h, yellow 5.5h-6h, green 6h to current
    segments.push({ startFraction: 0, endFraction: breakStart, type: 'work' });
    segments.push({ startFraction: breakStart, endFraction: breakEnd, type: 'break' });
    if (currentFraction > breakEnd) {
      segments.push({ startFraction: breakEnd, endFraction: currentFraction, type: 'work' });
    }
  }

  return { segments, overtimeFraction };
}

export function computeRingSegmentsFromTimeline(
  timelineSegments: ClockTimelineSegment[]
): RingData {
  const normalizedSegments = timelineSegments.filter((segment) => segment.minutes > 0);
  const totalWorkMinutes = normalizedSegments.reduce(
    (total, segment) => total + (segment.type === 'work' ? segment.minutes : 0),
    0
  );
  const overtimeMinutes = Math.max(0, totalWorkMinutes - WORK_GOAL_MINUTES);
  const overtimeFraction = Math.min(overtimeMinutes / OVERTIME_RING_MAX_MINUTES, 1);

  const segments: RingSegment[] = [];
  let cursorMinutes = 0;

  for (const segment of normalizedSegments) {
    if (cursorMinutes >= TOTAL_RING_MINUTES) {
      break;
    }

    const usableMinutes = Math.min(segment.minutes, TOTAL_RING_MINUTES - cursorMinutes);
    if (usableMinutes <= 0) {
      continue;
    }

    segments.push({
      startFraction: cursorMinutes / TOTAL_RING_MINUTES,
      endFraction: (cursorMinutes + usableMinutes) / TOTAL_RING_MINUTES,
      type: segment.type
    });
    cursorMinutes += usableMinutes;
  }

  return { segments, overtimeFraction };
}

/**
 * Role hierarchy for permission checks
 * Lower number = higher rank
 */
export const ROLE_HIERARCHY: Record<OrgRole, number> = {
  admin: 1,
  buero: 2,
  employee: 3
};

export type DerivedClockState = {
  status: ClockStatus;
  isClockedIn: boolean;
  isOnBreak: boolean;
  clockInTime: string | null;
  statusStartedAt: string | null;
  breakStartTime: string | null;
  activeJobId: string | null;
  lastEntry: TimeEntry | null;
};

export function deriveCurrentClockState(
  entries: TimeEntry[],
  referenceDate = new Date()
): DerivedClockState {
  const todayEntries = getEffectiveTimeEntries(entries, {
    referenceDate,
    sameLocalDayOnly: true,
  });

  let status: ClockStatus = 'clocked_out';
  let clockInTime: string | null = null;
  let statusStartedAt: string | null = null;
  let breakStartTime: string | null = null;
  let activeJobId: string | null = null;

  for (const entry of todayEntries) {
    switch (entry.entryType) {
      case 'clock_in':
        status = 'working';
        clockInTime = entry.timestamp;
        statusStartedAt = entry.timestamp;
        breakStartTime = null;
        activeJobId = entry.jobId ?? null;
        break;
      case 'break_start':
        if (status === 'working') {
          status = 'on_break';
          statusStartedAt = entry.timestamp;
          breakStartTime = entry.timestamp;
          activeJobId = null;
        }
        break;
      case 'break_end':
        if (status !== 'clocked_out') {
          status = 'working';
          statusStartedAt = entry.timestamp;
          breakStartTime = null;
          activeJobId = entry.jobId ?? null;
        }
        break;
      case 'clock_out':
        status = 'clocked_out';
        clockInTime = null;
        statusStartedAt = null;
        breakStartTime = null;
        activeJobId = null;
        break;
    }
  }

  const lastEntry =
    todayEntries.length > 0 ? todayEntries[todayEntries.length - 1] : null;

  return {
    status,
    isClockedIn: status !== 'clocked_out',
    isOnBreak: status === 'on_break',
    clockInTime,
    statusStartedAt,
    breakStartTime,
    activeJobId,
    lastEntry,
  };
}

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
export function hasOpenSession(
  entries: TimeEntry[],
  referenceDate = new Date()
): boolean {
  return deriveCurrentClockState(entries, referenceDate).isClockedIn;
}

/**
 * Get the most recent entry for a user (approved OR pending entries)
 * Pending entries are included because they take immediate effect.
 * Entries marked for deletion (pending_delete) are excluded.
 */
export function getLastEntry(entries: TimeEntry[]): TimeEntry | null {
  const activeEntries = getEffectiveTimeEntries(entries)
    .slice()
    .reverse();
  return activeEntries[0] || null;
}

/**
 * Determine the approval status based on caller and target roles
 *
 * Rules:
 * - Admin adding any entry → approved
 * - Manager adding for managed roles (accountant, secretary, employee) → approved
 * - Manager adding for self → approved (TODO: make configurable via org settings;
 *   when enabled, return 'pending' so admin approval is required)
 * - Other roles adding for self → pending (needs admin/manager approval)
 */
export function determineApprovalStatus(
  callerRole: OrgRole,
  _targetUserId: string,
  _callerId: string
): TimeEntryStatus {
  void _targetUserId;
  void _callerId;

  // Admin adding any entry → immediately approved
  if (callerRole === 'admin') {
    return 'approved';
  }

  // Manager adding entry → immediately approved (both for self and managed roles)
  if (callerRole === 'buero') {
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

  // Manager can manage entries for managed roles and their own
  if (callerRole === 'buero') {
    if (isOwnEntry) {
      return true;
    }
    return MANAGED_ROLES.includes(targetRole);
  }

  // Others cannot manage entries (not even their own for updates/deletes)
  return false;
}

/**
 * Check if a change request is needed (requires admin approval).
 * TODO: make configurable via org settings. When enabled, return true
 * for `callerRole === 'buero' && isOwnEntry` so Büro edits/deletes
 * on their own entries require admin approval.
 */
export function needsChangeRequest(
  _callerRole: OrgRole,
  _targetRole: OrgRole,
  _isOwnEntry: boolean
): boolean {
  void _callerRole;
  void _targetRole;
  void _isOwnEntry;
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
  if (callerRole === 'buero') {
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
  _targetRole?: OrgRole
): boolean {
  void _targetRole;

  // Everyone can see their own entries
  if (targetUserId === callerId) {
    return true;
  }

  // Admin can see all entries
  if (callerRole === 'admin') {
    return true;
  }

  // Büro can see all entries in their org
  if (callerRole === 'buero') {
    return true;
  }

  return false;
}

/**
 * Calculate work sessions from a list of entries
 * Re-exported from validation for convenience
 */
export { calculateWorkSessions } from './validation';
export { calculateBreakSessions } from './validation';

/**
 * Calculate total worked minutes from work sessions
 */
export function calculateTotalMinutes(sessions: WorkSession[]): number {
  return sessions.reduce((total, session) => {
    return total + (session.durationMinutes || 0);
  }, 0);
}

export function calculateBreakMinutes(sessions: BreakSession[]): number {
  return sessions.reduce((total, session) => {
    return total + (session.durationMinutes || 0);
  }, 0);
}

export function calculatePresenceMinutes(
  workSessions: WorkSession[],
  breakSessions: BreakSession[]
): number {
  return calculateTotalMinutes(workSessions) + calculateBreakMinutes(breakSessions);
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
    const date = getLocalDayKey(new Date(entry.timestamp));
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
  if (callerRole === 'buero') {
    return MANAGED_ROLES.includes(targetRole);
  }

  return false;
}

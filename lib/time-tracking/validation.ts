import type {
  TimeEntry,
  TimeEntryType,
  ManualEntryInput,
  ValidationResult,
  WorkSession
} from './types';

/**
 * Check if two timestamps are in the same minute (minute-level overlap)
 * Used to block manual entries at the exact same minute as existing entries
 */
export function checkMinuteOverlap(existingTs: Date, newTs: Date): boolean {
  return (
    existingTs.getFullYear() === newTs.getFullYear() &&
    existingTs.getMonth() === newTs.getMonth() &&
    existingTs.getDate() === newTs.getDate() &&
    existingTs.getHours() === newTs.getHours() &&
    existingTs.getMinutes() === newTs.getMinutes()
  );
}

/**
 * Check if a single new entry overlaps (same minute) with any existing entry
 *
 * IMPORTANT: This includes PENDING entries because they take immediate effect
 * and should be treated as "real" for validation purposes.
 */
export function validateSingleEntryNoOverlap(
  existingEntries: TimeEntry[],
  newTimestamp: Date
): ValidationResult {
  // Filter to only active entries (approved or pending, not rejected or pending_delete)
  const activeEntries = existingEntries.filter(
    (e) => e.status !== 'rejected' && e.status !== 'pending_delete'
  );

  for (const entry of activeEntries) {
    const existingTs = new Date(entry.timestamp);
    if (checkMinuteOverlap(existingTs, newTimestamp)) {
      return {
        valid: false,
        error: `Ein Eintrag existiert bereits um ${existingTs.toLocaleTimeString(
          'de-DE',
          { hour: '2-digit', minute: '2-digit' }
        )}. Der früheste verfügbare Zeitpunkt ist eine Minute später.`
      };
    }
  }
  return { valid: true };
}

/**
 * Helper to check if a date is today
 */
function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/**
 * Helper to determine the pending state of a session
 */
function determinePendingState(
  clockIn: TimeEntry | null,
  clockOut: TimeEntry | null
): 'none' | 'partial' | 'full' {
  const clockInPending = clockIn?.status === 'pending';
  const clockOutPending = clockOut?.status === 'pending';

  if (!clockIn && !clockOut) return 'none';
  if (!clockIn) return clockOutPending ? 'full' : 'none';
  if (!clockOut) return clockInPending ? 'full' : 'none';

  if (clockInPending && clockOutPending) return 'full';
  if (clockInPending || clockOutPending) return 'partial';
  return 'none';
}

/**
 * Calculate work sessions from a sorted list of entries
 * Sessions are formed by pairing clock_in with the next clock_out
 *
 * IMPORTANT: This now includes PENDING and PENDING_DELETE entries because they take
 * "immediate effect" in the new optimistic approval model. Each session tracks its pendingState.
 * pending_delete entries are shown with hatched styling in the calendar.
 *
 * Handles orphan entries:
 * - Unpaired clock_out (no preceding clock_in) → orphan
 * - Unpaired clock_in from a PREVIOUS day → orphan (not currently working)
 * - Unpaired clock_in from TODAY → open session (user is currently working)
 */
export function calculateWorkSessions(entries: TimeEntry[]): WorkSession[] {
  // Filter to approved, pending, or pending_delete entries (exclude only rejected) and sort by timestamp
  // pending_delete entries are shown with hatched styling in the calendar
  const activeEntries = entries
    .filter((e) => e.status !== 'rejected')
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

  const sessions: WorkSession[] = [];
  let currentClockIn: TimeEntry | null = null;

  for (const entry of activeEntries) {
    if (entry.entryType === 'clock_in') {
      // If we already have an open clock_in, it means there's a missing clock_out
      // Mark it as orphan since we're moving to a new clock_in
      if (currentClockIn) {
        sessions.push({
          clockIn: currentClockIn,
          clockOut: null,
          durationMinutes: null,
          jobId: currentClockIn.jobId,
          isOrphan: true,
          pendingState: determinePendingState(currentClockIn, null)
        });
      }
      currentClockIn = entry;
    } else if (entry.entryType === 'clock_out') {
      if (currentClockIn) {
        const clockInTime = new Date(currentClockIn.timestamp).getTime();
        const clockOutTime = new Date(entry.timestamp).getTime();
        const durationMinutes = (clockOutTime - clockInTime) / 60000;

        sessions.push({
          clockIn: currentClockIn,
          clockOut: entry,
          durationMinutes,
          jobId: currentClockIn.jobId,
          pendingState: determinePendingState(currentClockIn, entry)
        });
        currentClockIn = null;
      } else {
        sessions.push({
          clockIn: null,
          clockOut: entry,
          durationMinutes: null,
          jobId: entry.jobId,
          isOrphan: true,
          pendingState: determinePendingState(null, entry)
        });
      }
    }
  }

  if (currentClockIn) {
    const clockInDate = new Date(currentClockIn.timestamp);
    const isOpenSession = isToday(clockInDate);

    sessions.push({
      clockIn: currentClockIn,
      clockOut: null,
      durationMinutes: null,
      jobId: currentClockIn.jobId,
      isOrphan: !isOpenSession,
      pendingState: determinePendingState(currentClockIn, null)
    });
  }

  return sessions;
}

/**
 * Check if a new time window (clock_in + clock_out pair) overlaps with any existing session
 * A pair must exist entirely outside existing work windows
 */
export function checkWindowOverlap(
  existingSessions: WorkSession[],
  newClockIn: Date,
  newClockOut: Date
): ValidationResult {
  const newStart = newClockIn.getTime();
  const newEnd = newClockOut.getTime();

  for (const session of existingSessions) {
    // Skip orphan sessions (they don't have a window)
    if (!session.clockIn) continue;

    const sessionStart = new Date(session.clockIn.timestamp).getTime();
    // For open sessions, treat them as extending to "now" for overlap purposes
    const sessionEnd = session.clockOut
      ? new Date(session.clockOut.timestamp).getTime()
      : Date.now();

    // Check for any overlap between [newStart, newEnd] and [sessionStart, sessionEnd]
    // Two intervals [a, b] and [c, d] overlap if a < d AND c < b
    if (newStart < sessionEnd && sessionStart < newEnd) {
      const sessionStartStr = new Date(
        session.clockIn.timestamp
      ).toLocaleString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit'
      });
      const sessionEndStr = session.clockOut
        ? new Date(session.clockOut.timestamp).toLocaleString('de-DE', {
            hour: '2-digit',
            minute: '2-digit'
          })
        : 'offen';

      return {
        valid: false,
        error: `Der neue Zeitraum überschneidet sich mit einer bestehenden Arbeitszeit (${sessionStartStr} - ${sessionEndStr}). Manuelle Einträge müssen vollständig außerhalb bestehender Zeitfenster liegen.`
      };
    }
  }

  return { valid: true };
}

/**
 * Validate a pair of manual entries (clock_in and clock_out together)
 * - clock_in must be before clock_out
 * - The pair must not overlap with any existing work session
 */
export function validateManualPair(
  existingEntries: TimeEntry[],
  clockInTimestamp: Date,
  clockOutTimestamp: Date
): ValidationResult {
  // Validate clock_in is before clock_out
  if (clockInTimestamp.getTime() >= clockOutTimestamp.getTime()) {
    return {
      valid: false,
      error: 'Die Einstempelzeit muss vor der Ausstempelzeit liegen.'
    };
  }

  // Check minute-level overlap for both timestamps
  const clockInOverlap = validateSingleEntryNoOverlap(
    existingEntries,
    clockInTimestamp
  );
  if (!clockInOverlap.valid) {
    return clockInOverlap;
  }

  const clockOutOverlap = validateSingleEntryNoOverlap(
    existingEntries,
    clockOutTimestamp
  );
  if (!clockOutOverlap.valid) {
    return clockOutOverlap;
  }

  // Calculate existing work sessions and check window overlap
  const existingSessions = calculateWorkSessions(existingEntries);
  const windowOverlap = checkWindowOverlap(
    existingSessions,
    clockInTimestamp,
    clockOutTimestamp
  );
  if (!windowOverlap.valid) {
    return windowOverlap;
  }

  return { valid: true };
}

/**
 * Validate manual entries before submission
 * This is the main validation function that checks all rules
 *
 * New simplified logic:
 * - Single clock_in or clock_out entries are allowed
 * - They will automatically pair with existing entries on the same day
 * - Only validates:
 *   1. Valid date/time
 *   2. Not in the future
 *   3. No minute-level overlap with existing entries
 *   4. For pairs: clock_in must be before clock_out, no window overlap
 */
export function validateManualEntries(
  existingEntries: TimeEntry[],
  newEntries: ManualEntryInput[]
): ValidationResult {
  if (newEntries.length === 0) {
    return { valid: false, error: 'Mindestens ein Eintrag ist erforderlich.' };
  }

  // Validate timestamps are valid dates and not in the future
  for (const entry of newEntries) {
    const ts = new Date(entry.timestamp);
    if (isNaN(ts.getTime())) {
      return { valid: false, error: 'Ungültiges Datum oder Uhrzeit.' };
    }

    // Cannot add entries in the future
    if (ts.getTime() > Date.now()) {
      return {
        valid: false,
        error: 'Manuelle Einträge können nicht in der Zukunft liegen.'
      };
    }
  }

  // Check if it's a pair (clock_in + clock_out)
  if (newEntries.length === 2) {
    const clockIn = newEntries.find((e) => e.entryType === 'clock_in');
    const clockOut = newEntries.find((e) => e.entryType === 'clock_out');

    if (clockIn && clockOut) {
      return validateManualPair(
        existingEntries,
        new Date(clockIn.timestamp),
        new Date(clockOut.timestamp)
      );
    }
  }

  // For single entries - just check minute-level overlap
  for (const entry of newEntries) {
    const ts = new Date(entry.timestamp);
    const overlapResult = validateSingleEntryNoOverlap(existingEntries, ts);
    if (!overlapResult.valid) {
      return overlapResult;
    }
  }

  // No longer enforce strict alternating pattern - entries will pair automatically
  return { valid: true };
}

/**
 * Check if a timestamp update would create an overlap
 */
export function validateTimestampUpdate(
  existingEntries: TimeEntry[],
  entryId: string,
  newTimestamp: Date
): ValidationResult {
  // Find the entry being updated
  const entryBeingUpdated = existingEntries.find((e) => e.id === entryId);
  if (!entryBeingUpdated) {
    return { valid: false, error: 'Eintrag nicht gefunden.' };
  }

  // Find the paired entry (if this is a clock_in, find its clock_out and vice versa)
  // First, calculate sessions from ALL entries to find the current pairing
  const allSessions = calculateWorkSessions(existingEntries);
  const currentSession = allSessions.find(
    (s) => s.clockIn?.id === entryId || s.clockOut?.id === entryId
  );

  // Get the ID of the paired entry (if any)
  const pairedEntryId =
    currentSession?.clockIn?.id === entryId
      ? currentSession?.clockOut?.id
      : currentSession?.clockIn?.id;

  // Filter out BOTH the entry being updated AND its paired entry
  // This prevents false overlap detection when editing one entry of a pair
  const otherEntries = existingEntries.filter(
    (e) => e.id !== entryId && e.id !== pairedEntryId
  );

  // Check minute-level overlap with other entries (excluding the current session)
  const overlapResult = validateSingleEntryNoOverlap(
    otherEntries,
    newTimestamp
  );
  if (!overlapResult.valid) {
    return overlapResult;
  }

  // Cannot update to future timestamp
  if (newTimestamp.getTime() > Date.now()) {
    return {
      valid: false,
      error: 'Zeitstempel kann nicht in der Zukunft liegen.'
    };
  }

  // Calculate sessions from other entries (excluding the current session) to check window overlap
  const otherSessions = calculateWorkSessions(otherEntries);

  if (currentSession) {
    // Check if this update creates an invalid session (clock_out before clock_in)
    if (entryBeingUpdated.entryType === 'clock_in' && currentSession.clockOut) {
      const clockOutTime = new Date(
        currentSession.clockOut.timestamp
      ).getTime();
      if (newTimestamp.getTime() >= clockOutTime) {
        return {
          valid: false,
          error: 'Die Einstempelzeit muss vor der Ausstempelzeit liegen.'
        };
      }
      // Check window overlap with the updated time range
      const windowOverlap = checkWindowOverlap(
        otherSessions,
        newTimestamp,
        new Date(currentSession.clockOut.timestamp)
      );
      if (!windowOverlap.valid) {
        return windowOverlap;
      }
    } else if (
      entryBeingUpdated.entryType === 'clock_out' &&
      currentSession.clockIn
    ) {
      const clockInTime = new Date(currentSession.clockIn.timestamp).getTime();
      if (newTimestamp.getTime() <= clockInTime) {
        return {
          valid: false,
          error: 'Die Ausstempelzeit muss nach der Einstempelzeit liegen.'
        };
      }
      // Check window overlap with the updated time range
      const windowOverlap = checkWindowOverlap(
        otherSessions,
        new Date(currentSession.clockIn.timestamp),
        newTimestamp
      );
      if (!windowOverlap.valid) {
        return windowOverlap;
      }
    }
  }

  return { valid: true };
}

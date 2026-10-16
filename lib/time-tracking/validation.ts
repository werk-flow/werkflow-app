import { compareTimeEntries } from '@/lib/time-tracking/entry-order';
import type { BreakSession, TimeEntry, ManualEntryInput, ValidationResult, WorkSession } from './types';
import { formatBerlinLocalDate, getLocalDayEnd, isSameLocalDay } from '@/lib/date-time/berlin';
import { getEffectiveTimeEntries } from './effective-entries';
import { isBreakEndFollowedByClockIn } from './transition-pairs';

// A refusal answers a code and the instants it names, never a sentence:
// lib/time-tracking/validation-messages.ts owns the German wording.

/**
 * Check if two timestamps are in the same minute (minute-level overlap)
 * Used to block manual entries at the exact same minute as existing entries
 */
function checkMinuteOverlap(existingTs: Date, newTs: Date): boolean {
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
function validateSingleEntryNoOverlap(
  existingEntries: TimeEntry[],
  newTimestamp: Date,
  entryBeingUpdated?: TimeEntry,
): ValidationResult {
  // Filter to only active entries (approved or pending, not rejected or pending_delete)
  const activeEntries = existingEntries.filter(
    (e) =>
      e.status !== 'rejected' &&
      e.status !== 'pending_delete' &&
      isSameLocalDay(new Date(e.timestamp), newTimestamp),
  );

  for (const entry of activeEntries) {
    const existingTs = new Date(entry.timestamp);
    if (checkMinuteOverlap(existingTs, newTimestamp)) {
      const isBreakResumeBoundaryPair =
        !!entryBeingUpdated &&
        ((entry.entryType === 'break_end' && entryBeingUpdated.entryType === 'clock_in') ||
          (entry.entryType === 'clock_in' && entryBeingUpdated.entryType === 'break_end'));

      if (isBreakResumeBoundaryPair) {
        continue;
      }

      return { valid: false, failure: { error: 'entry_minute_taken', at: entry.timestamp } };
    }
  }
  return { valid: true };
}

/** Whether the instant falls on today's Berlin day; the server runs in UTC. */
function isToday(date: Date): boolean {
  return isSameLocalDay(date, new Date());
}

/**
 * Helper to determine the pending state of a session
 */
function determinePendingState(
  clockIn: TimeEntry | null,
  clockOut: TimeEntry | null,
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
  const activeEntries = getEffectiveTimeEntries(entries);

  const sessions: WorkSession[] = [];
  let currentWorkStart: TimeEntry | null = null;

  const pushUnpairedWorkStart = (startEntry: TimeEntry) => {
    const startDate = new Date(startEntry.timestamp);
    const isOpenSession = isToday(startDate);

    sessions.push({
      clockIn: startEntry,
      clockOut: null,
      durationMinutes: null,
      jobId: startEntry.jobId,
      startEntryType: startEntry.entryType === 'break_end' ? 'break_end' : 'clock_in',
      endEntryType: null,
      isOrphan: !isOpenSession,
      pendingState: determinePendingState(startEntry, null),
    });
  };

  for (let index = 0; index < activeEntries.length; index += 1) {
    const entry = activeEntries[index];
    if (!entry) continue;
    if (
      currentWorkStart &&
      !isSameLocalDay(new Date(currentWorkStart.timestamp), new Date(entry.timestamp))
    ) {
      sessions.push({
        clockIn: currentWorkStart,
        clockOut: null,
        durationMinutes: null,
        jobId: currentWorkStart.jobId,
        startEntryType: currentWorkStart.entryType === 'break_end' ? 'break_end' : 'clock_in',
        endEntryType: null,
        isOrphan: true,
        pendingState: determinePendingState(currentWorkStart, null),
      });
      currentWorkStart = null;
    }

    const startsWork =
      entry.entryType === 'clock_in' ||
      (entry.entryType === 'break_end' && !isBreakEndFollowedByClockIn(activeEntries, index));

    if (startsWork) {
      if (currentWorkStart) {
        pushUnpairedWorkStart(currentWorkStart);
      }
      currentWorkStart = entry;
    } else if (entry.entryType === 'clock_out' || entry.entryType === 'break_start') {
      if (
        currentWorkStart &&
        isSameLocalDay(new Date(currentWorkStart.timestamp), new Date(entry.timestamp))
      ) {
        const startTime = new Date(currentWorkStart.timestamp).getTime();
        const endTime = new Date(entry.timestamp).getTime();
        const durationMinutes = (endTime - startTime) / 60000;

        sessions.push({
          clockIn: currentWorkStart,
          clockOut: entry,
          durationMinutes,
          jobId: currentWorkStart.jobId,
          startEntryType: currentWorkStart.entryType === 'break_end' ? 'break_end' : 'clock_in',
          endEntryType: entry.entryType === 'break_start' ? 'break_start' : 'clock_out',
          pendingState: determinePendingState(currentWorkStart, entry),
        });
        currentWorkStart = null;
      } else {
        if (currentWorkStart) {
          pushUnpairedWorkStart(currentWorkStart);
          currentWorkStart = null;
        }

        if (entry.entryType === 'clock_out') {
          sessions.push({
            clockIn: null,
            clockOut: entry,
            durationMinutes: null,
            jobId: entry.jobId,
            startEntryType: null,
            endEntryType: 'clock_out',
            isOrphan: true,
            pendingState: determinePendingState(null, entry),
          });
        }
      }
    }
  }

  if (currentWorkStart) {
    pushUnpairedWorkStart(currentWorkStart);
  }

  return sessions;
}

export function calculateBreakSessions(entries: TimeEntry[]): BreakSession[] {
  const activeEntries = getEffectiveTimeEntries(entries);

  const sessions: BreakSession[] = [];
  let currentBreakStart: TimeEntry | null = null;

  for (const entry of activeEntries) {
    if (
      currentBreakStart &&
      !isSameLocalDay(new Date(currentBreakStart.timestamp), new Date(entry.timestamp))
    ) {
      sessions.push({
        breakStart: currentBreakStart,
        breakEnd: null,
        durationMinutes: null,
        isOpen: false,
        pendingState: determinePendingState(currentBreakStart, null),
      });
      currentBreakStart = null;
    }

    if (entry.entryType === 'break_start') {
      if (currentBreakStart) {
        sessions.push({
          breakStart: currentBreakStart,
          breakEnd: null,
          durationMinutes: null,
          isOpen: true,
          pendingState: determinePendingState(currentBreakStart, null),
        });
      }
      currentBreakStart = entry;
    } else if (currentBreakStart && (entry.entryType === 'break_end' || entry.entryType === 'clock_out')) {
      const breakStartTime = new Date(currentBreakStart.timestamp).getTime();
      const breakEndTime = new Date(entry.timestamp).getTime();

      sessions.push({
        breakStart: currentBreakStart,
        breakEnd: entry,
        durationMinutes: (breakEndTime - breakStartTime) / 60000,
        isOpen: false,
        pendingState: determinePendingState(currentBreakStart, entry),
      });
      currentBreakStart = null;
    }
  }

  if (currentBreakStart) {
    sessions.push({
      breakStart: currentBreakStart,
      breakEnd: null,
      durationMinutes: null,
      isOpen: true,
      pendingState: determinePendingState(currentBreakStart, null),
    });
  }

  return sessions;
}

function getActiveDayEntries(entries: TimeEntry[], referenceDate: Date): TimeEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.status !== 'rejected' &&
        entry.status !== 'pending_delete' &&
        isSameLocalDay(new Date(entry.timestamp), referenceDate),
    )
    .sort(compareTimeEntries);
}

function getWorkSessionEndMs(session: WorkSession): number | null {
  if (!session.clockIn) return null;

  if (session.clockOut) {
    return new Date(session.clockOut.timestamp).getTime();
  }

  const startDate = new Date(session.clockIn.timestamp);
  return isToday(startDate) ? Date.now() : getLocalDayEnd(startDate).getTime();
}

function getBreakSessionEndMs(session: BreakSession): number {
  if (session.breakEnd) {
    return new Date(session.breakEnd.timestamp).getTime();
  }

  const startDate = new Date(session.breakStart.timestamp);
  return isToday(startDate) ? Date.now() : getLocalDayEnd(startDate).getTime();
}

function isTimestampInsideWorkWindow(
  sessions: WorkSession[],
  timestamp: Date,
  options?: { includeOpenSessions?: boolean },
): WorkSession | null {
  const targetMs = timestamp.getTime();

  for (const session of sessions) {
    if (!session.clockIn) continue;
    if (!options?.includeOpenSessions && !session.clockOut) continue;

    const startMs = new Date(session.clockIn.timestamp).getTime();
    const endMs = getWorkSessionEndMs(session);
    if (endMs === null) continue;

    if (startMs < targetMs && targetMs < endMs) {
      return session;
    }
  }

  return null;
}

function isTimestampInsideBreakWindow(
  sessions: BreakSession[],
  timestamp: Date,
  options?: { includeOpenSessions?: boolean },
): BreakSession | null {
  const targetMs = timestamp.getTime();

  for (const session of sessions) {
    if (!options?.includeOpenSessions && !session.breakEnd) continue;

    const startMs = new Date(session.breakStart.timestamp).getTime();
    const endMs = getBreakSessionEndMs(session);

    if (startMs < targetMs && targetMs < endMs) {
      return session;
    }
  }

  return null;
}

/** The window a refusal names: its start and its end, or null while it is open. */
type RefusedWindow = { start: string; end: string | null };

function breakWindow(session: BreakSession): RefusedWindow {
  return { start: session.breakStart.timestamp, end: session.breakEnd?.timestamp ?? null };
}

function workWindow(clockIn: TimeEntry, clockOut: TimeEntry | null): RefusedWindow {
  return { start: clockIn.timestamp, end: clockOut?.timestamp ?? null };
}

function validateBreakWindowOverlap(
  breakSessions: BreakSession[],
  newStart: Date,
  newEnd: Date,
): ValidationResult {
  const newStartMs = newStart.getTime();
  const newEndMs = newEnd.getTime();

  for (const session of breakSessions) {
    const startMs = new Date(session.breakStart.timestamp).getTime();
    const endMs = getBreakSessionEndMs(session);

    if (newStartMs < endMs && startMs < newEndMs) {
      return { valid: false, failure: { error: 'pair_overlaps_break', ...breakWindow(session) } };
    }
  }

  return { valid: true };
}

type EntrySequenceState = 'clocked_out' | 'working' | 'on_break';

function deriveSequenceStateAtTimestamp(entries: TimeEntry[], referenceDate: Date): EntrySequenceState {
  const dayEntries = getActiveDayEntries(entries, referenceDate).filter(
    (entry) => new Date(entry.timestamp).getTime() <= referenceDate.getTime(),
  );

  let state: EntrySequenceState = 'clocked_out';

  for (const entry of dayEntries) {
    switch (entry.entryType) {
      case 'clock_in':
        state = 'working';
        break;
      case 'break_start':
        if (state === 'working') {
          state = 'on_break';
        }
        break;
      case 'break_end':
        if (state !== 'clocked_out') {
          state = 'working';
        }
        break;
      case 'clock_out':
        state = 'clocked_out';
        break;
    }
  }

  return state;
}

export function validateDayEntrySequence(entries: TimeEntry[]): ValidationResult {
  const sortedEntries = entries
    .filter((entry) => entry.status !== 'rejected' && entry.status !== 'pending_delete')
    .sort(compareTimeEntries);

  let state: EntrySequenceState = 'clocked_out';
  let previousEntry: TimeEntry | null = null;

  for (const entry of sortedEntries) {
    const at = entry.timestamp;

    switch (entry.entryType) {
      case 'clock_in':
        if (state !== 'clocked_out' && previousEntry?.entryType !== 'break_end') {
          return { valid: false, failure: { error: 'sequence_clock_in_while_open', at } };
        }
        state = 'working';
        break;
      case 'break_start':
        if (state !== 'working') {
          return { valid: false, failure: { error: 'sequence_break_start_not_working', at } };
        }
        state = 'on_break';
        break;
      case 'break_end':
        if (state !== 'on_break') {
          return { valid: false, failure: { error: 'sequence_break_end_not_on_break', at } };
        }
        state = 'working';
        break;
      case 'clock_out':
        if (state === 'clocked_out') {
          return { valid: false, failure: { error: 'sequence_clock_out_while_clocked_out', at } };
        }
        state = 'clocked_out';
        break;
    }

    previousEntry = entry;
  }

  return { valid: true };
}

function buildSimulatedManualEntry(entry: ManualEntryInput, index: number): TimeEntry {
  return {
    id: `manual-simulated-${index}`,
    userId: 'manual-simulated-user',
    organizationId: 'manual-simulated-org',
    entryType: entry.entryType,
    timestamp: entry.timestamp,
    isManual: true,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: entry.timestamp,
    updatedAt: entry.timestamp,
  };
}

function validateSingleManualEntry(
  existingEntries: TimeEntry[],
  newEntry: ManualEntryInput,
): ValidationResult {
  const timestamp = new Date(newEntry.timestamp);
  const dayEntries = getActiveDayEntries(existingEntries, timestamp);
  const sortedDayEntries = getEffectiveTimeEntries(dayEntries).filter(
    (entry) => new Date(entry.timestamp).getTime() < timestamp.getTime(),
  );
  const previousEntry = sortedDayEntries.length > 0 ? sortedDayEntries[sortedDayEntries.length - 1] : null;
  const workSessions = calculateWorkSessions(dayEntries);
  const breakSessions = calculateBreakSessions(dayEntries);
  const beforeTimestamp = new Date(timestamp.getTime() - 1);
  const stateBefore = deriveSequenceStateAtTimestamp(dayEntries, beforeTimestamp);

  if (newEntry.entryType === 'clock_in') {
    const startsInsideOpenTime = stateBefore !== 'clocked_out' && previousEntry?.entryType !== 'break_end';
    if (startsInsideOpenTime && stateBefore === 'on_break') {
      return { valid: false, failure: { error: 'clock_in_during_break' } };
    }
    if (startsInsideOpenTime) return { valid: false, failure: { error: 'clock_in_while_working' } };

    const overlappingWorkSession = isTimestampInsideWorkWindow(workSessions, timestamp, {
      includeOpenSessions: true,
    });
    if (overlappingWorkSession?.clockIn) {
      const window = workWindow(overlappingWorkSession.clockIn, overlappingWorkSession.clockOut);
      return { valid: false, failure: { error: 'clock_in_inside_work', ...window } };
    }

    const overlappingBreakSession = isTimestampInsideBreakWindow(breakSessions, timestamp, {
      includeOpenSessions: true,
    });
    if (overlappingBreakSession) {
      return {
        valid: false,
        failure: { error: 'clock_in_inside_break', ...breakWindow(overlappingBreakSession) },
      };
    }
  }

  if (newEntry.entryType === 'clock_out') {
    if (stateBefore === 'clocked_out') {
      return { valid: false, failure: { error: 'clock_out_without_open_time' } };
    }

    const overlappingClosedWorkSession = isTimestampInsideWorkWindow(workSessions, timestamp);
    if (overlappingClosedWorkSession?.clockIn) {
      const window = workWindow(overlappingClosedWorkSession.clockIn, overlappingClosedWorkSession.clockOut);
      return { valid: false, failure: { error: 'clock_out_inside_closed_work', ...window } };
    }

    const overlappingClosedBreakSession = isTimestampInsideBreakWindow(breakSessions, timestamp);
    if (overlappingClosedBreakSession) {
      const window = breakWindow(overlappingClosedBreakSession);
      return { valid: false, failure: { error: 'clock_out_inside_closed_break', ...window } };
    }
  }

  const simulatedEntries = [...dayEntries, buildSimulatedManualEntry(newEntry, 0)];

  return validateDayEntrySequence(simulatedEntries);
}

/**
 * Check if a new time window (clock_in + clock_out pair) overlaps with any existing session
 * A pair must exist entirely outside existing work windows
 */
function checkWindowOverlap(
  existingSessions: WorkSession[],
  newClockIn: Date,
  newClockOut: Date,
): ValidationResult {
  const newStart = newClockIn.getTime();
  const newEnd = newClockOut.getTime();

  for (const session of existingSessions) {
    // Skip orphan sessions (they don't have a window)
    if (!session.clockIn) continue;

    const sessionStart = new Date(session.clockIn.timestamp).getTime();
    // Current-day open sessions extend to now.
    // Older unclosed sessions are clamped to the end of their own day so they
    // cannot spill into later dates.
    const sessionEnd = session.clockOut
      ? new Date(session.clockOut.timestamp).getTime()
      : isToday(new Date(session.clockIn.timestamp))
        ? Date.now()
        : getLocalDayEnd(new Date(session.clockIn.timestamp)).getTime();

    // Check for any overlap between [newStart, newEnd] and [sessionStart, sessionEnd]
    // Two intervals [a, b] and [c, d] overlap if a < d AND c < b
    if (newStart < sessionEnd && sessionStart < newEnd) {
      return {
        valid: false,
        failure: { error: 'pair_overlaps_work', ...workWindow(session.clockIn, session.clockOut) },
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
function validateManualPair(
  existingEntries: TimeEntry[],
  clockInTimestamp: Date,
  clockOutTimestamp: Date,
): ValidationResult {
  // Validate clock_in is before clock_out
  if (clockInTimestamp.getTime() >= clockOutTimestamp.getTime()) {
    return { valid: false, failure: { error: 'pair_clock_in_not_before_clock_out' } };
  }

  // Check minute-level overlap for both timestamps
  const clockInOverlap = validateSingleEntryNoOverlap(existingEntries, clockInTimestamp);
  if (!clockInOverlap.valid) {
    return clockInOverlap;
  }

  const clockOutOverlap = validateSingleEntryNoOverlap(existingEntries, clockOutTimestamp);
  if (!clockOutOverlap.valid) {
    return clockOutOverlap;
  }

  // Calculate existing work sessions and check window overlap
  const existingSessions = calculateWorkSessions(existingEntries);
  const windowOverlap = checkWindowOverlap(existingSessions, clockInTimestamp, clockOutTimestamp);
  if (!windowOverlap.valid) {
    return windowOverlap;
  }

  const existingBreakSessions = calculateBreakSessions(existingEntries);
  const breakOverlap = validateBreakWindowOverlap(existingBreakSessions, clockInTimestamp, clockOutTimestamp);
  if (!breakOverlap.valid) {
    return breakOverlap;
  }

  const beforeClockIn = new Date(clockInTimestamp.getTime() - 1);
  const stateBeforeClockIn = deriveSequenceStateAtTimestamp(existingEntries, beforeClockIn);
  if (stateBeforeClockIn === 'on_break') {
    return { valid: false, failure: { error: 'pair_start_during_break' } };
  }
  if (stateBeforeClockIn !== 'clocked_out') {
    return { valid: false, failure: { error: 'pair_start_while_working' } };
  }

  const simulatedEntries = [
    ...getActiveDayEntries(existingEntries, clockInTimestamp),
    buildSimulatedManualEntry({ entryType: 'clock_in', timestamp: clockInTimestamp.toISOString() }, 0),
    buildSimulatedManualEntry({ entryType: 'clock_out', timestamp: clockOutTimestamp.toISOString() }, 1),
  ];

  const sequenceValidation = validateDayEntrySequence(simulatedEntries);
  if (!sequenceValidation.valid) {
    return sequenceValidation;
  }

  return { valid: true };
}

function validateManualBreakPair(
  existingEntries: TimeEntry[],
  breakStartTimestamp: Date,
  breakEndTimestamp: Date,
): ValidationResult {
  if (breakStartTimestamp.getTime() >= breakEndTimestamp.getTime()) {
    return { valid: false, failure: { error: 'break_start_not_before_end' } };
  }

  const breakStartOverlap = validateSingleEntryNoOverlap(existingEntries, breakStartTimestamp);
  if (!breakStartOverlap.valid) {
    return breakStartOverlap;
  }

  const breakEndOverlap = validateSingleEntryNoOverlap(existingEntries, breakEndTimestamp);
  if (!breakEndOverlap.valid) {
    return breakEndOverlap;
  }

  const simulatedEntries = [
    ...getActiveDayEntries(existingEntries, breakStartTimestamp),
    buildSimulatedManualEntry({ entryType: 'break_start', timestamp: breakStartTimestamp.toISOString() }, 0),
    buildSimulatedManualEntry({ entryType: 'break_end', timestamp: breakEndTimestamp.toISOString() }, 1),
  ];

  return validateDayEntrySequence(simulatedEntries);
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
  newEntries: ManualEntryInput[],
  options?: { allowFutureTimestamps?: boolean },
): ValidationResult {
  const [firstEntry] = newEntries;
  if (!firstEntry) {
    return { valid: false, failure: { error: 'manual_entries_missing' } };
  }

  const allowFutureTimestamps = options?.allowFutureTimestamps ?? false;

  // Validate timestamps are valid dates and, unless explicitly allowed, not in the future
  for (const entry of newEntries) {
    const ts = new Date(entry.timestamp);
    if (isNaN(ts.getTime())) {
      return { valid: false, failure: { error: 'manual_timestamp_invalid' } };
    }

    // Only admins may create future-dated manual entries.
    if (!allowFutureTimestamps && ts.getTime() > Date.now()) {
      return { valid: false, failure: { error: 'manual_entry_in_future' } };
    }
  }

  const firstEntryDate = new Date(firstEntry.timestamp);
  const allOnSameDay = newEntries.every((entry) => isSameLocalDay(new Date(entry.timestamp), firstEntryDate));

  if (!allOnSameDay) {
    return { valid: false, failure: { error: 'manual_entries_span_days' } };
  }

  const dayEntries = existingEntries.filter((entry) =>
    isSameLocalDay(new Date(entry.timestamp), firstEntryDate),
  );

  // Check if it's a pair (clock_in + clock_out)
  if (newEntries.length === 2) {
    const clockIn = newEntries.find((e) => e.entryType === 'clock_in');
    const clockOut = newEntries.find((e) => e.entryType === 'clock_out');
    const breakStart = newEntries.find((e) => e.entryType === 'break_start');
    const breakEnd = newEntries.find((e) => e.entryType === 'break_end');

    if (clockIn && clockOut) {
      return validateManualPair(dayEntries, new Date(clockIn.timestamp), new Date(clockOut.timestamp));
    }

    if (breakStart && breakEnd) {
      return validateManualBreakPair(
        dayEntries,
        new Date(breakStart.timestamp),
        new Date(breakEnd.timestamp),
      );
    }
  }

  // For single entries - just check minute-level overlap
  for (const entry of newEntries) {
    const ts = new Date(entry.timestamp);
    const overlapResult = validateSingleEntryNoOverlap(dayEntries, ts);
    if (!overlapResult.valid) {
      return overlapResult;
    }

    const sequenceResult = validateSingleManualEntry(dayEntries, entry);
    if (!sequenceResult.valid) {
      return sequenceResult;
    }
  }

  return { valid: true };
}

/**
 * A job can only be attached to entries that start a work block.
 * Standalone clock_out entries never own a job.
 */
export function validateManualEntryJobOwnership(
  newEntries: Array<ManualEntryInput & { jobId?: string | null }>,
): ValidationResult {
  const invalidClockOut = newEntries.find((entry) => entry.entryType === 'clock_out' && !!entry.jobId);

  if (invalidClockOut) {
    return { valid: false, failure: { error: 'job_on_clock_out' } };
  }

  return { valid: true };
}

/**
 * Check if a timestamp update would create an overlap
 */
export function validateTimestampUpdate(
  existingEntries: TimeEntry[],
  entryId: string,
  newTimestamp: Date,
): ValidationResult {
  // Find the entry being updated
  const entryBeingUpdated = existingEntries.find((e) => e.id === entryId);
  if (!entryBeingUpdated) {
    return { valid: false, failure: { error: 'edited_entry_missing' } };
  }

  const relevantEntries = existingEntries.filter(
    (entry) => entry.id !== entryId && isSameLocalDay(new Date(entry.timestamp), newTimestamp),
  );

  // Check minute-level overlap with other entries (excluding the current session)
  const overlapResult = validateSingleEntryNoOverlap(relevantEntries, newTimestamp, entryBeingUpdated);
  if (!overlapResult.valid) {
    return overlapResult;
  }

  // Cannot update to future timestamp
  if (newTimestamp.getTime() > Date.now()) {
    return { valid: false, failure: { error: 'edited_timestamp_in_future' } };
  }

  const simulatedEntries = existingEntries.map((entry) =>
    entry.id === entryId
      ? {
          ...entry,
          timestamp: newTimestamp.toISOString(),
        }
      : entry,
  );

  const affectedDayKeys = new Set([
    formatBerlinLocalDate(new Date(entryBeingUpdated.timestamp)),
    formatBerlinLocalDate(newTimestamp),
  ]);

  for (const dayKey of affectedDayKeys) {
    const dayReference = new Date(`${dayKey}T12:00:00`);
    const dayEntries = getActiveDayEntries(simulatedEntries, dayReference);
    const sequenceResult = validateDayEntrySequence(dayEntries);

    if (!sequenceResult.valid) {
      return sequenceResult;
    }
  }

  return { valid: true };
}

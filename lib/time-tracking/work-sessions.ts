import type { BreakSession, TimeEntry, WorkSession } from './types';
import { formatBerlinLocalDate, isSameLocalDay } from '@/lib/date-time/berlin';
import { getEffectiveTimeEntries } from './effective-entries';
import { isBreakEndFollowedByClockIn } from './transition-pairs';

// Work and break sessions paired from a person's entries, for the calendar,
// the clock and the week totals; validation.ts checks new entries against them.

/** Whether the instant falls on today's Berlin day; the server runs in UTC. */
export function isToday(date: Date): boolean {
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
 * The Berlin date an entry counts on. A clock-out counts on the day of the
 * instant before it, so one at exactly midnight closes the day it ends: the
 * split at midnight closes each day's slice there
 * (`splitSegmentAtLocalDayBoundaries`). Every other entry counts on its own date.
 */
export function entryLocalDate(entry: Pick<TimeEntry, 'entryType' | 'timestamp'>): string {
  const instant = Date.parse(entry.timestamp);
  return formatBerlinLocalDate(new Date(entry.entryType === 'clock_out' ? instant - 1 : instant));
}

/** Whether an end counts on the same Berlin day as the start it would close. */
function closesOnStartDay(start: TimeEntry, end: TimeEntry): boolean {
  return entryLocalDate(start) === entryLocalDate(end);
}

/** A work start that no end closes on its own day: open while it is today's, otherwise an orphan. */
function unpairedWorkStartSession(startEntry: TimeEntry, isOrphan: boolean): WorkSession {
  return {
    clockIn: startEntry,
    clockOut: null,
    durationMinutes: null,
    jobId: startEntry.jobId,
    startEntryType: startEntry.entryType === 'break_end' ? 'break_end' : 'clock_in',
    endEntryType: null,
    isOrphan,
    pendingState: determinePendingState(startEntry, null),
  };
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

    sessions.push(unpairedWorkStartSession(startEntry, !isOpenSession));
  };

  for (let index = 0; index < activeEntries.length; index += 1) {
    const entry = activeEntries[index];
    if (!entry) continue;
    if (currentWorkStart && !closesOnStartDay(currentWorkStart, entry)) {
      sessions.push(unpairedWorkStartSession(currentWorkStart, true));
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
      if (currentWorkStart && closesOnStartDay(currentWorkStart, entry)) {
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
    if (currentBreakStart && !closesOnStartDay(currentBreakStart, entry)) {
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

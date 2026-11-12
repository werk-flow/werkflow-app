'use client';

import { timeActivitySelectionSchema } from '@/lib/time-tracking/activity-selection-schema';
import type { LiveClockState } from '@/lib/time-tracking/types';
import { z } from '@/lib/zod';
import { STORED_RECORD_VERSION } from './stored-clock-facts';

// The stored formats of the time outbox (decision record 0010, the time
// outbox's invariant 8): what a phone writes of a clock action and of the
// clock it stands on. They are their own formats, not the live clock's type,
// because a record outlives the release that wrote it: a time event can wait
// on a phone for days. Reading ignores fields it does not know, so an added
// field never makes a record unreadable. A change that removes or reinterprets
// a field raises the record's `version` and adds a reader for the earlier one;
// a record of a version this code does not know is a stop (kept-clock-actions.ts,
// time-outbox-store.ts). The golden records in stored-records.test.ts pin it.

/** The record's version; one this code does not know fails the parse. */
export const storedVersionSchema = z.literal(STORED_RECORD_VERSION);

const minutes = z.number();
const text = z.string();

/** The clock the server last confirmed, as a phone stores it: without job, customer and project names. */
const storedClockFactsSchema = z.object({
  organizationId: text,
  breakPolicy: z.object({
    breakMode: z.enum(['manual', 'automatic']),
    autoBreakThresholdMinutes: minutes,
    autoBreakDurationMinutes: minutes,
  }),
  status: z.enum(['clocked_out', 'working', 'on_break']),
  isClockedIn: z.boolean(),
  isOnBreak: z.boolean(),
  clockInTime: text.nullable(),
  statusStartedAt: text.nullable(),
  breakStartTime: text.nullable(),
  todayMinutes: minutes,
  workMinutes: minutes,
  breakMinutes: minutes,
  standbyMinutes: minutes,
  travelMinutes: minutes,
  calloutMinutes: minutes,
  internalMinutes: minutes,
  timelineSegments: z.array(z.object({ type: z.enum(['work', 'break']), minutes })),
  activeJobId: text.nullable(),
  captureModel: z.enum(['canonical', 'legacy', 'none']),
  sessionId: text.nullable(),
  sessionVersion: z.number().nullable(),
  currentSegmentId: text.nullable(),
  // A selection stays strict, unlike the record around it: it becomes a command (the resumed
  // activity after a break), and dropping a field there could send another action. A selection
  // with a field this code does not know is a stop.
  currentActivity: timeActivitySelectionSchema.nullable(),
  resumeActivity: timeActivitySelectionSchema.nullable(),
  recoveryReason: text.nullable(),
  legacyOpen: z.boolean(),
  fetchedAt: text,
});

export type StoredClockFacts = z.infer<typeof storedClockFactsSchema>;

/** The stored clock as the live clock the outbox applies its events to; names stay empty until the server's next read. */
function liveClockOf(stored: StoredClockFacts): LiveClockState {
  return { ...stored, activeJobInfo: null, resumeJobInfo: null };
}

/** Reads a stored clock into the live clock. */
export const storedClockSchema = storedClockFactsSchema.transform(liveClockOf);

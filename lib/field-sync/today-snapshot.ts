import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The today snapshot of field sync v1 (decision record 0010): the caller's own
// job visits on the current Berlin day, with the facts the field work pack
// shows before work starts: place, access, contact, scope and instructions.
// It is the one shape the server sends and the device stores; a native client
// reads the same JSON. A field leaves or changes meaning only in `/v2/`.

/** The address of the today snapshot; the device reads nothing else of field sync v1. */
export const FIELD_SYNC_TODAY_PATH = '/api/field-sync/v1/today';

const nullableText = z.string().nullable();

const instructionSchema = z.strictObject({
  id: uuidSchema,
  content: z.string(),
  groupLabel: nullableText,
  notes: nullableText,
  required: z.boolean(),
  done: z.boolean(),
});

/** One planned visit of the day; an all-day visit has no times. */
const visitSchema = z.strictObject({
  startAt: z.iso.datetime({ offset: true }).nullable(),
  endAt: z.iso.datetime({ offset: true }).nullable(),
});

const assignmentSchema = z.strictObject({
  jobId: uuidSchema,
  jobNumber: nullableText,
  title: z.string(),
  requestedOutcome: nullableText,
  plannedWorkingMinutes: z.number().int().nullable(),
  visits: z.array(visitSchema).min(1),
  customerName: nullableText,
  customerPhone: nullableText,
  siteName: nullableText,
  siteAddress: nullableText,
  accessNotes: nullableText,
  contactName: nullableText,
  contactRole: nullableText,
  contactPhone: nullableText,
  project: z.strictObject({ name: z.string(), projectNumber: z.string() }).nullable(),
  instructions: z.array(instructionSchema),
});

export const fieldSyncTodaySchema = z.strictObject({
  /** Changes whenever any value below changes; the response's ETag carries it too. */
  version: z.string().min(1),
  berlinDate: z.iso.date(),
  /** The next Berlin midnight: from then on a device deletes this snapshot unread. */
  validUntil: z.iso.datetime({ offset: true }),
  userId: uuidSchema,
  organizationId: uuidSchema,
  assignments: z.array(assignmentSchema),
});

export type FieldSyncToday = z.infer<typeof fieldSyncTodaySchema>;
export type FieldSyncTodayAssignment = FieldSyncToday['assignments'][number];

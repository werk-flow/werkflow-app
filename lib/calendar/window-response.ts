import { z } from 'zod';
import { holidayRegionHistoryEntrySchema } from '@/lib/personnel/targets';
import type { CalendarWindowResult } from './actions';

const text = z.string();
const nullableText = text.nullable();
const reviewStatus = z.enum(['pending', 'approved', 'rejected']);
const timeEntry = z.object({
  id: text, userId: text, organizationId: text, entryType: z.enum(['clock_in', 'clock_out', 'break_start', 'break_end']), timestamp: text,
  isManual: z.boolean(), jobId: nullableText,
  status: z.enum(['pending', 'approved', 'rejected', 'pending_delete']),
  reviewedBy: nullableText, reviewedAt: nullableText, createdAt: text, updatedAt: text,
  activityKind: z.enum(['work', 'travel', 'break', 'standby', 'callout', 'internal_activity']).optional(),
  canonicalSegmentId: text.optional(), sourceKind: z.enum(['legacy_entry', 'canonical_segment', 'correction_application']).optional(),
  sourceVersion: text.optional(), correctionApplicationId: text.optional(), correctionSourceFingerprint: text.optional(),
  pendingCorrectionRequestId: text.optional(),
  pendingCorrectionKind: z.enum(['add', 'edit', 'delete', 'split', 'reclassify', 'reallocate', 'reassign', 'missed_clock']).optional(),
  isProvisionalCorrection: z.boolean().optional(),
});
const job = z.object({
  id: text, occurrenceId: text.optional(), jobId: nullableText.optional(), seriesId: nullableText.optional(),
  seriesLineageId: nullableText.optional(), entryKind: z.enum(['job_visit', 'internal']).optional(),
  internalType: z.enum(['internal_work', 'meeting', 'training', 'other']).nullable().optional(),
  timeKind: z.enum(['timed', 'all_day']).optional(), startAt: nullableText.optional(), endAt: nullableText.optional(),
  endDateExclusive: nullableText.optional(), isException: z.boolean().optional(),
  version: z.number().optional(), executionVersion: z.number().optional(),
  occurrenceStatus: z.enum(['scheduled', 'skipped', 'cancelled']).optional(), assignedEmployeeRecordIds: z.array(text).optional(),
  jobNumber: nullableText, title: text, status: z.enum(['nicht_bearbeitet', 'in_bearbeitung', 'fertig', 'geparkt']),
  priority: z.enum(['niedrig', 'mittel', 'hoch']), plannedDate: nullableText, plannedTime: nullableText,
  estimatedDurationMinutes: z.number().nullable(), plannedWorkingMinutes: z.number().nullable(),
  location: nullableText, clientName: nullableText, clientAddress: nullableText,
  projectName: nullableText, projectNumber: nullableText, assignedUserIds: z.array(text),
});
const changeRequest = z.object({
  id: text, entryId: text, pairedEntryId: nullableText, organizationId: text, requestedBy: text,
  changeType: z.enum(['edit', 'delete']), proposedTimestamp: nullableText, originalTimestamp: nullableText,
  status: reviewStatus, reviewedBy: nullableText, reviewedAt: nullableText, createdAt: text, updatedAt: text,
});
const absence = z.object({ id: text, personName: text, startDate: text, endDate: text, dayPortion: z.enum(['full', 'half_day']) });

/** Validate transported fields before calendar components consume JSON. */
export const calendarWindowResponseSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(false), error: text }),
  z.object({
    holidays: z.object({ holidayRegion: nullableText, holidayRegionHistory: z.array(holidayRegionHistoryEntrySchema), closureDays: z.array(z.object({ id: text.optional(), closureDate: text, label: nullableText })) }),
    success: z.literal(true), entries: z.array(timeEntry), jobs: z.array(job),
    changeRequestMap: z.record(text, changeRequest),
    vacation: z.array(absence.extend({ status: z.enum(['approved', 'pending']) })),
    sickness: z.array(absence.extend({ openEnded: z.boolean() })),
  }),
]) satisfies z.ZodType<CalendarWindowResult>;

import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';

const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

const assignmentSchema = z.object({
  employeeRecordId: uuidSchema,
  teamSourceId: uuidSchema.nullable().default(null),
});

export const planningIdSchema = uuidSchema;

const baseEntrySchema = z
  .object({
    entryKind: z.enum(['job_visit', 'internal']),
    internalType: z
      .enum(['internal_work', 'meeting', 'training', 'other'])
      .nullable(),
    jobId: uuidSchema.nullable(),
    title: z.string().trim().max(160).nullable(),
    description: z.string().trim().max(4000).nullable(),
    location: z.string().trim().max(500).nullable(),
    timeKind: z.enum(['timed', 'all_day']),
    startsAtLocal: localDateTimeSchema,
    durationMinutes: z.number().int().min(15).max(10_080).nullable(),
    durationDays: z.number().int().min(1).max(31).nullable(),
    assignmentDrafts: z
      .array(assignmentSchema)
      .max(100)
      .refine(
        (drafts) =>
          new Set(drafts.map((draft) => draft.employeeRecordId)).size ===
          drafts.length,
        { message: 'Eine Person darf nur einmal zugewiesen werden.' }
      ),
    teamIds: z
      .array(uuidSchema)
      .max(50)
      .transform((ids) => [...new Set(ids)])
      .default([]),
    overrideReason: z.string().trim().min(8).max(1000).nullable(),
    assessmentFingerprint: z.string().length(64).nullable(),
  })
  .superRefine((value, context) => {
    if (value.entryKind === 'job_visit' && !value.jobId) {
      context.addIssue({
        code: 'custom',
        path: ['jobId'],
        message: 'Ein Auftragsbesuch benötigt einen Auftrag.',
      });
    }
    if (
      value.entryKind === 'job_visit' &&
      (value.internalType || value.title || value.description || value.location)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['entryKind'],
        message:
          'Auftragsbesuche verwenden die Angaben des verknüpften Auftrags.',
      });
    }
    if (value.entryKind === 'internal' && (!value.internalType || !value.title)) {
      context.addIssue({
        code: 'custom',
        path: ['title'],
        message: 'Ein interner Termin benötigt Typ und Titel.',
      });
    }
    if (value.timeKind === 'timed' && !value.durationMinutes) {
      context.addIssue({
        code: 'custom',
        path: ['durationMinutes'],
        message: 'Bitte eine Dauer angeben.',
      });
    }
    if (value.timeKind === 'all_day' && !value.durationDays) {
      context.addIssue({
        code: 'custom',
        path: ['durationDays'],
        message: 'Bitte die Anzahl der Tage angeben.',
      });
    }
  });

export const createPlanningEntrySchema = baseEntrySchema.and(
  z
    .object({
      idempotencyKey: uuidSchema,
      recurrence: z
        .object({
          frequency: z.enum(['daily', 'weekly', 'monthly']),
          interval: z.number().int().min(1).max(12),
          weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullable(),
          monthDay: z.number().int().min(1).max(31).nullable(),
          occurrenceCount: z.number().int().min(2).max(730).nullable(),
          untilLocalDate: z.string().date().nullable(),
        })
        .nullable(),
    })
    .superRefine((value, context) => {
      if (
        value.recurrence &&
        !value.recurrence.occurrenceCount &&
        !value.recurrence.untilLocalDate
      ) {
        context.addIssue({
          code: 'custom',
          path: ['recurrence'],
          message: 'Die Wiederholung benötigt ein Ende.',
        });
      }
      if (
        value.recurrence?.frequency === 'weekly' &&
        !value.recurrence.weekdays?.length
      ) {
        context.addIssue({
          code: 'custom',
          path: ['recurrence', 'weekdays'],
          message: 'Bitte mindestens einen Wochentag auswählen.',
        });
      }
      if (
        value.recurrence?.frequency === 'monthly' &&
        !value.recurrence.monthDay
      ) {
        context.addIssue({
          code: 'custom',
          path: ['recurrence', 'monthDay'],
          message: 'Bitte einen Monatstag angeben.',
        });
      }
    })
).superRefine((value, context) => {
  if (!value.recurrence?.untilLocalDate) return;
  const startDate = value.startsAtLocal.slice(0, 10);
  const startTimestamp = Date.parse(`${startDate}T00:00:00Z`);
  const untilTimestamp = Date.parse(
    `${value.recurrence.untilLocalDate}T00:00:00Z`
  );
  const dayDifference = (untilTimestamp - startTimestamp) / 86_400_000;
  if (dayDifference < 0 || dayDifference > 731) {
    context.addIssue({
      code: 'custom',
      path: ['recurrence', 'untilLocalDate'],
      message:
        'Das Serienende muss zwischen dem Startdatum und zwei Jahren danach liegen.',
    });
  }
});

export const updatePlanningOccurrenceSchema = baseEntrySchema.and(
  z.object({
    occurrenceId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    scope: z.enum(['one', 'future', 'series']),
  })
);

export const updatePlanningCalendarSchema = z
  .object({
    plannedDate: z.string().date().optional(),
    plannedTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    estimatedDurationMinutes: z.number().int().min(15).max(10_080).nullable().optional(),
    selectedUserIds: z.array(uuidSchema).max(100).optional(),
    selectedEmployeeRecordIds: z.array(uuidSchema).max(100).optional(),
    overrideReason: z.string().trim().min(8).max(1000).nullable().optional(),
    assessmentFingerprint: z.string().length(64).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.selectedUserIds && value.selectedEmployeeRecordIds) {
      context.addIssue({
        code: 'custom',
        path: ['selectedEmployeeRecordIds'],
        message: 'Zuweisungen dürfen nur eine Identitätsart verwenden.',
      });
    }
  });

export const planningOccurrenceStatusSchema = z.object({
  occurrenceId: uuidSchema,
  status: z.enum(['skipped', 'cancelled']),
  reason: z.string().trim().min(8).max(1000),
});

export type CreatePlanningEntryInput = z.infer<
  typeof createPlanningEntrySchema
>;
export type UpdatePlanningOccurrenceInput = z.infer<
  typeof updatePlanningOccurrenceSchema
>;

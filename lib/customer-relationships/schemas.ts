import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';

const optionalText = (maximumLength: number) =>
  z
    .string()
    .trim()
    .max(maximumLength)
    .transform((value) => value || undefined)
    .optional();

export const followUpInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    note: optionalText(2000),
    ownerUserId: uuidSchema,
    dueAt: z.iso.datetime({ offset: true }),
    sourceType: z
      .enum([
        'contact',
        'site',
        'request',
        'job',
        'project',
        'service_case',
        'maintenance_coverage',
      ])
      .optional(),
    sourceId: uuidSchema.optional(),
    reason: optionalText(2000),
  })
  .strict()
  .refine(
    (input) => Boolean(input.sourceType) === Boolean(input.sourceId),
    { message: 'source_invalid' }
  );

export const followUpTransitionSchema = z
  .object({
    targetStatus: z.enum(['open', 'completed', 'cancelled']),
    resolutionNote: optionalText(2000),
    reason: optionalText(2000),
  })
  .strict();

export const communicationSettingsInputSchema = z
  .object({
    preferredContactId: uuidSchema.optional(),
    preferredChannel: z
      .enum(['phone', 'email', 'sms', 'letter', 'in_person'])
      .optional(),
    doNotContactInstruction: optionalText(2000),
    contactTimeNote: optionalText(1000),
    languageNote: optionalText(200),
    accessibilityNote: optionalText(1000),
    sourceNote: optionalText(1000),
  })
  .strict();

export const communicationPreferenceInputSchema = z
  .object({
    contactId: uuidSchema.optional(),
    channel: z.enum(['phone', 'email', 'sms', 'letter', 'in_person']),
    purpose: z.enum([
      'appointment_service',
      'marketing',
      'commercial_required',
    ]),
    state: z.enum(['allowed', 'disallowed', 'unknown']),
    sourceNote: optionalText(1000),
  })
  .strict();

export const communicationGuidanceInputSchema = z
  .object({
    contactId: uuidSchema.nullable(),
    channel: z.enum(['phone', 'email', 'sms', 'letter', 'in_person']),
    purpose: z.enum([
      'appointment_service',
      'marketing',
      'commercial_required',
    ]),
  })
  .strict();

export const communicationExceptionInputSchema =
  communicationGuidanceInputSchema.extend({
    reason: z.string().trim().min(1).max(1000),
  });

export type FollowUpInput = z.infer<typeof followUpInputSchema>;

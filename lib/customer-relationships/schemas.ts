import { z } from 'zod';

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
    ownerUserId: z.uuid(),
    dueAt: z.iso.datetime({ offset: true }),
    sourceType: z
      .enum(['contact', 'site', 'request', 'job', 'project'])
      .optional(),
    sourceId: z.uuid().optional(),
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
    preferredContactId: z.uuid().optional(),
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
    contactId: z.uuid().optional(),
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
    contactId: z.uuid().nullable(),
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

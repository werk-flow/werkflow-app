'use server';

import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { timeActivitySelectionSchema as selectionSchema } from './activity-selection-schema';

import { resolveActionContextFor } from '@/lib/org/action-context';
import { recordTimeTransition } from './transition-core';
import type { TimeTransitionResult } from './types';

const transitionSchema = z.object({
  organizationId: uuidSchema,
  operationId: uuidSchema,
  action: z.enum([
    'start',
    'switch',
    'end',
    'continue_legacy',
    'end_legacy',
    'recover_continue',
    'recover_end',
  ]),
  expectedSessionId: uuidSchema.nullable(),
  expectedVersion: z.number().int().positive().nullable(),
  selection: selectionSchema.nullable(),
  acknowledgeLong: z.boolean(),
});

export type TimeTransitionInput = z.infer<typeof transitionSchema>;

/** An online clock transition: recorded at the server's time. */
export async function transitionTimeActivity(rawInput: TimeTransitionInput): Promise<TimeTransitionResult> {
  const parsed = transitionSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { organizationId, ...command } = parsed.data;
  const caller = await resolveActionContextFor(organizationId);
  if (!caller.success) return caller;
  return recordTimeTransition({ userId: caller.context.userId, organizationId }, command, null);
}

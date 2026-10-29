'use server';

import { normalizeOptionalText, boundedText } from '@/lib/validation/text';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import {
  isParsableIsoDate,
  personnelWriteFailure,
  requirePersonnelManager,
  type UpdatePersonnelResult,
} from '@/lib/personnel/record-writes';

const workScheduleSchema = z.object({
  validFrom: boundedText(10),
  dayMinutes: z.array(z.number()).max(7),
  note: boundedText(2000).nullable().default(null),
});

// ============================================
// Work Schedules (date-effective weekly patterns, P1-04)
// ============================================

export type WorkScheduleInput = {
  validFrom: string;
  /** Minutes per weekday, index 0 = Montag … 6 = Sonntag. */
  dayMinutes: number[];
  note?: string | null;
};

function validateScheduleInput(input: WorkScheduleInput): string | null {
  if (!input.validFrom || !isParsableIsoDate(input.validFrom)) {
    return 'invalid_valid_from';
  }
  if (!Array.isArray(input.dayMinutes) || input.dayMinutes.length !== 7) {
    return 'invalid_day_minutes';
  }
  for (const minutes of input.dayMinutes) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
      return 'invalid_day_minutes';
    }
  }
  return null;
}

export async function addWorkSchedule(
  recordIdInput: string,
  rawInput: WorkScheduleInput,
): Promise<UpdatePersonnelResult> {
  const parsedInput = workScheduleSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const parsedRecordId = uuidSchema.safeParse(recordIdInput);
  if (!parsedRecordId.success) return { success: false, error: 'invalid_input' };
  const recordId = parsedRecordId.data;
  try {
    const guard = await requirePersonnelManager();
    if (!guard.success) return guard;
    const { orgId, userId } = guard.context;

    const validationError = validateScheduleInput(input);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // One call checks the record under lock, adds the schedule and records
    // its 'schedule_added' history row.
    const { error } = await createSupabaseAdminClient().rpc(
      'add_work_schedule',
      rpcArgs('add_work_schedule', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_record_id: recordId,
        p_valid_from: input.validFrom,
        p_day_minutes: input.dayMinutes,
        p_note: normalizeOptionalText(input.note),
      }),
    );
    if (error) return personnelWriteFailure(error, 'create_failed', 'Failed to add work schedule:');

    return { success: true };
  } catch (error) {
    logError('Unexpected error in addWorkSchedule:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateWorkSchedule(
  scheduleIdInput: string,
  rawInput: WorkScheduleInput,
): Promise<UpdatePersonnelResult> {
  const parsedInput = workScheduleSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const parsedScheduleId = uuidSchema.safeParse(scheduleIdInput);
  if (!parsedScheduleId.success) return { success: false, error: 'invalid_input' };
  const scheduleId = parsedScheduleId.data;
  try {
    const guard = await requirePersonnelManager();
    if (!guard.success) return guard;
    const { orgId, userId } = guard.context;

    const validationError = validateScheduleInput(input);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // Corrections stay traceable: one call corrects the schedule under lock
    // and records 'schedule_updated' with the full before and after.
    const { error } = await createSupabaseAdminClient().rpc(
      'update_work_schedule',
      rpcArgs('update_work_schedule', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_schedule_id: scheduleId,
        p_valid_from: input.validFrom,
        p_day_minutes: input.dayMinutes,
        p_note: normalizeOptionalText(input.note),
      }),
    );
    if (error) return personnelWriteFailure(error, 'update_failed', 'Failed to update work schedule:');

    return { success: true };
  } catch (error) {
    logError('Unexpected error in updateWorkSchedule:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function deleteWorkSchedule(scheduleIdInput: string): Promise<UpdatePersonnelResult> {
  const parsedScheduleId = uuidSchema.safeParse(scheduleIdInput);
  if (!parsedScheduleId.success) return { success: false, error: 'invalid_input' };
  const scheduleId = parsedScheduleId.data;
  try {
    const guard = await requirePersonnelManager();
    if (!guard.success) return guard;
    const { orgId, userId } = guard.context;

    // One call deletes the schedule and records 'schedule_deleted' with the
    // deleted version.
    const { error } = await createSupabaseAdminClient().rpc(
      'delete_work_schedule',
      rpcArgs('delete_work_schedule', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_schedule_id: scheduleId,
      }),
    );
    if (error) return personnelWriteFailure(error, 'delete_failed', 'Failed to delete work schedule:');

    return { success: true };
  } catch (error) {
    logError('Unexpected error in deleteWorkSchedule:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

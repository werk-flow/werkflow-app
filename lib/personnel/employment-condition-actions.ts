'use server';

import { normalizeOptionalText, boundedText } from '@/lib/validation/text';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { EMPLOYMENT_TYPES, type EmploymentType } from '@/lib/personnel/types';
import {
  isParsableIsoDate,
  personnelWriteFailure,
  requirePersonnelManager,
  type UpdatePersonnelResult,
} from '@/lib/personnel/record-writes';

const employmentConditionSchema = z.object({
  validFrom: boundedText(10),
  employmentType: z.enum(['vollzeit', 'teilzeit', 'ausbildung', 'minijob', 'sonstiges']),
  weeklyHours: z.number().nullable().default(null),
  vacationDaysPerYear: z.number().nullable().default(null),
  note: boundedText(2000).nullable().default(null),
});

// ============================================
// Employment Conditions (date-effective versions)
// ============================================

export type EmploymentConditionInput = {
  validFrom: string;
  employmentType: EmploymentType;
  weeklyHours?: number | null;
  vacationDaysPerYear?: number | null;
  note?: string | null;
};

function validateConditionInput(input: EmploymentConditionInput): string | null {
  if (!input.validFrom || !isParsableIsoDate(input.validFrom)) {
    return 'invalid_valid_from';
  }
  if (!EMPLOYMENT_TYPES.includes(input.employmentType)) {
    return 'invalid_employment_type';
  }
  if (
    input.weeklyHours !== undefined &&
    input.weeklyHours !== null &&
    (Number.isNaN(input.weeklyHours) || input.weeklyHours < 0 || input.weeklyHours > 100)
  ) {
    return 'invalid_weekly_hours';
  }
  if (
    input.vacationDaysPerYear !== undefined &&
    input.vacationDaysPerYear !== null &&
    (Number.isNaN(input.vacationDaysPerYear) ||
      input.vacationDaysPerYear < 0 ||
      input.vacationDaysPerYear > 100)
  ) {
    return 'invalid_vacation_days';
  }
  return null;
}

export async function addEmploymentCondition(
  recordIdInput: string,
  rawInput: EmploymentConditionInput,
): Promise<UpdatePersonnelResult> {
  const parsedInput = employmentConditionSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const parsedRecordId = uuidSchema.safeParse(recordIdInput);
  if (!parsedRecordId.success) return { success: false, error: 'invalid_input' };
  const recordId = parsedRecordId.data;
  try {
    const guard = await requirePersonnelManager();
    if (!guard.success) return guard;
    const { orgId, userId } = guard.context;

    const validationError = validateConditionInput(input);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // One call checks the record under lock, adds the condition and records
    // its 'condition_added' history row.
    const { error } = await createSupabaseAdminClient().rpc(
      'add_employment_condition',
      rpcArgs('add_employment_condition', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_record_id: recordId,
        p_valid_from: input.validFrom,
        p_employment_type: input.employmentType,
        p_weekly_hours: input.weeklyHours ?? null,
        p_vacation_days_per_year: input.vacationDaysPerYear ?? null,
        p_note: normalizeOptionalText(input.note),
      }),
    );
    if (error) return personnelWriteFailure(error, 'create_failed', 'Failed to add employment condition:');

    return { success: true };
  } catch (error) {
    logError('Unexpected error in addEmploymentCondition:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateEmploymentCondition(
  conditionIdInput: string,
  rawInput: EmploymentConditionInput,
): Promise<UpdatePersonnelResult> {
  const parsedInput = employmentConditionSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const parsedConditionId = uuidSchema.safeParse(conditionIdInput);
  if (!parsedConditionId.success) return { success: false, error: 'invalid_input' };
  const conditionId = parsedConditionId.data;
  try {
    const guard = await requirePersonnelManager();
    if (!guard.success) return guard;
    const { orgId, userId } = guard.context;

    const validationError = validateConditionInput(input);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // Corrections stay traceable: one call corrects the condition under lock
    // and records 'condition_updated' with the full before and after.
    const { error } = await createSupabaseAdminClient().rpc(
      'update_employment_condition',
      rpcArgs('update_employment_condition', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_condition_id: conditionId,
        p_valid_from: input.validFrom,
        p_employment_type: input.employmentType,
        p_weekly_hours: input.weeklyHours ?? null,
        p_vacation_days_per_year: input.vacationDaysPerYear ?? null,
        p_note: normalizeOptionalText(input.note),
      }),
    );
    if (error) return personnelWriteFailure(error, 'update_failed', 'Failed to update employment condition:');

    return { success: true };
  } catch (error) {
    logError('Unexpected error in updateEmploymentCondition:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function deleteEmploymentCondition(conditionIdInput: string): Promise<UpdatePersonnelResult> {
  const parsedConditionId = uuidSchema.safeParse(conditionIdInput);
  if (!parsedConditionId.success) return { success: false, error: 'invalid_input' };
  const conditionId = parsedConditionId.data;
  try {
    const guard = await requirePersonnelManager();
    if (!guard.success) return guard;
    const { orgId, userId } = guard.context;

    // One call deletes the condition and records 'condition_deleted' with the
    // deleted values.
    const { error } = await createSupabaseAdminClient().rpc(
      'delete_employment_condition',
      rpcArgs('delete_employment_condition', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_condition_id: conditionId,
      }),
    );
    if (error) return personnelWriteFailure(error, 'delete_failed', 'Failed to delete employment condition:');

    return { success: true };
  } catch (error) {
    logError('Unexpected error in deleteEmploymentCondition:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

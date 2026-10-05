'use server';

import { logReadFailure } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { boundedText, normalizeOptionalText, nullableBoundedText } from '@/lib/validation/text';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import type { InviteRole } from '@/lib/invites/actions';
import { createAndMailOrganizationInvite } from '@/lib/invites/send-invite';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { formatProfileName } from '@/lib/members/profile-name';
import {
  EMPLOYMENT_TYPES,
  getBusinessTodayIso,
  toEmployeeRecord,
  toEmploymentCondition,
  toEmployeeRecordEvent,
  type EmployeeRecord,
  type EmployeeRecordEvent,
  type EmploymentCondition,
  type EmploymentType,
} from '@/lib/personnel/types';
import { toWorkSchedule, type WorkSchedule } from '@/lib/personnel/schedule';
import { logError } from '@/lib/logging';
import { recordEmployeeRecordEvent } from '@/lib/personnel/employee-record-events';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import type { ActionFailure } from '@/lib/action-result';

// Boundary schemas: types, ids and bounds. The value rules below keep their
// own error codes for the forms.
const createPersonnelRecordSchema = z.object({
  firstName: boundedText(200).optional(),
  lastName: boundedText(200),
  employeeNumber: boundedText(100).optional(),
  entryDate: boundedText(10).optional(),
  notes: boundedText(5000).optional(),
});
const masterDataPatchSchema = z.strictObject({
  employeeNumber: nullableBoundedText(100),
  firstName: nullableBoundedText(200),
  lastName: nullableBoundedText(200),
  phone: nullableBoundedText(100),
  privateEmail: nullableBoundedText(320),
  street: nullableBoundedText(300),
  postalCode: nullableBoundedText(20),
  city: nullableBoundedText(200),
  emergencyContactName: nullableBoundedText(200),
  emergencyContactPhone: nullableBoundedText(100),
  entryDate: nullableBoundedText(10),
  exitDate: nullableBoundedText(10),
  notes: nullableBoundedText(5000),
});
const employmentConditionSchema = z.object({
  validFrom: boundedText(10),
  employmentType: z.enum(['vollzeit', 'teilzeit', 'ausbildung', 'minijob', 'sonstiges']),
  weeklyHours: z.number().nullable().default(null),
  vacationDaysPerYear: z.number().nullable().default(null),
  note: boundedText(2000).nullable().default(null),
});
const workScheduleSchema = z.object({
  validFrom: boundedText(10),
  dayMinutes: z.array(z.number()).max(7),
  note: boundedText(2000).nullable().default(null),
});
const inviteEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));
const inviteRoleInputSchema = z.enum(['buero', 'employee']);

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isParsableIsoDate(value: string): boolean {
  return ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

// The refusals of the personnel write functions (migration
// 20261004190100_write_personnel_history_with_its_change.sql), each an action
// failure code. Each function writes the change and its history row together
// or refuses and changes nothing.
const PERSONNEL_WRITE_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_input',
  'not_authorized',
  'record_not_found',
  'condition_not_found',
  'schedule_not_found',
  'number_taken',
  'exit_before_entry',
  'name_managed_by_profile',
  'duplicate_valid_from',
]);

// The refusal raised under the lock, or the action's own failure code for
// anything else.
function personnelWriteFailure(
  error: { message: string } | null,
  failureCode: string,
  logLabel: string,
): ActionFailure {
  if (error && PERSONNEL_WRITE_REFUSALS.has(error.message)) return { success: false, error: error.message };
  logError(logLabel, error);
  return { success: false, error: failureCode };
}

/** Identity, active organization and the manager role, for the personnel writes. */
async function requirePersonnelManager(): Promise<
  { success: true; context: { orgId: string; userId: string } } | ActionFailure
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { orgId, userId, isManagerOrAbove } = auth.context;
  if (!isManagerOrAbove) return { success: false, error: 'not_authorized' };
  return { success: true, context: { orgId, userId } };
}

async function requireManagerAndRecord(recordId: string): Promise<
  | {
      success: true;
      context: { orgId: string; userId: string; admin: AdminClient };
      record: EmployeeRecord;
    }
  | ActionFailure
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { orgId, userId, isManagerOrAbove } = auth.context;

  if (!isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('employee_records')
    .select('*')
    .eq('id', recordId)
    .eq('organization_id', orgId)
    .single();

  if (error || !data) {
    return { success: false, error: 'record_not_found' };
  }

  return {
    success: true,
    context: { orgId, userId, admin },
    record: toEmployeeRecord(data),
  };
}

// ============================================
// Read Helpers (server components)
// ============================================

export type PersonnelListEntry = {
  record: EmployeeRecord;
  hasPendingInvite: boolean;
  currentCondition: EmploymentCondition | null;
};

/**
 * All personnel records of the active organization for the manager list,
 * including the pending-invite flag for the access state and each record's
 * currently effective condition.
 */
export async function getPersonnelRecords(): Promise<
  { success: true; entries: PersonnelListEntry[] } | ActionFailure
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();
    const [recordsResult, conditionsResult] = await Promise.all([
      readCompleteRows(
        (from, to) =>
          admin
            .from('employee_records')
            .select('*, organization_invites(status)')
            .eq('organization_id', orgId)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
      readCompleteRows(
        (from, to) =>
          admin
            .from('employment_conditions')
            .select('*')
            .eq('organization_id', orgId)
            // Same Europe/Berlin business date the derived states use — a UTC
            // date here would disagree with them around midnight.
            .lte('valid_from', getBusinessTodayIso())
            .order('valid_from', { ascending: false })
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ]);

    // Missing conditions would render as "no condition" for real employees, so both reads must be complete.
    const loadError = recordsResult.error ?? conditionsResult.error;
    if (loadError) {
      logReadFailure('getPersonnelRecords: employee records or conditions failed', loadError);
      return { success: false, error: 'load_failed' };
    }

    const currentConditionByRecord = new Map<string, EmploymentCondition>();
    for (const row of conditionsResult.data) {
      if (!currentConditionByRecord.has(row.employee_record_id)) {
        currentConditionByRecord.set(row.employee_record_id, toEmploymentCondition(row));
      }
    }

    const entries: PersonnelListEntry[] = recordsResult.data.map((row) => {
      // supabase-js types embedded to-one relations inconsistently; accept
      // both the object and single-element-array shapes.
      const rawInvite = row.organization_invites as unknown;
      const invite = (Array.isArray(rawInvite) ? (rawInvite[0] ?? null) : rawInvite) as {
        status: string;
      } | null;
      return {
        record: toEmployeeRecord(row),
        hasPendingInvite: invite?.status === 'pending',
        currentCondition: currentConditionByRecord.get(row.id) ?? null,
      };
    });

    return { success: true, entries };
  } catch (error) {
    logError('Unexpected error in getPersonnelRecords:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type PersonnelDetail = {
  record: EmployeeRecord;
  conditions: EmploymentCondition[];
  schedules: WorkSchedule[];
  events: EmployeeRecordEvent[];
  hasPendingInvite: boolean;
  // Present when the record is linked to a login.
  profileName: string | null;
  profileEmail: string | null;
};

/**
 * Resolve one personnel record of the active organization. The identifier may
 * be a member's user id (existing `/mitarbeiter/[userId]` links) or the
 * employee record id (personnel records without a login).
 */
export async function getPersonnelDetail(
  idOrUserIdInput: string,
): Promise<{ success: true; detail: PersonnelDetail } | ActionFailure> {
  const parsedIdOrUserId = uuidSchema.safeParse(idOrUserIdInput);
  if (!parsedIdOrUserId.success) return { success: false, error: 'invalid_input' };
  const idOrUserId = parsedIdOrUserId.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: byUser, error: byUserError } = await admin
      .from('employee_records')
      .select('*, organization_invites(status)')
      .eq('organization_id', orgId)
      .eq('user_id', idOrUserId)
      .maybeSingle();
    if (byUserError) {
      logReadFailure('getPersonnelDetail: record by user failed', byUserError);
      return { success: false, error: 'load_failed' };
    }

    let row = byUser;
    if (!row) {
      const { data: byId, error: byIdError } = await admin
        .from('employee_records')
        .select('*, organization_invites(status)')
        .eq('organization_id', orgId)
        .eq('id', idOrUserId)
        .maybeSingle();
      if (byIdError) {
        logReadFailure('getPersonnelDetail: record by id failed', byIdError);
        return { success: false, error: 'load_failed' };
      }
      row = byId;
    }

    if (!row) {
      return { success: false, error: 'record_not_found' };
    }

    const [conditionsResult, schedulesResult, eventsResult, profileResult] = await Promise.all([
      admin
        .from('employment_conditions')
        .select('*')
        .eq('organization_id', orgId)
        .eq('employee_record_id', row.id)
        .order('valid_from', { ascending: false }),
      admin
        .from('work_schedules')
        .select('*')
        .eq('organization_id', orgId)
        .eq('employee_record_id', row.id)
        .order('valid_from', { ascending: false }),
      admin
        .from('employee_record_events')
        .select('*')
        .eq('organization_id', orgId)
        .eq('employee_record_id', row.id)
        .order('created_at', { ascending: false })
        .limit(50),
      row.user_id
        ? admin.from('profiles').select('first_name, last_name, email').eq('id', row.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    // A failed conditions/schedules load must fail the detail explicitly —
    // otherwise the surface would silently show the labeled default target
    // although a real schedule exists.
    // The history and the linked login's name fail it too: an empty history
    // or a missing name would look like facts.
    const profileError = 'error' in profileResult ? profileResult.error : null;
    const contextError =
      conditionsResult.error ?? schedulesResult.error ?? eventsResult.error ?? profileError;
    if (contextError) {
      logError('Failed to load personnel detail context:', contextError);
      return { success: false, error: 'load_failed' };
    }

    const rawInvite = row.organization_invites as unknown;
    const invite = (Array.isArray(rawInvite) ? (rawInvite[0] ?? null) : rawInvite) as {
      status: string;
    } | null;

    const profile = profileResult.data;

    return {
      success: true,
      detail: {
        record: toEmployeeRecord(row),
        conditions: (conditionsResult.data ?? []).map(toEmploymentCondition),
        schedules: (schedulesResult.data ?? []).map(toWorkSchedule),
        events: (eventsResult.data ?? []).map(toEmployeeRecordEvent),
        hasPendingInvite: invite?.status === 'pending',
        profileName: profile ? formatProfileName(profile) : null,
        profileEmail: profile?.email ?? null,
      },
    };
  } catch (error) {
    logError('Unexpected error in getPersonnelDetail:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Personnel Number Suggestion
// ============================================

export async function suggestPersonnelNumber(): Promise<{ success: true; number: string } | ActionFailure> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('generate_personnel_number', {
      p_org_id: orgId,
    });

    if (error || !data) {
      logError('Failed to suggest personnel number:', error);
      return { success: false, error: 'suggestion_failed' };
    }

    return { success: true, number: data };
  } catch (error) {
    logError('Unexpected error in suggestPersonnelNumber:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Create (future starter / non-login personnel)
// ============================================

export type CreatePersonnelRecordInput = {
  firstName?: string;
  lastName: string;
  employeeNumber?: string;
  entryDate?: string;
  notes?: string;
};

export type CreatePersonnelRecordResult = { success: true; recordId: string } | ActionFailure;

export async function createPersonnelRecord(
  rawInput: CreatePersonnelRecordInput,
): Promise<CreatePersonnelRecordResult> {
  const parsedInput = createPersonnelRecordSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  try {
    const guard = await requirePersonnelManager();
    if (!guard.success) return guard;
    const { orgId, userId } = guard.context;

    const lastName = normalizeOptionalText(input.lastName);
    if (!lastName) {
      return { success: false, error: 'last_name_required' };
    }

    const entryDate = normalizeOptionalText(input.entryDate);
    if (entryDate && !isParsableIsoDate(entryDate)) {
      return { success: false, error: 'invalid_entry_date' };
    }

    // One call creates the record and its 'created' history row.
    const { data: recordId, error } = await createSupabaseAdminClient().rpc(
      'create_employee_record',
      rpcArgs('create_employee_record', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_first_name: normalizeOptionalText(input.firstName),
        p_last_name: lastName,
        p_employee_number: normalizeOptionalText(input.employeeNumber),
        p_entry_date: entryDate,
        p_notes: normalizeOptionalText(input.notes),
      }),
    );
    if (error || !recordId) {
      return personnelWriteFailure(error, 'create_failed', 'Failed to create personnel record:');
    }

    return { success: true, recordId };
  } catch (error) {
    logError('Unexpected error in createPersonnelRecord:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Master Data
// ============================================

export type PersonnelMasterDataPatch = Partial<{
  employeeNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  privateEmail: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  entryDate: string | null;
  exitDate: string | null;
  notes: string | null;
}>;

const MASTER_DATA_COLUMNS: Record<keyof PersonnelMasterDataPatch, string> = {
  employeeNumber: 'employee_number',
  firstName: 'first_name',
  lastName: 'last_name',
  phone: 'phone',
  privateEmail: 'private_email',
  street: 'street',
  postalCode: 'postal_code',
  city: 'city',
  emergencyContactName: 'emergency_contact_name',
  emergencyContactPhone: 'emergency_contact_phone',
  entryDate: 'entry_date',
  exitDate: 'exit_date',
  notes: 'notes',
};

export type UpdatePersonnelResult = {
  success: boolean;
  error?: string;
};

export async function updatePersonnelMasterData(
  recordIdInput: string,
  patchInput: PersonnelMasterDataPatch,
): Promise<UpdatePersonnelResult> {
  const parsedPatch = masterDataPatchSchema.safeParse(patchInput);
  if (!parsedPatch.success) return { success: false, error: 'invalid_input' };
  const patch = parsedPatch.data;
  const parsedRecordId = uuidSchema.safeParse(recordIdInput);
  if (!parsedRecordId.success) return { success: false, error: 'invalid_input' };
  const recordId = parsedRecordId.data;
  try {
    const guard = await requirePersonnelManager();
    if (!guard.success) return guard;
    const { orgId, userId } = guard.context;

    const columnPatch: Record<string, string | null> = {};
    for (const key of Object.keys(patch) as (keyof PersonnelMasterDataPatch)[]) {
      if (!(key in MASTER_DATA_COLUMNS)) continue;
      const normalized = normalizeOptionalText(patch[key]);
      if ((key === 'entryDate' || key === 'exitDate') && normalized && !isParsableIsoDate(normalized)) {
        return { success: false, error: 'invalid_date' };
      }
      columnPatch[MASTER_DATA_COLUMNS[key]] = normalized;
    }

    if (Object.keys(columnPatch).length === 0) {
      return { success: true };
    }

    // One call compares the patch with the record under lock, writes the
    // fields that differ and records them in 'master_data_updated'. A linked
    // record's name belongs to the profile: only a real change is refused.
    const { error } = await createSupabaseAdminClient().rpc(
      'update_employee_master_data',
      rpcArgs('update_employee_master_data', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_record_id: recordId,
        p_patch: columnPatch,
      }),
    );
    if (error)
      return personnelWriteFailure(error, 'update_failed', 'Failed to update personnel master data:');

    return { success: true };
  } catch (error) {
    logError('Unexpected error in updatePersonnelMasterData:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

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

// ============================================
// Invite Connection (non-login record -> future login)
// ============================================

export async function sendPersonnelInvite(
  recordIdInput: string,
  emailInput: string,
  roleInput: InviteRole,
): Promise<UpdatePersonnelResult> {
  const parsedRole = inviteRoleInputSchema.safeParse(roleInput);
  if (!parsedRole.success) return { success: false, error: 'invalid_input' };
  const role = parsedRole.data;
  const parsedEmail = inviteEmailSchema.safeParse(emailInput);
  if (!parsedEmail.success) return { success: false, error: 'invalid_email' };
  const email = parsedEmail.data;
  const parsedRecordId = uuidSchema.safeParse(recordIdInput);
  if (!parsedRecordId.success) return { success: false, error: 'invalid_input' };
  const recordId = parsedRecordId.data;
  try {
    const guard = await requireManagerAndRecord(recordId);
    if (!guard.success) return guard;
    const { orgId, userId, admin } = guard.context;
    const { record } = guard;

    if (record.userId) {
      return { success: false, error: 'already_has_login' };
    }

    // One transaction cancels the record's pending invite (it would otherwise
    // stay redeemable and create a duplicate person), creates the new invite
    // and connects it; a failed mail withdraws all of it again.
    const user = await getAuthenticatedUser();
    const sent = await createAndMailOrganizationInvite({
      admin,
      organizationId: orgId,
      inviterId: userId,
      inviterFallbackName: user?.email || 'Ein Administrator',
      email,
      role,
      employeeRecordId: recordId,
      replacedInviteId: record.inviteId,
    });
    if (!sent.success) return sent;

    // „Einladung versendet“ in the record history is a separate write after the
    // mail on purpose: a mail cannot join a database transaction, and the row
    // must only claim a mail that went out. The history is append-only, so a
    // row written with the invite in create_organization_invite could not be
    // withdrawn when the mail fails. A failed write here is logged and the
    // sent invite stands.
    await recordEmployeeRecordEvent(admin, {
      orgId,
      employeeRecordId: recordId,
      eventType: 'invite_connected',
      eventPayload: { invite_id: sent.inviteId, email },
      actorId: userId,
    });

    return { success: true };
  } catch (error) {
    logError('Unexpected error in sendPersonnelInvite:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

'use server';

import { updateTag } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { CACHE_TAGS } from '@/lib/data/cached';
import { sendOrgInvite, type InviteRole } from '@/lib/invites/actions';
import { formatProfileName } from '@/lib/members/profile-name';
import {
  EMPLOYMENT_TYPES,
  toEmployeeRecord,
  toEmploymentCondition,
  toEmployeeRecordEvent,
  type EmployeeRecord,
  type EmployeeRecordEvent,
  type EmploymentCondition,
  type EmploymentType,
} from '@/lib/personnel/types';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  return ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function recordPersonnelEvent(
  admin: AdminClient,
  input: {
    orgId: string;
    employeeRecordId: string;
    eventType: string;
    eventPayload?: Record<string, unknown>;
    actorId: string;
  }
): Promise<void> {
  const { error } = await admin.from('employee_record_events').insert({
    organization_id: input.orgId,
    employee_record_id: input.employeeRecordId,
    event_type: input.eventType,
    event_payload: input.eventPayload ?? {},
    created_by: input.actorId,
  });

  if (error) {
    // The audit trail must not block the business action; surface it in logs.
    console.error('Failed to record employee record event:', error);
  }
}

async function requireManagerAndRecord(recordId: string): Promise<
  | {
      success: true;
      context: { orgId: string; userId: string; admin: AdminClient };
      record: EmployeeRecord;
    }
  | { success: false; error: string }
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
  | { success: true; entries: PersonnelListEntry[] }
  | { success: false; error: string }
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
      admin
        .from('employee_records')
        .select('*, organization_invites(status)')
        .eq('organization_id', orgId),
      admin
        .from('employment_conditions')
        .select('*')
        .eq('organization_id', orgId)
        .lte('valid_from', new Date().toISOString().slice(0, 10))
        .order('valid_from', { ascending: false }),
    ]);

    if (recordsResult.error) {
      console.error('Failed to load employee records:', recordsResult.error);
      return { success: false, error: 'load_failed' };
    }

    const currentConditionByRecord = new Map<string, EmploymentCondition>();
    for (const row of conditionsResult.data ?? []) {
      if (!currentConditionByRecord.has(row.employee_record_id)) {
        currentConditionByRecord.set(
          row.employee_record_id,
          toEmploymentCondition(row)
        );
      }
    }

    const entries: PersonnelListEntry[] = (recordsResult.data ?? []).map(
      (row) => {
        // supabase-js types embedded to-one relations inconsistently; accept
        // both the object and single-element-array shapes.
        const rawInvite = row.organization_invites as unknown;
        const invite = (
          Array.isArray(rawInvite) ? (rawInvite[0] ?? null) : rawInvite
        ) as { status: string } | null;
        return {
          record: toEmployeeRecord(row),
          hasPendingInvite: invite?.status === 'pending',
          currentCondition: currentConditionByRecord.get(row.id) ?? null,
        };
      }
    );

    return { success: true, entries };
  } catch (error) {
    console.error('Unexpected error in getPersonnelRecords:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type PersonnelDetail = {
  record: EmployeeRecord;
  conditions: EmploymentCondition[];
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
export async function getPersonnelDetail(idOrUserId: string): Promise<
  { success: true; detail: PersonnelDetail } | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: byUser } = await admin
      .from('employee_records')
      .select('*, organization_invites(status)')
      .eq('organization_id', orgId)
      .eq('user_id', idOrUserId)
      .maybeSingle();

    let row = byUser;
    if (!row) {
      const { data: byId } = await admin
        .from('employee_records')
        .select('*, organization_invites(status)')
        .eq('organization_id', orgId)
        .eq('id', idOrUserId)
        .maybeSingle();
      row = byId;
    }

    if (!row) {
      return { success: false, error: 'record_not_found' };
    }

    const [conditionsResult, eventsResult, profileResult] = await Promise.all([
      admin
        .from('employment_conditions')
        .select('*')
        .eq('employee_record_id', row.id)
        .order('valid_from', { ascending: false }),
      admin
        .from('employee_record_events')
        .select('*')
        .eq('employee_record_id', row.id)
        .order('created_at', { ascending: false })
        .limit(50),
      row.user_id
        ? admin
            .from('profiles')
            .select('first_name, last_name, email')
            .eq('id', row.user_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const rawInvite = row.organization_invites as unknown;
    const invite = (
      Array.isArray(rawInvite) ? (rawInvite[0] ?? null) : rawInvite
    ) as { status: string } | null;

    const profile = profileResult.data;

    return {
      success: true,
      detail: {
        record: toEmployeeRecord(row),
        conditions: (conditionsResult.data ?? []).map(toEmploymentCondition),
        events: (eventsResult.data ?? []).map(toEmployeeRecordEvent),
        hasPendingInvite: invite?.status === 'pending',
        profileName: profile ? formatProfileName(profile) : null,
        profileEmail: profile?.email ?? null,
      },
    };
  } catch (error) {
    console.error('Unexpected error in getPersonnelDetail:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Personnel Number Suggestion
// ============================================

export async function suggestPersonnelNumber(): Promise<
  { success: true; number: string } | { success: false; error: string }
> {
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
      console.error('Failed to suggest personnel number:', error);
      return { success: false, error: 'suggestion_failed' };
    }

    return { success: true, number: data };
  } catch (error) {
    console.error('Unexpected error in suggestPersonnelNumber:', error);
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

export type CreatePersonnelRecordResult =
  | { success: true; recordId: string }
  | { success: false; error: string };

export async function createPersonnelRecord(
  input: CreatePersonnelRecordInput
): Promise<CreatePersonnelRecordResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const lastName = normalizeOptionalText(input.lastName);
    if (!lastName) {
      return { success: false, error: 'last_name_required' };
    }

    const entryDate = normalizeOptionalText(input.entryDate);
    if (entryDate && !isValidIsoDate(entryDate)) {
      return { success: false, error: 'invalid_entry_date' };
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('employee_records')
      .insert({
        organization_id: orgId,
        first_name: normalizeOptionalText(input.firstName),
        last_name: lastName,
        employee_number: normalizeOptionalText(input.employeeNumber),
        entry_date: entryDate,
        notes: normalizeOptionalText(input.notes),
        created_by: userId,
      })
      .select('id')
      .single();

    if (error || !data) {
      if (error?.code === '23505') {
        return { success: false, error: 'number_taken' };
      }
      console.error('Failed to create personnel record:', error);
      return { success: false, error: 'create_failed' };
    }

    await recordPersonnelEvent(admin, {
      orgId,
      employeeRecordId: data.id,
      eventType: 'created',
      eventPayload: { last_name: lastName, entry_date: entryDate },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.personnel(orgId));

    return { success: true, recordId: data.id };
  } catch (error) {
    console.error('Unexpected error in createPersonnelRecord:', error);
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
  recordId: string,
  patch: PersonnelMasterDataPatch
): Promise<UpdatePersonnelResult> {
  try {
    const guard = await requireManagerAndRecord(recordId);
    if (!guard.success) return guard;
    const { orgId, userId, admin } = guard.context;
    const { record } = guard;

    const update: Record<string, string | null> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    for (const key of Object.keys(patch) as (keyof PersonnelMasterDataPatch)[]) {
      if (!(key in MASTER_DATA_COLUMNS)) continue;

      // For linked records the global profile name is authoritative.
      if ((key === 'firstName' || key === 'lastName') && record.userId) {
        return { success: false, error: 'name_managed_by_profile' };
      }

      const normalized = normalizeOptionalText(patch[key]);

      if (
        (key === 'entryDate' || key === 'exitDate') &&
        normalized &&
        !isValidIsoDate(normalized)
      ) {
        return { success: false, error: 'invalid_date' };
      }

      const previous = record[key];
      if (previous === normalized) continue;

      update[MASTER_DATA_COLUMNS[key]] = normalized;
      changes[MASTER_DATA_COLUMNS[key]] = { from: previous, to: normalized };
    }

    if (Object.keys(update).length === 0) {
      return { success: true };
    }

    const { error } = await admin
      .from('employee_records')
      .update(update)
      .eq('id', recordId)
      .eq('organization_id', orgId);

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'number_taken' };
      }
      if (error.code === '23514') {
        return { success: false, error: 'exit_before_entry' };
      }
      console.error('Failed to update personnel master data:', error);
      return { success: false, error: 'update_failed' };
    }

    await recordPersonnelEvent(admin, {
      orgId,
      employeeRecordId: recordId,
      eventType: 'master_data_updated',
      eventPayload: { changes },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.personnel(orgId));

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in updatePersonnelMasterData:', error);
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

function validateConditionInput(
  input: EmploymentConditionInput
): string | null {
  if (!input.validFrom || !isValidIsoDate(input.validFrom)) {
    return 'invalid_valid_from';
  }
  if (!EMPLOYMENT_TYPES.includes(input.employmentType)) {
    return 'invalid_employment_type';
  }
  if (
    input.weeklyHours !== undefined &&
    input.weeklyHours !== null &&
    (Number.isNaN(input.weeklyHours) ||
      input.weeklyHours < 0 ||
      input.weeklyHours > 100)
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
  recordId: string,
  input: EmploymentConditionInput
): Promise<UpdatePersonnelResult> {
  try {
    const guard = await requireManagerAndRecord(recordId);
    if (!guard.success) return guard;
    const { orgId, userId, admin } = guard.context;

    const validationError = validateConditionInput(input);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const { data, error } = await admin
      .from('employment_conditions')
      .insert({
        organization_id: orgId,
        employee_record_id: recordId,
        valid_from: input.validFrom,
        employment_type: input.employmentType,
        weekly_hours: input.weeklyHours ?? null,
        vacation_days_per_year: input.vacationDaysPerYear ?? null,
        note: normalizeOptionalText(input.note),
        created_by: userId,
      })
      .select('id')
      .single();

    if (error || !data) {
      if (error?.code === '23505') {
        return { success: false, error: 'duplicate_valid_from' };
      }
      console.error('Failed to add employment condition:', error);
      return { success: false, error: 'create_failed' };
    }

    await recordPersonnelEvent(admin, {
      orgId,
      employeeRecordId: recordId,
      eventType: 'condition_added',
      eventPayload: {
        condition_id: data.id,
        valid_from: input.validFrom,
        employment_type: input.employmentType,
        weekly_hours: input.weeklyHours ?? null,
        vacation_days_per_year: input.vacationDaysPerYear ?? null,
      },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.personnel(orgId));

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in addEmploymentCondition:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

async function requireManagerAndCondition(conditionId: string): Promise<
  | {
      success: true;
      context: { orgId: string; userId: string; admin: AdminClient };
      condition: EmploymentCondition;
    }
  | { success: false; error: string }
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { orgId, userId, isManagerOrAbove } = auth.context;

  if (!isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('employment_conditions')
    .select('*')
    .eq('id', conditionId)
    .eq('organization_id', orgId)
    .single();

  if (error || !data) {
    return { success: false, error: 'condition_not_found' };
  }

  return {
    success: true,
    context: { orgId, userId, admin },
    condition: toEmploymentCondition(data),
  };
}

export async function updateEmploymentCondition(
  conditionId: string,
  input: EmploymentConditionInput
): Promise<UpdatePersonnelResult> {
  try {
    const guard = await requireManagerAndCondition(conditionId);
    if (!guard.success) return guard;
    const { orgId, userId, admin } = guard.context;
    const { condition } = guard;

    const validationError = validateConditionInput(input);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const { error } = await admin
      .from('employment_conditions')
      .update({
        valid_from: input.validFrom,
        employment_type: input.employmentType,
        weekly_hours: input.weeklyHours ?? null,
        vacation_days_per_year: input.vacationDaysPerYear ?? null,
        note: normalizeOptionalText(input.note),
      })
      .eq('id', conditionId)
      .eq('organization_id', orgId);

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'duplicate_valid_from' };
      }
      console.error('Failed to update employment condition:', error);
      return { success: false, error: 'update_failed' };
    }

    // Corrections stay traceable: the audit event keeps the full before/after.
    await recordPersonnelEvent(admin, {
      orgId,
      employeeRecordId: condition.employeeRecordId,
      eventType: 'condition_updated',
      eventPayload: {
        condition_id: conditionId,
        before: {
          valid_from: condition.validFrom,
          employment_type: condition.employmentType,
          weekly_hours: condition.weeklyHours,
          vacation_days_per_year: condition.vacationDaysPerYear,
          note: condition.note,
        },
        after: {
          valid_from: input.validFrom,
          employment_type: input.employmentType,
          weekly_hours: input.weeklyHours ?? null,
          vacation_days_per_year: input.vacationDaysPerYear ?? null,
          note: normalizeOptionalText(input.note),
        },
      },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.personnel(orgId));

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in updateEmploymentCondition:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function deleteEmploymentCondition(
  conditionId: string
): Promise<UpdatePersonnelResult> {
  try {
    const guard = await requireManagerAndCondition(conditionId);
    if (!guard.success) return guard;
    const { orgId, userId, admin } = guard.context;
    const { condition } = guard;

    const { error } = await admin
      .from('employment_conditions')
      .delete()
      .eq('id', conditionId)
      .eq('organization_id', orgId);

    if (error) {
      console.error('Failed to delete employment condition:', error);
      return { success: false, error: 'delete_failed' };
    }

    await recordPersonnelEvent(admin, {
      orgId,
      employeeRecordId: condition.employeeRecordId,
      eventType: 'condition_deleted',
      eventPayload: {
        condition_id: conditionId,
        deleted: {
          valid_from: condition.validFrom,
          employment_type: condition.employmentType,
          weekly_hours: condition.weeklyHours,
          vacation_days_per_year: condition.vacationDaysPerYear,
          note: condition.note,
        },
      },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.personnel(orgId));

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in deleteEmploymentCondition:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Invite Connection (non-login record -> future login)
// ============================================

export async function sendPersonnelInvite(
  recordId: string,
  email: string,
  role: InviteRole
): Promise<UpdatePersonnelResult> {
  try {
    const guard = await requireManagerAndRecord(recordId);
    if (!guard.success) return guard;
    const { orgId, userId, admin } = guard.context;
    const { record } = guard;

    if (record.userId) {
      return { success: false, error: 'already_has_login' };
    }

    const inviteResult = await sendOrgInvite(email, role);
    if (!inviteResult.success || !inviteResult.inviteId) {
      return {
        success: false,
        error: inviteResult.error ?? 'invite_failed',
      };
    }

    const { error } = await admin
      .from('employee_records')
      .update({ invite_id: inviteResult.inviteId })
      .eq('id', recordId)
      .eq('organization_id', orgId);

    if (error) {
      // The invite exists but could not be connected; the office can retry or
      // the redemption simply creates a fresh record via the membership trigger.
      console.error('Failed to connect invite to personnel record:', error);
      return { success: false, error: 'invite_connect_failed' };
    }

    await recordPersonnelEvent(admin, {
      orgId,
      employeeRecordId: recordId,
      eventType: 'invite_connected',
      eventPayload: { invite_id: inviteResult.inviteId, email },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.personnel(orgId));

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in sendPersonnelInvite:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

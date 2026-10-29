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
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import {
  toEmployeeRecord,
  toEmploymentCondition,
  toEmployeeRecordEvent,
  type EmployeeRecord,
  type EmployeeRecordEvent,
  type EmployeeRecordRow,
  type EmploymentCondition,
} from '@/lib/personnel/types';
import { toWorkSchedule, type WorkSchedule } from '@/lib/personnel/schedule';
import { logError } from '@/lib/logging';
import { recordEmployeeRecordEvent } from '@/lib/personnel/employee-record-events';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import type { ActionFailure } from '@/lib/action-result';
import {
  isParsableIsoDate,
  personnelWriteFailure,
  requirePersonnelManager,
  type UpdatePersonnelResult,
} from '@/lib/personnel/record-writes';

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
const inviteEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));
const inviteRoleInputSchema = z.enum(['buero', 'employee']);

/**
 * Whether a record's embedded invite is pending. supabase-js types an embedded to-one relation
 * inconsistently, so both the object and the single-element-array shape are read.
 */
function hasPendingInviteEmbed(embed: unknown): boolean {
  const invite: unknown = Array.isArray(embed) ? embed[0] : embed;
  return typeof invite === 'object' && invite !== null && 'status' in invite && invite.status === 'pending';
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
      return {
        record: toEmployeeRecord(row),
        hasPendingInvite: hasPendingInviteEmbed(row.organization_invites),
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

type PersonnelRecordWithInvite = EmployeeRecordRow & { organization_invites: unknown };

/**
 * The record of the active organization that `idOrUserId` names: first as a
 * member's user id, then as the employee record id.
 */
async function findPersonnelRecord(
  admin: AdminClient,
  orgId: string,
  idOrUserId: string,
): Promise<{ success: true; row: PersonnelRecordWithInvite } | ActionFailure> {
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
  return { success: true, row };
}

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

    const found = await findPersonnelRecord(admin, orgId, idOrUserId);
    if (!found.success) return found;
    const { row } = found;

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

    const profile = profileResult.data;

    return {
      success: true,
      detail: {
        record: toEmployeeRecord(row),
        conditions: (conditionsResult.data ?? []).map(toEmploymentCondition),
        schedules: (schedulesResult.data ?? []).map(toWorkSchedule),
        events: (eventsResult.data ?? []).map(toEmployeeRecordEvent),
        hasPendingInvite: hasPendingInviteEmbed(row.organization_invites),
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

function isMasterDataKey(key: string): key is keyof PersonnelMasterDataPatch {
  return Object.hasOwn(MASTER_DATA_COLUMNS, key);
}

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
    for (const [key, value] of Object.entries(patch)) {
      if (!isMasterDataKey(key)) continue;
      const normalized = normalizeOptionalText(value);
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

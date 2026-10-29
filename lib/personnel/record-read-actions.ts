'use server';

import { logReadFailure } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
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
import { uuidSchema } from '@/lib/validation/uuid';
import type { ActionFailure } from '@/lib/action-result';

/**
 * Whether a record's embedded invite is pending. supabase-js types an embedded to-one relation
 * inconsistently, so both the object and the single-element-array shape are read.
 */
function hasPendingInviteEmbed(embed: unknown): boolean {
  const invite: unknown = Array.isArray(embed) ? embed[0] : embed;
  return typeof invite === 'object' && invite !== null && 'status' in invite && invite.status === 'pending';
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

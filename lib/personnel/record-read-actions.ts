'use server';

import { logReadFailure } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import {
  hasPendingInviteEmbed,
  toEmployeeRecord,
  toEmploymentCondition,
  type EmployeeRecord,
  type EmploymentCondition,
} from '@/lib/personnel/types';
import { logError } from '@/lib/logging';
import type { ActionFailure } from '@/lib/action-result';

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

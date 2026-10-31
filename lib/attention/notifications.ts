import 'server-only';

// The notice reads behind the attention Server Actions in `./actions`: read
// markers, the sickness audiences and names, certification notices, and the
// audience checks that decide who may mark a notice read. Each reads through
// the caller's organization and never mutates state.

import type { PostgrestError } from '@supabase/supabase-js';
import type { ActionFailure } from '@/lib/action-result';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { ActionContext } from '@/lib/org/action-context';
import type { Tables } from '@/lib/supabase/database.types';
import { formatProfileName } from '@/lib/members/profile-name';
import { readInBatches } from '@/lib/supabase/query-batches';
import { logError } from '@/lib/logging';
import { loadCertificationExpiryNotifications } from '@/lib/qualifications/server';
import { isNotificationUnread } from './resolution';
import { readOwnEmployeeRecord } from './own-record';
import type { AttentionNotification } from './types';

export type SicknessNoticeRow = Pick<
  Tables<'sickness_reports'>,
  | 'id'
  | 'employee_record_id'
  | 'status'
  | 'start_date'
  | 'end_date'
  | 'day_portion'
  | 'reported_by'
  | 'cancelled_by'
  | 'cancelled_at'
  | 'updated_at'
>;

/** The caller's read markers of one notice type, for the given sources only: markers accumulate forever. */
export function readNotificationReadVersions(
  admin: AdminClient,
  context: ActionContext,
  sourceType: AttentionNotification['sourceType'],
  sourceIds: string[],
): Promise<{
  data: Pick<Tables<'attention_read_states'>, 'source_id' | 'state_version'>[];
  error: PostgrestError | null;
}> {
  return readInBatches(sourceIds, (batch) =>
    admin
      .from('attention_read_states')
      .select('source_id, state_version')
      .eq('organization_id', context.orgId)
      .eq('user_id', context.userId)
      .eq('source_type', sourceType)
      .in('source_id', [...batch]),
  );
}

/** The reports the viewer learns of as the affected person, and the others they learn of as a manager. */
export function splitSicknessAudiences(
  rows: SicknessNoticeRow[],
  userId: string,
  isManager: boolean,
  ownRecordId: string | null,
): { ownRows: SicknessNoticeRow[]; managerRows: SicknessNoticeRow[] } {
  const isOwnAudience = (row: SicknessNoticeRow): boolean => {
    if (!ownRecordId || row.employee_record_id !== ownRecordId) return false;
    // Own self-managed reports are no news; office involvement is.
    if (row.reported_by !== userId) return true;
    return row.cancelled_by !== null && row.cancelled_by !== userId;
  };
  const isManagerAudience = (row: SicknessNoticeRow): boolean => {
    if (!isManager) return false;
    // The recording (or cancelling) manager already knows their own action.
    if (row.reported_by === userId && row.status === 'reported') {
      return false;
    }
    if (row.status === 'cancelled' && row.cancelled_by === userId) {
      return false;
    }
    return true;
  };

  return {
    ownRows: rows.filter(isOwnAudience),
    managerRows: rows.filter((row) => isManagerAudience(row) && !isOwnAudience(row)),
  };
}

/**
 * The person names of manager-audience notices (two-step lookup; no FK path
 * from employee_records to profiles for PostgREST embeds). Null when a read failed.
 */
export async function readSicknessNoticeNames(
  admin: AdminClient,
  organizationId: string,
  managerRows: SicknessNoticeRow[],
): Promise<Map<string, string> | null> {
  const nameRecordIds = [...new Set(managerRows.map((row) => row.employee_record_id))];
  if (nameRecordIds.length === 0) return new Map<string, string>();
  const { data: records, error: recordsError } = await readInBatches(nameRecordIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (recordsError) {
    logError('Failed to load records for sickness notices', recordsError);
    return null;
  }
  const userIds = [
    ...new Set((records ?? []).map((row) => row.user_id).filter((id): id is string => Boolean(id))),
  ];
  const profilesResult = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logError('Failed to load profiles for sickness notices', profilesResult.error);
    return null;
  }
  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  return new Map(
    (records ?? []).map((record) => {
      const profile = record.user_id ? profileById.get(record.user_id) : undefined;
      const name = profile
        ? formatProfileName(profile)
        : `${record.first_name ?? ''} ${record.last_name ?? ''}`.trim();
      return [record.id, name || 'Unbekannt'];
    }),
  );
}

export async function deriveCertificationExpiryNotifications(
  context: ActionContext,
): Promise<{ notifications: AttentionNotification[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { notifications: [], failed: false };
  }
  const admin = createSupabaseAdminClient();
  const noticesResult = await loadCertificationExpiryNotifications({
    admin,
    orgId: context.orgId,
  });
  if (noticesResult.failed || noticesResult.notices.length === 0) {
    return { notifications: [], failed: noticesResult.failed };
  }
  const noticeSourceIds = noticesResult.notices.map((notice) => notice.sourceId);
  const readStatesResult = await readNotificationReadVersions(
    admin,
    context,
    'employee_certification_expiry',
    noticeSourceIds,
  );
  if (noticesResult.failed || readStatesResult.error) {
    logError('Failed to load certification attention read states', readStatesResult.error);
    return { notifications: [], failed: true };
  }
  const readVersionBySourceId = new Map(
    (readStatesResult.data ?? []).map((row) => [row.source_id, row.state_version]),
  );
  return {
    notifications: noticesResult.notices.map((notice) => ({
      sourceType: 'employee_certification_expiry',
      sourceId: notice.sourceId,
      employeeRecordId: notice.employeeRecordId,
      personName: notice.employeeName,
      capabilityName: notice.capabilityName,
      validUntil: notice.validUntil,
      phase: notice.phase,
      stateVersion: notice.stateVersion,
      occurredAt: notice.occurredAt,
      unread: isNotificationUnread(notice.stateVersion, readVersionBySourceId.get(notice.sourceId) ?? null),
    })),
    failed: false,
  };
}

// ============================================
// Who may mark a notice read
// ============================================

/** Self-only: the decided request must belong to the caller's own employee record in the active organization. */
export async function refuseVacationDecisionMarker(
  admin: AdminClient,
  context: ActionContext,
  sourceId: string,
): Promise<ActionFailure | null> {
  const { data: request, error: requestError } = await admin
    .from('vacation_requests')
    .select('id, employee_record_id, organization_id')
    .eq('organization_id', context.orgId)
    .eq('id', sourceId)
    .maybeSingle();
  if (requestError) {
    logError('Failed to load request for read marker', requestError);
    return { success: false, error: 'update_failed' };
  }
  if (!request) return { success: false, error: 'request_not_found' };

  const { data: record, error: recordError } = await readOwnEmployeeRecord(context);
  if (recordError) {
    logError('Failed to load own record for read marker', recordError);
    return { success: false, error: 'update_failed' };
  }
  if (!record || record.id !== request.employee_record_id) {
    return { success: false, error: 'not_authorized' };
  }
  return null;
}

/**
 * Sickness notices have two audiences (privacy matrix): the affected person
 * and admin/büro managers. Either may mark their own copy read.
 */
export async function refuseSicknessReportMarker(
  admin: AdminClient,
  context: ActionContext,
  sourceId: string,
): Promise<ActionFailure | null> {
  const { data: report, error: reportError } = await admin
    .from('sickness_reports')
    .select('id, employee_record_id, organization_id')
    .eq('organization_id', context.orgId)
    .eq('id', sourceId)
    .maybeSingle();
  if (reportError) {
    logError('Failed to load report for read marker', reportError);
    return { success: false, error: 'update_failed' };
  }
  if (!report) return { success: false, error: 'request_not_found' };

  const isManager = context.role === 'admin' || context.role === 'buero';
  if (isManager) return null;
  const { data: record, error: recordError } = await readOwnEmployeeRecord(context);
  if (recordError) {
    logError('Failed to load own record for read marker', recordError);
    return { success: false, error: 'update_failed' };
  }
  if (!record || record.id !== report.employee_record_id) {
    return { success: false, error: 'not_authorized' };
  }
  return null;
}

/** Certification notices reach only admin/büro managers. */
export async function refuseCertificationMarker(
  admin: AdminClient,
  context: ActionContext,
  sourceId: string,
): Promise<ActionFailure | null> {
  const isManager = context.role === 'admin' || context.role === 'buero';
  if (!isManager) return { success: false, error: 'not_authorized' };
  const { data: certification, error: certificationError } = await admin
    .from('employee_capabilities')
    .select('id')
    .eq('organization_id', context.orgId)
    .eq('id', sourceId)
    .eq('capability_kind', 'certification')
    .maybeSingle();
  if (certificationError) {
    logError('Failed to load certification for read marker', certificationError);
    return { success: false, error: 'update_failed' };
  }
  if (!certification) return { success: false, error: 'request_not_found' };
  return null;
}

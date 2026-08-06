'use server';

import { updateTag } from 'next/cache';
import { cookies } from 'next/headers';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import {
  CACHE_TAGS,
  getAuthenticatedUser,
  getCachedMemberships,
} from '@/lib/data/cached';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { authorizeResponsibilityForTarget } from '@/lib/responsibilities/server';
import type { OrgRole } from '@/lib/members/actions';
import {
  computeVacationBalance,
  countVacationDays,
  countVacationDaysByYear,
  resolveVacationEntitlementForYear,
  type VacationBalance,
} from './balance';
import {
  loadVacationCountingContext,
  loadVacationRequestsForRecord,
} from './server';
import {
  toVacationRequest,
  type VacationDayPortion,
  type VacationRequest,
  type VacationRequestRow,
} from './types';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type ActionContext = {
  userId: string;
  orgId: string;
  role: OrgRole;
};

async function resolveActionContext(): Promise<
  | { success: true; context: ActionContext }
  | { success: false; error: string }
> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };

  const cookieStore = await cookies();
  const orgId = await resolveActiveOrgId(cookieStore, user.id);
  if (!orgId) return { success: false, error: 'no_active_org' };

  const memberships = await getCachedMemberships(user.id);
  const membership = memberships.find((entry) => entry.orgId === orgId);
  if (!membership) return { success: false, error: 'not_a_member' };

  return {
    success: true,
    context: { userId: user.id, orgId, role: membership.role as OrgRole },
  };
}

function invalidateVacation(orgId: string): void {
  updateTag(CACHE_TAGS.vacation(orgId));
}

// ============================================
// Own overview (dashboard widget)
// ============================================

export type OwnVacationOverview = {
  employeeRecordId: string | null;
  businessDate: string;
  year: number;
  balance: VacationBalance | null;
  requests: VacationRequestListItem[];
};

export type VacationRequestListItem = VacationRequest & {
  /** Live preview for pending, snapshot total for approved/cancelled. */
  totalDays: number;
};

export type OwnVacationOverviewResult =
  | { success: true; overview: OwnVacationOverview }
  | { success: false; error: string };

export async function getOwnVacationOverview(): Promise<OwnVacationOverviewResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId } = auth.context;

    const admin = createSupabaseAdminClient();
    const { data: record, error: recordError } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    if (recordError) {
      console.error('Failed to load own employee record:', recordError);
      return { success: false, error: 'load_failed' };
    }

    const businessDate = getBusinessTodayIso();
    const year = Number(businessDate.slice(0, 4));

    if (!record) {
      return {
        success: true,
        overview: {
          employeeRecordId: null,
          businessDate,
          year,
          balance: null,
          requests: [],
        },
      };
    }

    const [context, requests] = await Promise.all([
      loadVacationCountingContext(orgId, record.id),
      loadVacationRequestsForRecord(orgId, record.id),
    ]);
    if (!context || !requests) {
      return { success: false, error: 'load_failed' };
    }

    return {
      success: true,
      overview: {
        employeeRecordId: record.id,
        businessDate,
        year,
        balance: computeVacationBalance(year, requests, context),
        requests: requests.map((request) => ({
          ...request,
          totalDays:
            request.status === 'pending'
              ? countVacationDays(request, context)
              : request.approvedDaysByYear
                ? Object.values(request.approvedDaysByYear).reduce(
                    (total, days) => total + days,
                    0
                  )
                : countVacationDays(request, context),
        })),
      },
    };
  } catch (error) {
    console.error('Unexpected error in getOwnVacationOverview:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Create / withdraw (the one employee self-service write path)
// ============================================

export type CreateVacationRequestResult =
  | { success: true; request: VacationRequest }
  | { success: false; error: string };

export async function createVacationRequest(input: {
  startDate: string;
  endDate: string;
  dayPortion: VacationDayPortion;
  comment?: string;
}): Promise<CreateVacationRequestResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId } = auth.context;

    if (
      !ISO_DATE_PATTERN.test(input.startDate) ||
      !ISO_DATE_PATTERN.test(input.endDate)
    ) {
      return { success: false, error: 'invalid_dates' };
    }
    if (input.endDate < input.startDate) {
      return { success: false, error: 'invalid_range' };
    }
    if (input.dayPortion !== 'full' && input.dayPortion !== 'half_day') {
      return { success: false, error: 'invalid_portion' };
    }
    if (input.dayPortion === 'half_day' && input.startDate !== input.endDate) {
      return { success: false, error: 'half_day_needs_single_day' };
    }

    const admin = createSupabaseAdminClient();
    const { data: record, error: recordError } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    if (recordError || !record) {
      if (recordError) {
        console.error('Failed to load record for request:', recordError);
      }
      return { success: false, error: 'no_employee_record' };
    }

    const comment = input.comment?.trim() || null;
    const { data: inserted, error: insertError } = await admin
      .from('vacation_requests')
      .insert({
        organization_id: orgId,
        employee_record_id: record.id,
        requested_by: userId,
        start_date: input.startDate,
        end_date: input.endDate,
        day_portion: input.dayPortion,
        status: 'pending',
        comment,
      })
      .select()
      .single();

    if (insertError || !inserted) {
      // 23P01 = exclusion violation: an own pending/approved request overlaps.
      if (insertError?.code === '23P01') {
        return { success: false, error: 'overlap_conflict' };
      }
      console.error('Failed to insert vacation request:', insertError);
      return { success: false, error: 'insert_failed' };
    }

    const context = await loadVacationCountingContext(orgId, record.id);
    const { error: eventError } = await admin
      .from('vacation_request_events')
      .insert({
        organization_id: orgId,
        vacation_request_id: inserted.id,
        employee_record_id: record.id,
        event_type: 'requested',
        event_payload: {
          start_date: input.startDate,
          end_date: input.endDate,
          day_portion: input.dayPortion,
          comment,
          preview_days_by_year: context
            ? countVacationDaysByYear(
                {
                  startDate: input.startDate,
                  endDate: input.endDate,
                  dayPortion: input.dayPortion,
                },
                context
              )
            : null,
        },
        created_by: userId,
      });
    if (eventError) {
      console.error('Failed to record vacation request event:', eventError);
    }

    invalidateVacation(orgId);
    return { success: true, request: toVacationRequest(inserted) };
  } catch (error) {
    console.error('Unexpected error in createVacationRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type VacationTransitionResult =
  | { success: true; request: VacationRequest }
  | { success: false; error: string };

export async function withdrawVacationRequest(input: {
  requestId: string;
}): Promise<VacationTransitionResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId } = auth.context;

    const admin = createSupabaseAdminClient();
    const { data: existing, error: loadError } = await admin
      .from('vacation_requests')
      .select('*')
      .eq('id', input.requestId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (loadError) {
      console.error('Failed to load vacation request:', loadError);
      return { success: false, error: 'load_failed' };
    }
    if (!existing) return { success: false, error: 'request_not_found' };

    // Only the requester withdraws, and only while the request is pending.
    const { data: ownRecord } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!ownRecord || ownRecord.id !== existing.employee_record_id) {
      return { success: false, error: 'not_authorized' };
    }
    if (existing.status !== 'pending') {
      return { success: false, error: 'request_not_pending' };
    }

    // Compare-and-set so a concurrent decision wins deterministically.
    const { data: updated, error: updateError } = await admin
      .from('vacation_requests')
      .update({ status: 'withdrawn' })
      .eq('id', existing.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    if (updateError) {
      console.error('Failed to withdraw vacation request:', updateError);
      return { success: false, error: 'update_failed' };
    }
    if (!updated) return { success: false, error: 'request_not_pending' };

    const { error: eventError } = await admin
      .from('vacation_request_events')
      .insert({
        organization_id: orgId,
        vacation_request_id: existing.id,
        employee_record_id: existing.employee_record_id,
        event_type: 'withdrawn',
        event_payload: {
          start_date: existing.start_date,
          end_date: existing.end_date,
        },
        created_by: userId,
      });
    if (eventError) {
      console.error('Failed to record withdrawal event:', eventError);
    }

    invalidateVacation(orgId);
    return { success: true, request: toVacationRequest(updated) };
  } catch (error) {
    console.error('Unexpected error in withdrawVacationRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Decisions (leave_approval holders, resolved at action time)
// ============================================

async function loadRequestWithTarget(
  orgId: string,
  requestId: string
): Promise<
  | {
      success: true;
      request: VacationRequestRow;
      targetUserId: string;
      targetRole: OrgRole;
    }
  | { success: false; error: string }
> {
  const admin = createSupabaseAdminClient();
  const { data: request, error: loadError } = await admin
    .from('vacation_requests')
    .select('*')
    .eq('id', requestId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (loadError) {
    console.error('Failed to load vacation request:', loadError);
    return { success: false, error: 'load_failed' };
  }
  if (!request) return { success: false, error: 'request_not_found' };

  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('user_id')
    .eq('id', request.employee_record_id)
    .maybeSingle();
  if (recordError || !record?.user_id) {
    if (recordError) {
      console.error('Failed to load request target record:', recordError);
    }
    return { success: false, error: 'target_not_found' };
  }

  const { data: membership, error: membershipError } = await admin
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', record.user_id)
    .maybeSingle();
  if (membershipError || !membership) {
    if (membershipError) {
      console.error('Failed to load request target membership:', membershipError);
    }
    return { success: false, error: 'target_not_found' };
  }

  return {
    success: true,
    request,
    targetUserId: record.user_id,
    targetRole: membership.role as OrgRole,
  };
}

export async function decideVacationRequest(input: {
  requestId: string;
  decision: 'approve' | 'reject';
  comment?: string;
}): Promise<VacationTransitionResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId } = auth.context;

    const comment = input.comment?.trim() || null;
    if (input.decision === 'reject' && !comment) {
      return { success: false, error: 'reason_required' };
    }

    const loaded = await loadRequestWithTarget(orgId, input.requestId);
    if (!loaded.success) return loaded;
    const { request, targetUserId, targetRole } = loaded;

    if (request.status !== 'pending') {
      return { success: false, error: 'request_not_pending' };
    }

    // Authority resolves exclusively through the P1-05 contract at action
    // time; self-approval is denied inside the helper.
    const authorization = await authorizeResponsibilityForTarget({
      organizationId: orgId,
      responsibility: 'leave_approval',
      actorUserId: userId,
      targetUserId,
      targetRole,
    });
    if (!authorization.success) return authorization;

    const admin = createSupabaseAdminClient();
    const nowIso = new Date().toISOString();

    let approvedDaysByYear: Record<string, number> | null = null;
    if (input.decision === 'approve') {
      const context = await loadVacationCountingContext(
        orgId,
        request.employee_record_id
      );
      if (!context) return { success: false, error: 'load_failed' };
      approvedDaysByYear = countVacationDaysByYear(
        {
          startDate: request.start_date,
          endDate: request.end_date,
          dayPortion: request.day_portion as VacationDayPortion,
        },
        context
      );
    }

    const { data: updated, error: updateError } = await admin
      .from('vacation_requests')
      .update(
        input.decision === 'approve'
          ? {
              status: 'approved',
              decided_by: userId,
              decided_at: nowIso,
              decision_comment: comment,
              approved_days_by_year: approvedDaysByYear,
            }
          : {
              status: 'rejected',
              decided_by: userId,
              decided_at: nowIso,
              decision_comment: comment,
            }
      )
      .eq('id', request.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    if (updateError) {
      console.error('Failed to decide vacation request:', updateError);
      return { success: false, error: 'update_failed' };
    }
    if (!updated) return { success: false, error: 'request_not_pending' };

    const { error: eventError } = await admin
      .from('vacation_request_events')
      .insert({
        organization_id: orgId,
        vacation_request_id: request.id,
        employee_record_id: request.employee_record_id,
        event_type: input.decision === 'approve' ? 'approved' : 'rejected',
        event_payload: {
          start_date: request.start_date,
          end_date: request.end_date,
          day_portion: request.day_portion,
          decision_comment: comment,
          ...(approvedDaysByYear
            ? { approved_days_by_year: approvedDaysByYear }
            : {}),
        },
        created_by: userId,
      });
    if (eventError) {
      console.error('Failed to record decision event:', eventError);
    }

    invalidateVacation(orgId);
    return { success: true, request: toVacationRequest(updated) };
  } catch (error) {
    console.error('Unexpected error in decideVacationRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function cancelApprovedVacationRequest(input: {
  requestId: string;
  reason: string;
}): Promise<VacationTransitionResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId } = auth.context;

    const reason = input.reason?.trim();
    if (!reason) return { success: false, error: 'reason_required' };

    const loaded = await loadRequestWithTarget(orgId, input.requestId);
    if (!loaded.success) return loaded;
    const { request, targetUserId, targetRole } = loaded;

    if (request.status !== 'approved') {
      return { success: false, error: 'request_not_approved' };
    }

    const authorization = await authorizeResponsibilityForTarget({
      organizationId: orgId,
      responsibility: 'leave_approval',
      actorUserId: userId,
      targetUserId,
      targetRole,
    });
    if (!authorization.success) return authorization;

    const admin = createSupabaseAdminClient();
    const { data: updated, error: updateError } = await admin
      .from('vacation_requests')
      .update({
        status: 'cancelled',
        cancelled_by: userId,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
      })
      .eq('id', request.id)
      .eq('status', 'approved')
      .select()
      .maybeSingle();
    if (updateError) {
      console.error('Failed to cancel vacation request:', updateError);
      return { success: false, error: 'update_failed' };
    }
    if (!updated) return { success: false, error: 'request_not_approved' };

    const { error: eventError } = await admin
      .from('vacation_request_events')
      .insert({
        organization_id: orgId,
        vacation_request_id: request.id,
        employee_record_id: request.employee_record_id,
        event_type: 'cancelled',
        event_payload: {
          start_date: request.start_date,
          end_date: request.end_date,
          cancellation_reason: reason,
          restored_days_by_year: request.approved_days_by_year,
        },
        created_by: userId,
      });
    if (eventError) {
      console.error('Failed to record cancellation event:', eventError);
    }

    invalidateVacation(orgId);
    return { success: true, request: toVacationRequest(updated) };
  } catch (error) {
    console.error('Unexpected error in cancelApprovedVacationRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Approver queue (Anträge tab)
// ============================================

export type ApproverVacationRequest = {
  request: VacationRequest;
  personName: string;
  totalDays: number;
  balance: VacationBalance | null;
  /** Conflict signals — visible context, never blocking. */
  overlappingApprovedVacation: Array<{
    startDate: string;
    endDate: string;
  }>;
  assignedJobsInRange: Array<{ title: string; plannedDate: string }>;
  hasEntitlement: boolean;
};

export type ApproverVacationRequestsResult =
  | { success: true; requests: ApproverVacationRequest[] }
  | { success: false; error: string };

export async function getPendingVacationRequestsForApprover(): Promise<ApproverVacationRequestsResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId } = auth.context;

    const admin = createSupabaseAdminClient();
    const { data: pendingRows, error: pendingError } = await admin
      .from('vacation_requests')
      .select('*')
      .eq('organization_id', orgId)
      .eq('status', 'pending')
      .order('start_date', { ascending: true });
    if (pendingError) {
      console.error('Failed to load pending vacation requests:', pendingError);
      return { success: false, error: 'fetch_failed' };
    }
    if (!pendingRows || pendingRows.length === 0) {
      return { success: true, requests: [] };
    }

    const recordIds = [
      ...new Set(pendingRows.map((row) => row.employee_record_id)),
    ];
    const { data: records, error: recordsError } = await admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .in('id', recordIds);
    if (recordsError) {
      console.error('Failed to load request records:', recordsError);
      return { success: false, error: 'fetch_failed' };
    }
    const recordById = new Map((records ?? []).map((row) => [row.id, row]));

    const targetUserIds = [
      ...new Set(
        (records ?? [])
          .map((row) => row.user_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const [membershipsResult, profilesResult] = await Promise.all([
      targetUserIds.length > 0
        ? admin
            .from('organization_members')
            .select('user_id, role')
            .eq('organization_id', orgId)
            .in('user_id', targetUserIds)
        : Promise.resolve({ data: [], error: null }),
      targetUserIds.length > 0
        ? admin
            .from('profiles')
            .select('id, first_name, last_name')
            .in('id', targetUserIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (membershipsResult.error || profilesResult.error) {
      console.error(
        'Failed to load request target context:',
        membershipsResult.error ?? profilesResult.error
      );
      return { success: false, error: 'fetch_failed' };
    }
    const roleByUserId = new Map(
      (membershipsResult.data ?? []).map((row) => [
        row.user_id,
        row.role as OrgRole,
      ])
    );
    const profileByUserId = new Map(
      (profilesResult.data ?? []).map((row) => [row.id, row])
    );

    // Authorization filter: per pending request, keep it only when the actor
    // may decide it right now (self-approval denied by the shared helper).
    const results: ApproverVacationRequest[] = [];
    for (const row of pendingRows) {
      const record = recordById.get(row.employee_record_id);
      if (!record?.user_id) continue;
      const targetRole = roleByUserId.get(record.user_id);
      if (!targetRole) continue;

      const authorization = await authorizeResponsibilityForTarget({
        organizationId: orgId,
        responsibility: 'leave_approval',
        actorUserId: userId,
        targetUserId: record.user_id,
        targetRole,
      });
      if (!authorization.success) continue;

      const context = await loadVacationCountingContext(orgId, record.id);
      if (!context) continue;
      const requests = await loadVacationRequestsForRecord(orgId, record.id);

      const profile = profileByUserId.get(record.user_id);
      const firstName = profile?.first_name ?? record.first_name ?? '';
      const lastName = profile?.last_name ?? record.last_name ?? '';

      const year = Number(row.start_date.slice(0, 4));
      const balance = requests
        ? computeVacationBalance(year, requests, context)
        : null;

      // Conflict signals: the person's other approved vacation and their
      // assigned jobs planned inside the requested range.
      const overlappingApprovedVacation = (requests ?? [])
        .filter(
          (candidate) =>
            candidate.status === 'approved' &&
            candidate.startDate <= row.end_date &&
            candidate.endDate >= row.start_date
        )
        .map((candidate) => ({
          startDate: candidate.startDate,
          endDate: candidate.endDate,
        }));

      const { data: assignmentRows } = await admin
        .from('job_assignments')
        .select('job_id')
        .eq('user_id', record.user_id);
      const jobIds = (assignmentRows ?? []).map((entry) => entry.job_id);
      let assignedJobsInRange: Array<{ title: string; plannedDate: string }> =
        [];
      if (jobIds.length > 0) {
        const { data: jobRows } = await admin
          .from('jobs')
          .select('title, planned_date')
          .eq('organization_id', orgId)
          .in('id', jobIds)
          .gte('planned_date', row.start_date)
          .lte('planned_date', row.end_date);
        assignedJobsInRange = (jobRows ?? [])
          .filter(
            (job): job is { title: string; planned_date: string } =>
              job.planned_date !== null
          )
          .map((job) => ({ title: job.title, plannedDate: job.planned_date }));
      }

      results.push({
        request: toVacationRequest(row),
        personName: `${firstName} ${lastName}`.trim() || 'Unbekannt',
        totalDays: countVacationDays(
          {
            startDate: row.start_date,
            endDate: row.end_date,
            dayPortion: row.day_portion as VacationDayPortion,
          },
          context
        ),
        balance,
        overlappingApprovedVacation,
        assignedJobsInRange,
        hasEntitlement:
          resolveVacationEntitlementForYear(context.conditions, year) !== null,
      });
    }

    return { success: true, requests: results };
  } catch (error) {
    console.error(
      'Unexpected error in getPendingVacationRequestsForApprover:',
      error
    );
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Approved requests for approvers (retroactive cancellation surface)
// ============================================

export async function getDecidableApprovedVacationRequests(): Promise<ApproverVacationRequestsResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId } = auth.context;

    const admin = createSupabaseAdminClient();
    const businessDate = getBusinessTodayIso();
    // Show approved vacation that is current or upcoming plus the recent past
    // (correction window); older history stays inspectable per person.
    const { data: approvedRows, error: approvedError } = await admin
      .from('vacation_requests')
      .select('*')
      .eq('organization_id', orgId)
      .eq('status', 'approved')
      .gte('end_date', shiftIsoDateByDays(businessDate, -60))
      .order('start_date', { ascending: true });
    if (approvedError) {
      console.error('Failed to load approved vacation requests:', approvedError);
      return { success: false, error: 'fetch_failed' };
    }
    if (!approvedRows || approvedRows.length === 0) {
      return { success: true, requests: [] };
    }

    const recordIds = [
      ...new Set(approvedRows.map((row) => row.employee_record_id)),
    ];
    const { data: records, error: recordsError } = await admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .in('id', recordIds);
    if (recordsError) {
      console.error('Failed to load approved request records:', recordsError);
      return { success: false, error: 'fetch_failed' };
    }
    const recordById = new Map((records ?? []).map((row) => [row.id, row]));

    const targetUserIds = [
      ...new Set(
        (records ?? [])
          .map((row) => row.user_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const [membershipsResult, profilesResult] = await Promise.all([
      targetUserIds.length > 0
        ? admin
            .from('organization_members')
            .select('user_id, role')
            .eq('organization_id', orgId)
            .in('user_id', targetUserIds)
        : Promise.resolve({ data: [], error: null }),
      targetUserIds.length > 0
        ? admin
            .from('profiles')
            .select('id, first_name, last_name')
            .in('id', targetUserIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (membershipsResult.error || profilesResult.error) {
      console.error(
        'Failed to load approved request context:',
        membershipsResult.error ?? profilesResult.error
      );
      return { success: false, error: 'fetch_failed' };
    }
    const roleByUserId = new Map(
      (membershipsResult.data ?? []).map((row) => [
        row.user_id,
        row.role as OrgRole,
      ])
    );
    const profileByUserId = new Map(
      (profilesResult.data ?? []).map((row) => [row.id, row])
    );

    const results: ApproverVacationRequest[] = [];
    for (const row of approvedRows) {
      const record = recordById.get(row.employee_record_id);
      if (!record?.user_id) continue;
      const targetRole = roleByUserId.get(record.user_id);
      if (!targetRole) continue;

      const authorization = await authorizeResponsibilityForTarget({
        organizationId: orgId,
        responsibility: 'leave_approval',
        actorUserId: userId,
        targetUserId: record.user_id,
        targetRole,
      });
      if (!authorization.success) continue;

      const profile = profileByUserId.get(record.user_id);
      const firstName = profile?.first_name ?? record.first_name ?? '';
      const lastName = profile?.last_name ?? record.last_name ?? '';
      const request = toVacationRequest(row);

      results.push({
        request,
        personName: `${firstName} ${lastName}`.trim() || 'Unbekannt',
        totalDays: request.approvedDaysByYear
          ? Object.values(request.approvedDaysByYear).reduce(
              (total, days) => total + days,
              0
            )
          : 0,
        balance: null,
        overlappingApprovedVacation: [],
        assignedJobsInRange: [],
        hasEntitlement: true,
      });
    }

    return { success: true, requests: results };
  } catch (error) {
    console.error(
      'Unexpected error in getDecidableApprovedVacationRequests:',
      error
    );
    return { success: false, error: 'unexpected_error' };
  }
}

function shiftIsoDateByDays(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

// ============================================
// Calendar consumption (labeled absence entries)
// ============================================

export type VacationCalendarEntry = {
  id: string;
  personName: string;
  startDate: string;
  endDate: string;
  dayPortion: VacationDayPortion;
  status: 'approved' | 'pending';
};

export type VacationCalendarEntriesResult =
  | { success: true; entries: VacationCalendarEntry[] }
  | { success: false; error: string };

export async function getVacationCalendarEntries(): Promise<VacationCalendarEntriesResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId, role } = auth.context;
    const isManager = role === 'admin' || role === 'buero';

    const admin = createSupabaseAdminClient();
    let query = admin
      .from('vacation_requests')
      .select('id, employee_record_id, start_date, end_date, day_portion, status')
      .eq('organization_id', orgId)
      .in('status', ['approved', 'pending']);

    if (!isManager) {
      const { data: ownRecord, error: ownRecordError } = await admin
        .from('employee_records')
        .select('id')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();
      if (ownRecordError) {
        console.error('Failed to load own record for calendar:', ownRecordError);
        return { success: false, error: 'load_failed' };
      }
      if (!ownRecord) return { success: true, entries: [] };
      query = query.eq('employee_record_id', ownRecord.id);
    }

    const { data: rows, error } = await query;
    if (error) {
      console.error('Failed to load vacation calendar entries:', error);
      return { success: false, error: 'load_failed' };
    }
    if (!rows || rows.length === 0) return { success: true, entries: [] };

    const recordIds = [...new Set(rows.map((row) => row.employee_record_id))];
    const { data: records, error: recordsError } = await admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .in('id', recordIds);
    if (recordsError) {
      console.error('Failed to load calendar records:', recordsError);
      return { success: false, error: 'load_failed' };
    }
    const userIds = [
      ...new Set(
        (records ?? [])
          .map((row) => row.user_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const profilesResult =
      userIds.length > 0
        ? await admin
            .from('profiles')
            .select('id, first_name, last_name')
            .in('id', userIds)
        : { data: [], error: null };
    if (profilesResult.error) {
      console.error(
        'Failed to load calendar profiles:',
        profilesResult.error
      );
      return { success: false, error: 'load_failed' };
    }
    const profileByUserId = new Map(
      (profilesResult.data ?? []).map((row) => [row.id, row])
    );
    const nameByRecordId = new Map(
      (records ?? []).map((record) => {
        const profile = record.user_id
          ? profileByUserId.get(record.user_id)
          : undefined;
        const firstName = profile?.first_name ?? record.first_name ?? '';
        const lastName = profile?.last_name ?? record.last_name ?? '';
        return [record.id, `${firstName} ${lastName}`.trim() || 'Unbekannt'];
      })
    );

    return {
      success: true,
      entries: rows.map((row) => ({
        id: row.id,
        personName: nameByRecordId.get(row.employee_record_id) ?? 'Unbekannt',
        startDate: row.start_date,
        endDate: row.end_date,
        dayPortion: row.day_portion as VacationDayPortion,
        status: row.status as 'approved' | 'pending',
      })),
    };
  } catch (error) {
    console.error('Unexpected error in getVacationCalendarEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

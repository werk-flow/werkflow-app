'use server';
import { logReadFailure } from '@/lib/data/read-request-cache';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { resolveActionContext } from '@/lib/org/action-context';
import { getBusinessTodayIso, shiftIsoDateByDays } from '@/lib/personnel/types';
import {
  defaultCalendarWindow,
  isValidIsoDate,
  parseIsoDateRange,
  type IsoDateRange,
} from '@/lib/calendar/date-range';
import { authorizeResponsibilityForTarget } from '@/lib/responsibilities/server';
import type { OrgRole } from '@/lib/members/actions';
import {
  computeVacationBalance,
  countCalendarDaysInRange,
  countVacationDays,
  countVacationDaysByYear,
  MAX_VACATION_RANGE_DAYS,
  resolveVacationEntitlementForYear,
  type VacationBalance,
} from './balance';
import { loadVacationCountingContext, loadVacationRequestsForRecord } from './server';
import {
  sumApprovedDays,
  toVacationRequest,
  type VacationDayPortion,
  type VacationRequest,
  type VacationRequestRow,
} from './types';
import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { isManagerRole } from '@/lib/roles';
import type { ActionFailure } from '@/lib/action-result';

const withdrawVacationSchema = z.object({ requestId: uuidSchema });
const decideVacationSchema = z.object({
  requestId: uuidSchema,
  decision: z.enum(['approve', 'reject']),
  comment: z.string().max(2000).optional(),
});
const cancelVacationSchema = z.object({ requestId: uuidSchema, reason: z.string().max(2000) });
const vacationCalendarRangeSchema = z.object({ from: z.string().max(10), to: z.string().max(10) }).optional();

// Shape and bounds only; validateVacationRequestInput owns the date and portion rules.
const vacationRequestInputSchema = z.object({
  startDate: z.string().max(10),
  endDate: z.string().max(10),
  dayPortion: z.enum(['full', 'half_day']),
  comment: z.string().max(2000).optional(),
});

type VacationRequestInput = {
  startDate: string;
  endDate: string;
  dayPortion: VacationDayPortion;
  comment?: string;
};

function validateVacationRequestInput(
  input: Pick<VacationRequestInput, 'startDate' | 'endDate' | 'dayPortion'>,
): string | null {
  if (!isValidIsoDate(input.startDate) || !isValidIsoDate(input.endDate)) {
    return 'invalid_dates';
  }
  if (input.endDate < input.startDate) return 'invalid_range';
  if (countCalendarDaysInRange(input.startDate, input.endDate) > MAX_VACATION_RANGE_DAYS) {
    return 'range_too_long';
  }
  if (input.dayPortion !== 'full' && input.dayPortion !== 'half_day') {
    return 'invalid_portion';
  }
  if (input.dayPortion === 'half_day' && input.startDate !== input.endDate) {
    return 'half_day_needs_single_day';
  }
  return null;
}

// The refusals of create_vacation_request, withdraw_vacation_request,
// decide_vacation_request and cancel_approved_vacation_request, each an action
// failure code.
const VACATION_WRITE_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_input',
  'invalid_decision',
  'reason_required',
  'request_not_found',
  'not_a_member',
  'not_authorized',
  'no_employee_record',
  'overlap_conflict',
  'self_approval_not_allowed',
  'request_not_pending',
  'request_not_approved',
]);

// The result of one vacation write function: the saved request, the refusal
// raised under the lock, or the action's own failure code for anything else.
function vacationWriteResult(
  outcome: { data: VacationRequestRow | null; error: { message: string } | null },
  failureCode: string,
  logLabel: string,
): { success: true; request: VacationRequest } | ActionFailure {
  if (outcome.error && VACATION_WRITE_REFUSALS.has(outcome.error.message)) {
    return { success: false, error: outcome.error.message };
  }
  if (outcome.error || !outcome.data) {
    logError(logLabel, outcome.error);
    return { success: false, error: failureCode };
  }
  return { success: true, request: toVacationRequest(outcome.data) };
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

export type OwnVacationOverviewResult = { success: true; overview: OwnVacationOverview } | ActionFailure;

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
      logError('Failed to load own employee record:', recordError);
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
                ? sumApprovedDays(request)
                : countVacationDays(request, context),
        })),
      },
    };
  } catch (error) {
    logError('Unexpected error in getOwnVacationOverview:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Create / withdraw (the one employee self-service write path)
// ============================================

export type CreateVacationRequestResult = { success: true; request: VacationRequest } | ActionFailure;

export type VacationRequestPreviewResult = { success: true; totalDays: number } | ActionFailure;

export async function previewVacationRequest(
  rawInput: VacationRequestInput,
): Promise<VacationRequestPreviewResult> {
  const parsedInput = vacationRequestInputSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const validationError = validateVacationRequestInput(input);
    if (validationError) return { success: false, error: validationError };

    const admin = createSupabaseAdminClient();
    const { data: record, error } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', auth.context.orgId)
      .eq('user_id', auth.context.userId)
      .maybeSingle();
    if (error) {
      logError('Error fetching employee record for vacation preview:', error);
      return { success: false, error: 'load_failed' };
    }
    if (!record) return { success: false, error: 'no_employee_record' };

    const context = await loadVacationCountingContext(auth.context.orgId, record.id);
    if (!context) return { success: false, error: 'load_failed' };
    return { success: true, totalDays: countVacationDays(input, context) };
  } catch (error) {
    logError('Unexpected error in previewVacationRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function createVacationRequest(
  rawInput: VacationRequestInput,
): Promise<CreateVacationRequestResult> {
  const parsedInput = vacationRequestInputSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId } = auth.context;

    const validationError = validateVacationRequestInput(input);
    if (validationError) return { success: false, error: validationError };

    const admin = createSupabaseAdminClient();
    const { data: record, error: recordError } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    if (recordError || !record) {
      if (recordError) {
        logError('Failed to load record for request:', recordError);
      }
      return { success: false, error: 'no_employee_record' };
    }

    // The preview days go into the 'requested' history row; a missing
    // counting context records them as null, as before.
    const context = await loadVacationCountingContext(orgId, record.id);
    // One call stores the pending request and its 'requested' history row, or
    // refuses with one of VACATION_WRITE_REFUSALS and changes nothing.
    const outcome = await admin.rpc(
      'create_vacation_request',
      rpcArgs('create_vacation_request', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_employee_record_id: record.id,
        p_start_date: input.startDate,
        p_end_date: input.endDate,
        p_day_portion: input.dayPortion,
        p_comment: input.comment?.trim() || null,
        p_preview_days_by_year: context ? countVacationDaysByYear(input, context) : null,
      }),
    );
    return vacationWriteResult(outcome, 'insert_failed', 'Failed to insert vacation request:');
  } catch (error) {
    logError('Unexpected error in createVacationRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type VacationTransitionResult = { success: true; request: VacationRequest } | ActionFailure;

export async function withdrawVacationRequest(rawInput: {
  requestId: string;
}): Promise<VacationTransitionResult> {
  const parsedInput = withdrawVacationSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
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
      logError('Failed to load vacation request:', loadError);
      return { success: false, error: 'load_failed' };
    }
    if (!existing) return { success: false, error: 'request_not_found' };

    // Only the requester withdraws, and only while the request is pending.
    const { data: ownRecord, error: ownRecordError } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    if (ownRecordError) {
      logError('Failed to load own employee record:', ownRecordError);
      return { success: false, error: 'load_failed' };
    }
    if (!ownRecord || ownRecord.id !== existing.employee_record_id) {
      return { success: false, error: 'not_authorized' };
    }
    if (existing.status !== 'pending') {
      return { success: false, error: 'request_not_pending' };
    }

    // One call repeats the owner and status checks under lock, so a concurrent
    // decision wins deterministically, and records the 'withdrawn' history row.
    const outcome = await admin.rpc(
      'withdraw_vacation_request',
      rpcArgs('withdraw_vacation_request', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_request_id: existing.id,
      }),
    );
    return vacationWriteResult(outcome, 'update_failed', 'Failed to withdraw vacation request:');
  } catch (error) {
    logError('Unexpected error in withdrawVacationRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Decisions (leave_approval holders, resolved at action time)
// ============================================

async function loadRequestWithTarget(
  orgId: string,
  requestId: string,
): Promise<
  | {
      success: true;
      request: VacationRequestRow;
      targetUserId: string;
      targetRole: OrgRole;
    }
  | ActionFailure
> {
  const admin = createSupabaseAdminClient();
  const { data: request, error: loadError } = await admin
    .from('vacation_requests')
    .select('*')
    .eq('id', requestId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (loadError) {
    logError('Failed to load vacation request:', loadError);
    return { success: false, error: 'load_failed' };
  }
  if (!request) return { success: false, error: 'request_not_found' };

  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('id', request.employee_record_id)
    .maybeSingle();
  if (recordError || !record?.user_id) {
    if (recordError) {
      logError('Failed to load request target record:', recordError);
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
      logError('Failed to load request target membership:', membershipError);
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

export async function decideVacationRequest(rawInput: {
  requestId: string;
  decision: 'approve' | 'reject';
  comment?: string;
}): Promise<VacationTransitionResult> {
  const parsedInput = decideVacationSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId } = auth.context;

    // Runtime guard: an unexpected value must never fall through into the
    // rejection branch without its required reason.
    if (input.decision !== 'approve' && input.decision !== 'reject') {
      return { success: false, error: 'invalid_decision' };
    }
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

    let approvedDaysByYear: Record<string, number> | null = null;
    if (input.decision === 'approve') {
      const context = await loadVacationCountingContext(orgId, request.employee_record_id);
      if (!context) return { success: false, error: 'load_failed' };
      approvedDaysByYear = countVacationDaysByYear(
        {
          startDate: request.start_date,
          endDate: request.end_date,
          dayPortion: request.day_portion as VacationDayPortion,
        },
        context,
      );
    }

    // One call repeats the self-approval and status checks under lock, stores
    // the decision with its approved-days snapshot and records the 'approved'
    // or 'rejected' history row, or changes nothing.
    const outcome = await createSupabaseAdminClient().rpc(
      'decide_vacation_request',
      rpcArgs('decide_vacation_request', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_request_id: request.id,
        p_decision: input.decision,
        p_comment: comment,
        p_approved_days_by_year: approvedDaysByYear,
      }),
    );
    return vacationWriteResult(outcome, 'update_failed', 'Failed to decide vacation request:');
  } catch (error) {
    logError('Unexpected error in decideVacationRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function cancelApprovedVacationRequest(rawInput: {
  requestId: string;
  reason: string;
}): Promise<VacationTransitionResult> {
  const parsedInput = cancelVacationSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
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

    // One call repeats the self-approval and status checks under lock, cancels
    // the request and records the 'cancelled' history row with the restored
    // days, or changes nothing.
    const outcome = await createSupabaseAdminClient().rpc(
      'cancel_approved_vacation_request',
      rpcArgs('cancel_approved_vacation_request', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_request_id: request.id,
        p_reason: reason,
      }),
    );
    return vacationWriteResult(outcome, 'update_failed', 'Failed to cancel vacation request:');
  } catch (error) {
    logError('Unexpected error in cancelApprovedVacationRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Approver queue (Anträge tab)
// ============================================

type RequestTargetMaps = {
  recordById: Map<
    string,
    {
      id: string;
      user_id: string | null;
      first_name: string | null;
      last_name: string | null;
    }
  >;
  roleByUserId: Map<string, OrgRole>;
  profileByUserId: Map<string, { id: string; first_name: string | null; last_name: string | null }>;
};

// Shared target-context loading for both approver queues: employee records,
// their memberships, and display profiles for a set of request record ids.
async function loadRequestTargetMaps(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
  recordIds: string[],
): Promise<RequestTargetMaps | null> {
  const { data: records, error: recordsError } = await readInBatches(recordIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  if (recordsError) {
    logError('Failed to load request records:', recordsError);
    return null;
  }
  const recordById = new Map(records.map((row) => [row.id, row]));

  const targetUserIds = records.map((row) => row.user_id).filter((id): id is string => Boolean(id));
  const [membershipsResult, profilesResult] = await Promise.all([
    readInBatches(targetUserIds, (batch) =>
      admin
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', orgId)
        .in('user_id', [...batch]),
    ),
    readInBatches(targetUserIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', [...batch]),
    ),
  ]);
  if (membershipsResult.error || profilesResult.error) {
    logError('Failed to load request target context:', membershipsResult.error ?? profilesResult.error);
    return null;
  }

  return {
    recordById,
    roleByUserId: new Map((membershipsResult.data ?? []).map((row) => [row.user_id, row.role as OrgRole])),
    profileByUserId: new Map((profilesResult.data ?? []).map((row) => [row.id, row])),
  };
}

function formatTargetName(
  record: { first_name: string | null; last_name: string | null },
  profile: { first_name: string | null; last_name: string | null } | undefined,
): string {
  const firstName = profile?.first_name ?? record.first_name ?? '';
  const lastName = profile?.last_name ?? record.last_name ?? '';
  return `${firstName} ${lastName}`.trim() || 'Unbekannt';
}

export type ApproverVacationRequest = {
  request: VacationRequest;
  personName: string;
  totalDays: number;
  balance: VacationBalance | null;
  /** Privacy-safe conflict signal — visible context, never blocking. */
  hasAbsenceOverlap: boolean;
  assignedJobsInRange: Array<{ title: string; plannedDate: string }>;
  hasEntitlement: boolean;
};

export type ApproverVacationRequestsResult =
  | { success: true; requests: ApproverVacationRequest[] }
  | ActionFailure;

export async function getPendingVacationRequestsForApprover(): Promise<ApproverVacationRequestsResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId } = auth.context;

    const admin = createSupabaseAdminClient();
    const { data: pendingRows, error: pendingError } = await readCompleteRows(
      (from, to) =>
        admin
          .from('vacation_requests')
          .select('*')
          .eq('organization_id', orgId)
          .eq('status', 'pending')
          .order('start_date', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    );
    if (pendingError) {
      logError('Failed to load pending vacation requests:', pendingError);
      return { success: false, error: 'fetch_failed' };
    }
    if (pendingRows.length === 0) {
      return { success: true, requests: [] };
    }

    const recordIds = [...new Set(pendingRows.map((row) => row.employee_record_id))];
    const maps = await loadRequestTargetMaps(admin, orgId, recordIds);
    if (!maps) return { success: false, error: 'fetch_failed' };
    const { recordById, roleByUserId, profileByUserId } = maps;

    const { data: activeAbsenceRows, error: absenceError } = await readInBatches(recordIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('sickness_reports')
            .select('employee_record_id, start_date, end_date')
            .eq('organization_id', orgId)
            .eq('status', 'reported')
            .in('employee_record_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    );
    if (absenceError) {
      logError('Error fetching active absences for vacation approvals:', absenceError);
      return { success: false, error: 'fetch_failed' };
    }

    // One batched assignment lookup instead of one query per pending row.
    const pendingUserIds = [
      ...new Set(
        recordIds
          .map((recordId) => recordById.get(recordId)?.user_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const jobIdsByUserId = new Map<string, string[]>();
    const { data: assignmentRows, error: assignmentError } = await readInBatches(pendingUserIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('job_assignments')
            .select('job_id, user_id')
            .eq('organization_id', orgId)
            .in('user_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    );
    // A failed conflict read must not tell the approver there are no conflicts.
    if (assignmentError) {
      logError('Error fetching job assignments for vacation approvals:', assignmentError);
      return { success: false, error: 'fetch_failed' };
    }
    for (const assignment of assignmentRows) {
      const jobIds = jobIdsByUserId.get(assignment.user_id) ?? [];
      jobIds.push(assignment.job_id);
      jobIdsByUserId.set(assignment.user_id, jobIds);
    }

    // One jobs read over the whole pending span; each row filters its own range below.
    const earliestStart = pendingRows
      .map((row) => row.start_date)
      .reduce((min, date) => (date < min ? date : min));
    const latestEnd = pendingRows.map((row) => row.end_date).reduce((max, date) => (date > max ? date : max));
    const assignedJobIds = [...new Set(assignmentRows.map((assignment) => assignment.job_id))];
    const { data: jobRows, error: jobError } = await readInBatches(assignedJobIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('jobs')
            .select('id, title, planned_date')
            .eq('organization_id', orgId)
            .in('id', [...batch])
            .gte('planned_date', earliestStart)
            .lte('planned_date', latestEnd)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    );
    if (jobError) {
      logError('Error fetching assigned jobs for vacation approvals:', jobError);
      return { success: false, error: 'fetch_failed' };
    }
    const plannedJobById = new Map(
      jobRows
        .filter(
          (job): job is { id: string; title: string; planned_date: string } => job.planned_date !== null,
        )
        .map((job) => [job.id, { title: job.title, plannedDate: job.planned_date }]),
    );

    // Authorization filter: per pending request, keep it only when the actor
    // may decide it right now (self-approval denied by the shared helper).
    // Per-record work is memoized so duplicate rows never re-query.
    const authorizationByRecordId = new Map<string, boolean>();
    const contextByRecordId = new Map<string, Awaited<ReturnType<typeof loadVacationCountingContext>>>();
    const requestsByRecordId = new Map<string, Awaited<ReturnType<typeof loadVacationRequestsForRecord>>>();

    const results: ApproverVacationRequest[] = [];
    for (const row of pendingRows) {
      const record = recordById.get(row.employee_record_id);
      if (!record?.user_id) continue;
      const targetRole = roleByUserId.get(record.user_id);
      if (!targetRole) continue;

      let authorized = authorizationByRecordId.get(record.id);
      if (authorized === undefined) {
        const authorization = await authorizeResponsibilityForTarget({
          organizationId: orgId,
          responsibility: 'leave_approval',
          actorUserId: userId,
          targetUserId: record.user_id,
          targetRole,
        });
        authorized = authorization.success;
        authorizationByRecordId.set(record.id, authorized);
      }
      if (!authorized) continue;

      let context = contextByRecordId.get(record.id);
      if (context === undefined) {
        context = await loadVacationCountingContext(orgId, record.id);
        contextByRecordId.set(record.id, context);
      }
      if (!context) continue;

      let requests = requestsByRecordId.get(record.id);
      if (requests === undefined) {
        requests = await loadVacationRequestsForRecord(orgId, record.id);
        requestsByRecordId.set(record.id, requests);
      }

      const year = Number(row.start_date.slice(0, 4));
      const balance = requests ? computeVacationBalance(year, requests, context) : null;

      const hasAbsenceOverlap = activeAbsenceRows.some(
        (absence) =>
          absence.employee_record_id === record.id &&
          absence.start_date <= row.end_date &&
          (absence.end_date === null || absence.end_date >= row.start_date),
      );

      const assignedJobsInRange = [...new Set(jobIdsByUserId.get(record.user_id))].flatMap((jobId) => {
        const job = plannedJobById.get(jobId);
        return job && job.plannedDate >= row.start_date && job.plannedDate <= row.end_date ? [job] : [];
      });

      results.push({
        request: toVacationRequest(row),
        personName: formatTargetName(record, profileByUserId.get(record.user_id)),
        totalDays: countVacationDays(
          {
            startDate: row.start_date,
            endDate: row.end_date,
            dayPortion: row.day_portion as VacationDayPortion,
          },
          context,
        ),
        balance,
        hasAbsenceOverlap,
        assignedJobsInRange,
        hasEntitlement: resolveVacationEntitlementForYear(context.conditions, year) !== null,
      });
    }

    return { success: true, requests: results };
  } catch (error) {
    logError('Unexpected error in getPendingVacationRequestsForApprover:', error);
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
    const { data: approvedRows, error: approvedError } = await readCompleteRows(
      (from, to) =>
        admin
          .from('vacation_requests')
          .select('*')
          .eq('organization_id', orgId)
          .eq('status', 'approved')
          .gte('end_date', shiftIsoDateByDays(businessDate, -60))
          .order('start_date', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    );
    if (approvedError) {
      logError('Failed to load approved vacation requests:', approvedError);
      return { success: false, error: 'fetch_failed' };
    }
    if (approvedRows.length === 0) {
      return { success: true, requests: [] };
    }

    const recordIds = [...new Set(approvedRows.map((row) => row.employee_record_id))];
    const maps = await loadRequestTargetMaps(admin, orgId, recordIds);
    if (!maps) return { success: false, error: 'fetch_failed' };
    const { recordById, roleByUserId, profileByUserId } = maps;

    const authorizationByRecordId = new Map<string, boolean>();
    const results: ApproverVacationRequest[] = [];
    for (const row of approvedRows) {
      const record = recordById.get(row.employee_record_id);
      if (!record?.user_id) continue;
      const targetRole = roleByUserId.get(record.user_id);
      if (!targetRole) continue;

      let authorized = authorizationByRecordId.get(record.id);
      if (authorized === undefined) {
        const authorization = await authorizeResponsibilityForTarget({
          organizationId: orgId,
          responsibility: 'leave_approval',
          actorUserId: userId,
          targetUserId: record.user_id,
          targetRole,
        });
        authorized = authorization.success;
        authorizationByRecordId.set(record.id, authorized);
      }
      if (!authorized) continue;

      const request = toVacationRequest(row);
      // The approved card shows person, range, and snapshot days only:
      // balance/entitlement context belongs to the pending decision, not the
      // cancellation surface, so it is deliberately not re-resolved here.
      results.push({
        request,
        personName: formatTargetName(record, profileByUserId.get(record.user_id)),
        totalDays: sumApprovedDays(request),
        balance: null,
        hasAbsenceOverlap: false,
        assignedJobsInRange: [],
        hasEntitlement: true,
      });
    }

    return { success: true, requests: results };
  } catch (error) {
    logError('Unexpected error in getDecidableApprovedVacationRequests:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Calendar consumption (labeled absence entries)
// ============================================

export type VacationCalendarEntry = {
  id: string;
  employeeRecordId: string;
  personName: string;
  startDate: string;
  endDate: string;
  dayPortion: VacationDayPortion;
  status: 'approved' | 'pending';
};

export type VacationCalendarEntriesResult =
  | { success: true; entries: VacationCalendarEntry[] }
  | ActionFailure;

export async function getVacationCalendarEntries(
  rangeInput?: IsoDateRange,
): Promise<VacationCalendarEntriesResult> {
  const parsedRange = vacationCalendarRangeSchema.safeParse(rangeInput);
  if (!parsedRange.success) return { success: false, error: 'invalid_input' };
  const range = parsedRange.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId, role } = auth.context;
    const isManager = isManagerRole(role);

    // The calendar passes the window it renders, bounded at this boundary.
    // Without one, the default window of one year back and two ahead keeps
    // the payload bounded.
    const window = range === undefined ? defaultCalendarWindow() : parseIsoDateRange(range);
    if (!window) return { success: false, error: 'invalid_input' };
    const { from: windowStartIso, to: windowEndIso } = window;

    const admin = createSupabaseAdminClient();
    let query = admin
      .from('vacation_requests')
      .select('id, employee_record_id, start_date, end_date, day_portion, status')
      .eq('organization_id', orgId)
      .in('status', ['approved', 'pending'])
      .lte('start_date', windowEndIso)
      .gte('end_date', windowStartIso)
      .order('start_date')
      .order('id');

    if (!isManager) {
      const { data: ownRecord, error: ownRecordError } = await admin
        .from('employee_records')
        .select('id')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();
      if (ownRecordError) {
        logError('Failed to load own record for calendar:', ownRecordError);
        return { success: false, error: 'load_failed' };
      }
      if (!ownRecord) return { success: true, entries: [] };
      query = query.eq('employee_record_id', ownRecord.id);
    }

    const { data: rows, error } = await readCompleteRows((from, to) => query.range(from, to), LIST_ROW_CAP);
    if (error) {
      logReadFailure('Failed to load vacation calendar entries:', error);
      return { success: false, error: 'load_failed' };
    }
    if (!rows || rows.length === 0) return { success: true, entries: [] };

    const recordIds = [...new Set(rows.map((row) => row.employee_record_id))];
    const { data: records, error: recordsError } = await readInBatches(recordIds, (ids) =>
      admin
        .from('employee_records')
        .select('id, user_id, first_name, last_name')
        .eq('organization_id', orgId)
        .in('id', [...ids]),
    );
    if (recordsError) {
      logError('Failed to load calendar records:', recordsError);
      return { success: false, error: 'load_failed' };
    }
    const userIds = [
      ...new Set((records ?? []).map((row) => row.user_id).filter((id): id is string => Boolean(id))),
    ];
    const profilesResult =
      userIds.length > 0
        ? await readInBatches(userIds, (ids) =>
            admin
              .from('profiles')
              .select('id, first_name, last_name')
              .in('id', [...ids]),
          )
        : { data: [], error: null };
    if (profilesResult.error) {
      logError('Failed to load calendar profiles:', profilesResult.error);
      return { success: false, error: 'load_failed' };
    }
    const profileByUserId = new Map((profilesResult.data ?? []).map((row) => [row.id, row]));
    const nameByRecordId = new Map(
      (records ?? []).map((record) => {
        const profile = record.user_id ? profileByUserId.get(record.user_id) : undefined;
        const firstName = profile?.first_name ?? record.first_name ?? '';
        const lastName = profile?.last_name ?? record.last_name ?? '';
        return [record.id, `${firstName} ${lastName}`.trim() || 'Unbekannt'];
      }),
    );

    return {
      success: true,
      entries: rows.map((row) => ({
        id: row.id,
        employeeRecordId: row.employee_record_id,
        personName: nameByRecordId.get(row.employee_record_id) ?? 'Unbekannt',
        startDate: row.start_date,
        endDate: row.end_date,
        dayPortion: row.day_portion as VacationDayPortion,
        status: row.status as 'approved' | 'pending',
      })),
    };
  } catch (error) {
    logError('Unexpected error in getVacationCalendarEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

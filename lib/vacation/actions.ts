'use server';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { readCompleteRows, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { resolveActionContext } from '@/lib/org/action-context';
import { addLocalDays, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { isValidIsoDate } from '@/lib/calendar/date-range';
import { authorizeResponsibilityForTarget } from '@/lib/responsibilities/server';
import type { OrgRole } from '@/lib/roles';
import {
  computeVacationBalance,
  countCalendarDaysInRange,
  countVacationDays,
  countVacationDaysByYear,
  MAX_VACATION_RANGE_DAYS,
  resolveVacationEntitlementForYear,
  type VacationBalance,
} from './balance';
import {
  createDecisionAuthorization,
  loadActiveAbsences,
  loadPlannedJobsForRequests,
  loadRequestTargetMaps,
  resolveDecidableTarget,
  type ActiveAbsence,
  type DecidableTarget,
  type PlannedAssignedJobs,
} from './approver-targets';
import {
  createVacationCountingCache,
  loadVacationCountingContext,
  loadVacationRequestsForRecord,
  type RecordVacationCounting,
} from './server';
import {
  sumApprovedDays,
  toVacationDayPortion,
  toVacationRequest,
  type VacationDayPortion,
  type VacationRequest,
  type VacationRequestRow,
} from './types';
import { logError } from '@/lib/logging';
import { rowWriteResultFor } from '@/lib/supabase/write-refusal';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import type { ActionFailure } from '@/lib/action-result';

const withdrawVacationSchema = z.object({ requestId: uuidSchema });
const decideVacationSchema = z.object({
  requestId: uuidSchema,
  decision: z.enum(['approve', 'reject']),
  comment: z.string().max(2000).optional(),
});
const cancelVacationSchema = z.object({ requestId: uuidSchema, reason: z.string().max(2000) });

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
  // From January 1 of last year (a late request) to December 31 of next year (planning ahead).
  const businessYear = Number(getBusinessTodayIso().slice(0, 4));
  if (input.startDate < `${businessYear - 1}-01-01` || input.endDate > `${businessYear + 1}-12-31`) {
    return 'outside_request_window';
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
const vacationWriteResult = rowWriteResultFor(VACATION_WRITE_REFUSALS, (row: VacationRequestRow) => ({
  request: toVacationRequest(row),
}));

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
    targetRole: membership.role,
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
          dayPortion: toVacationDayPortion(request.day_portion),
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

function toPendingApproverRequest(
  row: VacationRequestRow,
  target: DecidableTarget,
  counting: RecordVacationCounting,
  activeAbsenceRows: ActiveAbsence[],
  planned: PlannedAssignedJobs,
): ApproverVacationRequest {
  const { recordId, targetUserId } = target;
  const { jobIdsByUserId, plannedJobById } = planned;
  const year = Number(row.start_date.slice(0, 4));
  const balance = counting.balanceFor(year);

  const hasAbsenceOverlap = activeAbsenceRows.some(
    (absence) =>
      absence.employee_record_id === recordId &&
      absence.start_date <= row.end_date &&
      (absence.end_date === null || absence.end_date >= row.start_date),
  );

  const assignedJobsInRange = [...new Set(jobIdsByUserId.get(targetUserId))].flatMap((jobId) => {
    const job = plannedJobById.get(jobId);
    return job && job.plannedDate >= row.start_date && job.plannedDate <= row.end_date ? [job] : [];
  });

  const request = toVacationRequest(row);
  return {
    request,
    personName: target.personName,
    totalDays: counting.totalDaysOf(request),
    balance,
    hasAbsenceOverlap,
    assignedJobsInRange,
    hasEntitlement: resolveVacationEntitlementForYear(counting.context.conditions, year) !== null,
  };
}

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

    const activeAbsenceRows = await loadActiveAbsences(admin, orgId, recordIds);
    if (!activeAbsenceRows) return { success: false, error: 'fetch_failed' };

    const planned = await loadPlannedJobsForRequests(orgId, pendingRows, recordIds, maps.recordById);
    // A failed conflict read must not tell the approver there are no conflicts.
    if (!planned) return { success: false, error: 'fetch_failed' };

    // Per-record work is memoized so duplicate rows never re-query or re-count.
    const isAuthorized = createDecisionAuthorization(orgId, userId);
    const countingFor = createVacationCountingCache(orgId, pendingRows);

    const results: ApproverVacationRequest[] = [];
    for (const row of pendingRows) {
      const target = await resolveDecidableTarget(row.employee_record_id, maps, isAuthorized);
      if (!target) continue;

      const counting = await countingFor(target.recordId);
      if (!counting) continue;

      results.push(toPendingApproverRequest(row, target, counting, activeAbsenceRows, planned));
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
          .gte('end_date', addLocalDays(businessDate, -60))
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

    const isAuthorized = createDecisionAuthorization(orgId, userId);
    const results: ApproverVacationRequest[] = [];
    for (const row of approvedRows) {
      const target = await resolveDecidableTarget(row.employee_record_id, maps, isAuthorized);
      if (!target) continue;

      const request = toVacationRequest(row);
      // The approved card shows person, range, and snapshot days only:
      // balance/entitlement context belongs to the pending decision, not the
      // cancellation surface, so it is deliberately not re-resolved here.
      results.push({
        request,
        personName: target.personName,
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

'use server';
import { logReadFailure } from '@/lib/data/read-request-cache';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { resolveActionContext, type ActionContext } from '@/lib/org/action-context';
import { getBusinessTodayIso, shiftIsoDateByDays } from '@/lib/personnel/types';
import { defaultCalendarWindow, parseIsoDateRange, type IsoDateRange } from '@/lib/calendar/date-range';
import { loadSicknessReportsForRecord } from './server';
import {
  toSicknessReport,
  type SicknessAbsenceType,
  type SicknessEvidenceStatus,
  type SicknessReport,
  type SicknessReportRow,
} from './types';
import type { VacationDayPortion } from '@/lib/vacation/types';
import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { isManagerRole } from '@/lib/roles';
import type { ActionFailure } from '@/lib/action-result';

// P1-08 sickness actions. A report is a FACT: effective the moment it is
// recorded, no approval lifecycle. Privacy rule (confirmed owner decision):
// the fact of unavailability flows to availability surfaces; the type and
// evidence state stay on self/manager surfaces. There is deliberately NO
// free-text note field anywhere in this domain — nothing may invite
// diagnosis detail.

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Dated sickness ranges are bounded; open-ended reports have no end yet. */
const MAX_SICKNESS_RANGE_DAYS = 366;
/** Retroactive entry is first-class but bounded to a sane window. */
const MAX_PAST_START_DAYS = 730;
const MAX_FUTURE_START_DAYS = 366;

const ABSENCE_TYPES: SicknessAbsenceType[] = ['krankheit', 'kind_krank', 'sonstige'];

// Boundary schemas: structure, ids and bounds. The date and range rules below
// keep their own error codes for the form.
const dateTextSchema = z.string().max(10);
const reasonSchema = z.string().max(2000).optional();
const dayPortionSchema = z.enum(['full', 'half_day']);
const absenceTypeSchema = z.enum(['krankheit', 'kind_krank', 'sonstige']);
const createReportSchema = z.object({
  absenceType: absenceTypeSchema,
  startDate: dateTextSchema,
  endDate: dateTextSchema.nullable(),
  dayPortion: dayPortionSchema,
});
const recordForMemberSchema = createReportSchema.extend({
  employeeRecordId: uuidSchema,
  evidenceRequired: z.boolean(),
});
const endReportSchema = z.object({ reportId: uuidSchema, endDate: dateTextSchema });
const correctReportSchema = createReportSchema.extend({ reportId: uuidSchema, reason: reasonSchema });
const cancelReportSchema = z.object({ reportId: uuidSchema, reason: reasonSchema });
const evidenceSchema = z.object({
  reportId: uuidSchema,
  evidenceRequired: z.boolean(),
  evidenceStatus: z.enum(['not_required', 'pending', 'received']),
});
const calendarRangeSchema = z.object({ from: dateTextSchema, to: dateTextSchema }).optional();

function validateReportRange(input: {
  startDate: string;
  endDate: string | null;
  dayPortion: VacationDayPortion;
}): string | null {
  if (!ISO_DATE_PATTERN.test(input.startDate)) return 'invalid_dates';
  if (input.endDate !== null && !ISO_DATE_PATTERN.test(input.endDate)) {
    return 'invalid_dates';
  }
  if (input.endDate !== null && input.endDate < input.startDate) {
    return 'invalid_range';
  }
  const todayIso = getBusinessTodayIso();
  if (input.startDate < shiftIsoDateByDays(todayIso, -MAX_PAST_START_DAYS)) {
    return 'start_too_far_past';
  }
  if (input.startDate > shiftIsoDateByDays(todayIso, MAX_FUTURE_START_DAYS)) {
    return 'start_too_far_future';
  }
  if (
    input.endDate !== null &&
    input.endDate > shiftIsoDateByDays(input.startDate, MAX_SICKNESS_RANGE_DAYS)
  ) {
    return 'range_too_long';
  }
  if (input.dayPortion !== 'full' && input.dayPortion !== 'half_day') {
    return 'invalid_portion';
  }
  if (input.dayPortion === 'half_day' && (input.endDate === null || input.endDate !== input.startDate)) {
    return 'half_day_needs_single_day';
  }
  return null;
}

async function loadOwnEmployeeRecordId(
  orgId: string,
  userId: string,
): Promise<{ recordId: string | null; failed: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    logError('Failed to load own employee record:', error);
    return { recordId: null, failed: true };
  }
  return { recordId: data?.id ?? null, failed: false };
}

// The refusals of create_sickness_report, end_sickness_report,
// correct_sickness_report, cancel_sickness_report and set_sickness_evidence,
// each an action failure code. Each function writes the report and its
// sickness_report_events row together.
const SICKNESS_WRITE_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_input',
  'not_found',
  'not_authorized',
  'no_employee_record',
  'record_not_found',
  'report_not_active',
  'reason_required',
  'invalid_range',
  'range_too_long',
  'half_day_needs_single_day',
  'invalid_evidence_state',
  'overlap_conflict',
]);

// The result of one sickness write function: the saved report, the refusal
// raised under the lock, or the action's own failure code for anything else.
function sicknessWriteResult(
  outcome: { data: SicknessReportRow | null; error: { message: string } | null },
  failureCode: string,
  logLabel: string,
): MutateSicknessReportResult {
  if (outcome.error && SICKNESS_WRITE_REFUSALS.has(outcome.error.message)) {
    return { success: false, error: outcome.error.message };
  }
  if (outcome.error || !outcome.data) {
    logError(logLabel, outcome.error);
    return { success: false, error: failureCode };
  }
  return { success: true, report: toSicknessReport(outcome.data) };
}

/**
 * Overlap hint against the person's approved vacation (visible signal, never
 * a block — sickness during approved vacation is a real case, and any
 * balance consequence stays a deliberate human decision via the existing
 * vacation cancellation path).
 */
async function hasApprovedVacationOverlap(
  orgId: string,
  employeeRecordId: string,
  startDate: string,
  endDate: string | null,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from('vacation_requests')
    .select('id')
    .eq('organization_id', orgId)
    .eq('employee_record_id', employeeRecordId)
    .eq('status', 'approved')
    .limit(1);
  query =
    endDate === null
      ? query.gte('end_date', startDate)
      : query.gte('end_date', startDate).lte('start_date', endDate);
  const { data, error } = await query;
  if (error) {
    logError('Failed vacation overlap check:', error);
    return false;
  }
  return (data ?? []).length > 0;
}

// ============================================
// Reads
// ============================================

export type OwnSicknessOverview = {
  employeeRecordId: string | null;
  businessDate: string;
  reports: SicknessReport[];
};

export type OwnSicknessOverviewResult = { success: true; overview: OwnSicknessOverview } | ActionFailure;

export async function getOwnSicknessReports(): Promise<OwnSicknessOverviewResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId } = auth.context;

    const businessDate = getBusinessTodayIso();
    const { recordId, failed } = await loadOwnEmployeeRecordId(orgId, userId);
    if (failed) return { success: false, error: 'load_failed' };
    if (!recordId) {
      return {
        success: true,
        overview: { employeeRecordId: null, businessDate, reports: [] },
      };
    }

    const reports = await loadSicknessReportsForRecord(orgId, recordId);
    if (!reports) return { success: false, error: 'load_failed' };

    return {
      success: true,
      overview: { employeeRecordId: recordId, businessDate, reports },
    };
  } catch (error) {
    logError('Unexpected error in getOwnSicknessReports:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type MemberSicknessReportsResult = { success: true; reports: SicknessReport[] } | ActionFailure;

/** Manager read for the member-detail Krankmeldungen section. */
export async function getSicknessReportsForRecord(
  employeeRecordIdInput: string,
): Promise<MemberSicknessReportsResult> {
  const parsed = uuidSchema.safeParse(employeeRecordIdInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const employeeRecordId = parsed.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { orgId, role } = auth.context;
    if (!isManagerRole(role)) {
      return { success: false, error: 'not_authorized' };
    }

    const reports = await loadSicknessReportsForRecord(orgId, employeeRecordId);
    if (!reports) return { success: false, error: 'load_failed' };
    return { success: true, reports };
  } catch (error) {
    logError('Unexpected error in getSicknessReportsForRecord:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Report (self) / record (office)
// ============================================

export type CreateSicknessReportResult =
  | { success: true; report: SicknessReport; vacationOverlap: boolean }
  | ActionFailure;

type CreateReportInput = {
  absenceType: SicknessAbsenceType;
  startDate: string;
  /** null = open-ended („bis auf Weiteres"). */
  endDate: string | null;
  dayPortion: VacationDayPortion;
};

async function insertReport(input: {
  context: ActionContext;
  employeeRecordId: string;
  report: CreateReportInput;
  evidenceRequired: boolean;
  selfReported: boolean;
}): Promise<CreateSicknessReportResult> {
  const { context, employeeRecordId, report, evidenceRequired } = input;

  if (!ABSENCE_TYPES.includes(report.absenceType)) {
    return { success: false, error: 'invalid_type' };
  }
  const rangeError = validateReportRange(report);
  if (rangeError) return { success: false, error: rangeError };

  const admin = createSupabaseAdminClient();
  const written = sicknessWriteResult(
    await admin.rpc(
      'create_sickness_report',
      rpcArgs('create_sickness_report', {
        p_actor_id: context.userId,
        p_organization_id: context.orgId,
        p_employee_record_id: employeeRecordId,
        p_absence_type: report.absenceType,
        p_start_date: report.startDate,
        p_end_date: report.endDate,
        p_day_portion: report.dayPortion,
        p_evidence_required: evidenceRequired,
        p_self_reported: input.selfReported,
      }),
    ),
    'insert_failed',
    'Failed to insert sickness report:',
  );
  if (!written.success) return written;
  const created = written.report;

  const vacationOverlap = await hasApprovedVacationOverlap(
    context.orgId,
    employeeRecordId,
    created.startDate,
    created.endDate,
  );

  return { success: true, report: created, vacationOverlap };
}

/** Employee self-report — the 6:45-with-a-phone path. */
export async function reportOwnSickness(rawInput: CreateReportInput): Promise<CreateSicknessReportResult> {
  const parsed = createReportSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;

    const { recordId, failed } = await loadOwnEmployeeRecordId(auth.context.orgId, auth.context.userId);
    if (failed) return { success: false, error: 'load_failed' };
    if (!recordId) return { success: false, error: 'no_employee_record' };

    return await insertReport({
      context: auth.context,
      employeeRecordId: recordId,
      report: input,
      evidenceRequired: false,
      selfReported: true,
    });
  } catch (error) {
    logError('Unexpected error in reportOwnSickness:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Office entry — the 7:00 phone-call-in path (admin/Büro, any record). */
export async function recordSicknessForMember(
  rawInput: CreateReportInput & {
    employeeRecordId: string;
    evidenceRequired: boolean;
  },
): Promise<CreateSicknessReportResult> {
  const parsed = recordForMemberSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    if (!isManagerRole(auth.context.role)) {
      return { success: false, error: 'not_authorized' };
    }

    // The org-validation trigger backstops this, but fail understandably.
    const admin = createSupabaseAdminClient();
    const { data: record, error: recordError } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', auth.context.orgId)
      .eq('id', input.employeeRecordId)
      .maybeSingle();
    if (recordError) {
      logError('Failed to load record for sickness entry:', recordError);
      return { success: false, error: 'load_failed' };
    }
    if (!record) return { success: false, error: 'record_not_found' };

    return await insertReport({
      context: auth.context,
      employeeRecordId: input.employeeRecordId,
      report: input,
      evidenceRequired: input.evidenceRequired,
      selfReported: false,
    });
  } catch (error) {
    logError('Unexpected error in recordSicknessForMember:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Corrections (end, correct, cancel, evidence)
// ============================================

export type MutateSicknessReportResult = { success: true; report: SicknessReport } | ActionFailure;

type LoadedReport = { success: true; report: SicknessReport; isOwn: boolean } | ActionFailure;

async function loadReportForMutation(context: ActionContext, reportId: string): Promise<LoadedReport> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('sickness_reports')
    .select('*')
    .eq('organization_id', context.orgId)
    .eq('id', reportId)
    .maybeSingle();
  if (error) {
    logError('Failed to load sickness report:', error);
    return { success: false, error: 'load_failed' };
  }
  if (!data) return { success: false, error: 'not_found' };

  const report = toSicknessReport(data as SicknessReportRow);
  const { recordId, failed } = await loadOwnEmployeeRecordId(context.orgId, context.userId);
  if (failed) return { success: false, error: 'load_failed' };
  const isOwn = recordId !== null && recordId === report.employeeRecordId;

  // Authority: the person themselves or a manager — resolved here, at action
  // time, never from client state.
  if (!isOwn && !isManagerRole(context.role)) {
    return { success: false, error: 'not_authorized' };
  }
  return { success: true, report, isOwn };
}

/** Set/change the end date — the normal close-out („Ich bin wieder da"). */
export async function endSicknessReport(rawInput: {
  reportId: string;
  endDate: string;
}): Promise<MutateSicknessReportResult> {
  const parsed = endReportSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;

    const loaded = await loadReportForMutation(auth.context, input.reportId);
    if (!loaded.success) return loaded;
    const { report } = loaded;

    if (report.status !== 'reported') {
      return { success: false, error: 'report_not_active' };
    }
    if (!ISO_DATE_PATTERN.test(input.endDate)) {
      return { success: false, error: 'invalid_dates' };
    }
    if (input.endDate < report.startDate) {
      return { success: false, error: 'invalid_range' };
    }
    if (input.endDate > shiftIsoDateByDays(report.startDate, MAX_SICKNESS_RANGE_DAYS)) {
      return { success: false, error: 'range_too_long' };
    }
    if (report.dayPortion === 'half_day' && input.endDate !== report.startDate) {
      return { success: false, error: 'half_day_needs_single_day' };
    }

    const admin = createSupabaseAdminClient();
    return sicknessWriteResult(
      await admin.rpc(
        'end_sickness_report',
        rpcArgs('end_sickness_report', {
          p_actor_id: auth.context.userId,
          p_organization_id: auth.context.orgId,
          p_report_id: report.id,
          p_end_date: input.endDate,
        }),
      ),
      'update_failed',
      'Failed to end sickness report:',
    );
  } catch (error) {
    logError('Unexpected error in endSicknessReport:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Full correction of dates/portion/type. Managers correcting someone else's
 * report must give a reason; own corrections need none. */
export async function correctSicknessReport(rawInput: {
  reportId: string;
  absenceType: SicknessAbsenceType;
  startDate: string;
  endDate: string | null;
  dayPortion: VacationDayPortion;
  reason?: string;
}): Promise<MutateSicknessReportResult> {
  const parsed = correctReportSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;

    const loaded = await loadReportForMutation(auth.context, input.reportId);
    if (!loaded.success) return loaded;
    const { report, isOwn } = loaded;

    if (report.status !== 'reported') {
      return { success: false, error: 'report_not_active' };
    }
    if (!ABSENCE_TYPES.includes(input.absenceType)) {
      return { success: false, error: 'invalid_type' };
    }
    const rangeError = validateReportRange(input);
    if (rangeError) return { success: false, error: rangeError };

    const reason = input.reason?.trim() || null;
    if (!isOwn && !reason) {
      return { success: false, error: 'reason_required' };
    }

    const admin = createSupabaseAdminClient();
    return sicknessWriteResult(
      await admin.rpc(
        'correct_sickness_report',
        rpcArgs('correct_sickness_report', {
          p_actor_id: auth.context.userId,
          p_organization_id: auth.context.orgId,
          p_report_id: report.id,
          p_absence_type: input.absenceType,
          p_start_date: input.startDate,
          p_end_date: input.endDate,
          p_day_portion: input.dayPortion,
          p_reason: reason,
        }),
      ),
      'update_failed',
      'Failed to correct sickness report:',
    );
  } catch (error) {
    logError('Unexpected error in correctSicknessReport:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Cancel = recorded in error. Others' reports require a reason. */
export async function cancelSicknessReport(rawInput: {
  reportId: string;
  reason?: string;
}): Promise<MutateSicknessReportResult> {
  const parsed = cancelReportSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;

    const loaded = await loadReportForMutation(auth.context, input.reportId);
    if (!loaded.success) return loaded;
    const { report, isOwn } = loaded;

    if (report.status !== 'reported') {
      return { success: false, error: 'report_not_active' };
    }
    const reason = input.reason?.trim() || null;
    if (!isOwn && !reason) {
      return { success: false, error: 'reason_required' };
    }

    const admin = createSupabaseAdminClient();
    return sicknessWriteResult(
      await admin.rpc(
        'cancel_sickness_report',
        rpcArgs('cancel_sickness_report', {
          p_actor_id: auth.context.userId,
          p_organization_id: auth.context.orgId,
          p_report_id: report.id,
          p_reason: reason,
        }),
      ),
      'update_failed',
      'Failed to cancel sickness report:',
    );
  } catch (error) {
    logError('Unexpected error in cancelSicknessReport:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Evidence tracking (state only, no files — P1-24 owns document privacy).
 * Managers only; presented as the organization's own choice, never a rule. */
export async function setSicknessEvidence(rawInput: {
  reportId: string;
  evidenceRequired: boolean;
  evidenceStatus: SicknessEvidenceStatus;
}): Promise<MutateSicknessReportResult> {
  const parsed = evidenceSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    if (!isManagerRole(auth.context.role)) {
      return { success: false, error: 'not_authorized' };
    }

    const loaded = await loadReportForMutation(auth.context, input.reportId);
    if (!loaded.success) return loaded;
    const { report } = loaded;

    if (report.status !== 'reported') {
      return { success: false, error: 'report_not_active' };
    }
    // Mirror the database CHECK so the failure is understandable pre-insert.
    const consistent = input.evidenceRequired
      ? input.evidenceStatus === 'pending' || input.evidenceStatus === 'received'
      : input.evidenceStatus === 'not_required';
    if (!consistent) {
      return { success: false, error: 'invalid_evidence_state' };
    }

    const admin = createSupabaseAdminClient();
    return sicknessWriteResult(
      await admin.rpc(
        'set_sickness_evidence',
        rpcArgs('set_sickness_evidence', {
          p_actor_id: auth.context.userId,
          p_organization_id: auth.context.orgId,
          p_report_id: report.id,
          p_evidence_required: input.evidenceRequired,
          p_evidence_status: input.evidenceStatus,
        }),
      ),
      'update_failed',
      'Failed to update sickness evidence:',
    );
  } catch (error) {
    logError('Unexpected error in setSicknessEvidence:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Calendar entries (neutral by design)
// ============================================

/**
 * Calendar payload for sickness: deliberately carries NO absence type — the
 * shared calendar shows neutral unavailability („Abwesend") only. Managers
 * see all entries of the organization, everyone else exactly their own
 * (mirrors getVacationCalendarEntries).
 */
export type SicknessCalendarEntry = {
  id: string;
  employeeRecordId: string;
  personName: string;
  startDate: string;
  /** Clamped for open-ended reports; openEnded marks the honest difference. */
  endDate: string;
  openEnded: boolean;
  dayPortion: VacationDayPortion;
};

export type SicknessCalendarEntriesResult =
  | { success: true; entries: SicknessCalendarEntry[] }
  | ActionFailure;

export async function getSicknessCalendarEntries(
  rangeInput?: IsoDateRange,
): Promise<SicknessCalendarEntriesResult> {
  const parsedRange = calendarRangeSchema.safeParse(rangeInput);
  if (!parsedRange.success) return { success: false, error: 'invalid_input' };
  const range = parsedRange.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId, role } = auth.context;
    const isManager = isManagerRole(role);

    // Same window contract as the vacation calendar read.
    const window = range === undefined ? defaultCalendarWindow() : parseIsoDateRange(range);
    if (!window) return { success: false, error: 'invalid_input' };
    const { from: windowStartIso, to: windowEndIso } = window;

    const admin = createSupabaseAdminClient();
    let query = admin
      .from('sickness_reports')
      .select('id, employee_record_id, start_date, end_date, day_portion')
      .eq('organization_id', orgId)
      .eq('status', 'reported')
      .lte('start_date', windowEndIso)
      .or(`end_date.gte.${windowStartIso},end_date.is.null`)
      .order('start_date')
      .order('id');

    if (!isManager) {
      const { recordId, failed } = await loadOwnEmployeeRecordId(orgId, userId);
      if (failed) return { success: false, error: 'load_failed' };
      if (!recordId) return { success: true, entries: [] };
      query = query.eq('employee_record_id', recordId);
    }

    const { data: rows, error } = await readCompleteRows((from, to) => query.range(from, to), LIST_ROW_CAP);
    if (error) {
      logReadFailure('Failed to load sickness calendar entries:', error);
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
      logReadFailure('Failed to load sickness calendar records:', recordsError);
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
      logReadFailure('Failed to load sickness calendar profiles:', profilesResult.error);
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
        endDate: row.end_date ?? windowEndIso,
        openEnded: row.end_date === null,
        dayPortion: row.day_portion as VacationDayPortion,
      })),
    };
  } catch (error) {
    logError('Unexpected error in getSicknessCalendarEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

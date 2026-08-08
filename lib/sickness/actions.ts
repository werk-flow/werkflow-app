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
import {
  getBusinessTodayIso,
  shiftIsoDateByDays,
} from '@/lib/personnel/types';
import type { OrgRole } from '@/lib/members/actions';
import { loadSicknessReportsForRecord } from './server';
import {
  toSicknessReport,
  type SicknessAbsenceType,
  type SicknessEvidenceStatus,
  type SicknessReport,
  type SicknessReportRow,
} from './types';
import type { VacationDayPortion } from '@/lib/vacation/types';

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

const ABSENCE_TYPES: SicknessAbsenceType[] = [
  'krankheit',
  'kind_krank',
  'sonstige',
];

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

function isManagerRole(role: OrgRole): boolean {
  return role === 'admin' || role === 'buero';
}

function invalidateSickness(orgId: string): void {
  updateTag(CACHE_TAGS.sickness(orgId));
}

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
  if (
    input.dayPortion === 'half_day' &&
    (input.endDate === null || input.endDate !== input.startDate)
  ) {
    return 'half_day_needs_single_day';
  }
  return null;
}

async function loadOwnEmployeeRecordId(
  orgId: string,
  userId: string
): Promise<{ recordId: string | null; failed: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('Failed to load own employee record:', error);
    return { recordId: null, failed: true };
  }
  return { recordId: data?.id ?? null, failed: false };
}

async function appendReportEvent(input: {
  orgId: string;
  report: Pick<SicknessReport, 'id' | 'employeeRecordId'>;
  eventType: string;
  payload: Record<string, unknown>;
  actorUserId: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('sickness_report_events').insert({
    organization_id: input.orgId,
    sickness_report_id: input.report.id,
    employee_record_id: input.report.employeeRecordId,
    event_type: input.eventType,
    event_payload: input.payload,
    created_by: input.actorUserId,
  });
  if (error) {
    // The report row is the operational truth; a failed audit append is
    // logged loudly but does not roll back the recorded fact.
    console.error('Failed to append sickness report event:', error);
  }
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
  endDate: string | null
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
    console.error('Failed vacation overlap check:', error);
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

export type OwnSicknessOverviewResult =
  | { success: true; overview: OwnSicknessOverview }
  | { success: false; error: string };

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
    console.error('Unexpected error in getOwnSicknessReports:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type MemberSicknessReportsResult =
  | { success: true; reports: SicknessReport[] }
  | { success: false; error: string };

/** Manager read for the member-detail Krankmeldungen section. */
export async function getSicknessReportsForRecord(
  employeeRecordId: string
): Promise<MemberSicknessReportsResult> {
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
    console.error('Unexpected error in getSicknessReportsForRecord:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Report (self) / record (office)
// ============================================

export type CreateSicknessReportResult =
  | { success: true; report: SicknessReport; vacationOverlap: boolean }
  | { success: false; error: string };

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
  const { data: inserted, error: insertError } = await admin
    .from('sickness_reports')
    .insert({
      organization_id: context.orgId,
      employee_record_id: employeeRecordId,
      absence_type: report.absenceType,
      start_date: report.startDate,
      end_date: report.endDate,
      day_portion: report.dayPortion,
      status: 'reported',
      evidence_required: evidenceRequired,
      evidence_status: evidenceRequired ? 'pending' : 'not_required',
      reported_by: context.userId,
    })
    .select()
    .single();

  if (insertError || !inserted) {
    // 23P01 = exclusion violation: an own active sickness report overlaps.
    if (insertError?.code === '23P01') {
      return { success: false, error: 'overlap_conflict' };
    }
    console.error('Failed to insert sickness report:', insertError);
    return { success: false, error: 'insert_failed' };
  }

  const created = toSicknessReport(inserted as SicknessReportRow);
  await appendReportEvent({
    orgId: context.orgId,
    report: created,
    eventType: 'reported',
    payload: {
      absence_type: created.absenceType,
      start_date: created.startDate,
      end_date: created.endDate,
      day_portion: created.dayPortion,
      evidence_required: created.evidenceRequired,
      self_reported: input.selfReported,
    },
    actorUserId: context.userId,
  });

  const vacationOverlap = await hasApprovedVacationOverlap(
    context.orgId,
    employeeRecordId,
    created.startDate,
    created.endDate
  );

  invalidateSickness(context.orgId);
  return { success: true, report: created, vacationOverlap };
}

/** Employee self-report — the 6:45-with-a-phone path. */
export async function reportOwnSickness(
  input: CreateReportInput
): Promise<CreateSicknessReportResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;

    const { recordId, failed } = await loadOwnEmployeeRecordId(
      auth.context.orgId,
      auth.context.userId
    );
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
    console.error('Unexpected error in reportOwnSickness:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Office entry — the 7:00 phone-call-in path (admin/Büro, any record). */
export async function recordSicknessForMember(
  input: CreateReportInput & {
    employeeRecordId: string;
    evidenceRequired: boolean;
  }
): Promise<CreateSicknessReportResult> {
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
      console.error('Failed to load record for sickness entry:', recordError);
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
    console.error('Unexpected error in recordSicknessForMember:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Corrections (end, correct, cancel, evidence)
// ============================================

export type MutateSicknessReportResult =
  | { success: true; report: SicknessReport }
  | { success: false; error: string };

type LoadedReport =
  | { success: true; report: SicknessReport; isOwn: boolean }
  | { success: false; error: string };

async function loadReportForMutation(
  context: ActionContext,
  reportId: string
): Promise<LoadedReport> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('sickness_reports')
    .select('*')
    .eq('organization_id', context.orgId)
    .eq('id', reportId)
    .maybeSingle();
  if (error) {
    console.error('Failed to load sickness report:', error);
    return { success: false, error: 'load_failed' };
  }
  if (!data) return { success: false, error: 'not_found' };

  const report = toSicknessReport(data as SicknessReportRow);
  const { recordId, failed } = await loadOwnEmployeeRecordId(
    context.orgId,
    context.userId
  );
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
export async function endSicknessReport(input: {
  reportId: string;
  endDate: string;
}): Promise<MutateSicknessReportResult> {
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
    if (
      input.endDate >
      shiftIsoDateByDays(report.startDate, MAX_SICKNESS_RANGE_DAYS)
    ) {
      return { success: false, error: 'range_too_long' };
    }
    if (report.dayPortion === 'half_day' && input.endDate !== report.startDate) {
      return { success: false, error: 'half_day_needs_single_day' };
    }

    const admin = createSupabaseAdminClient();
    const { data: updated, error: updateError } = await admin
      .from('sickness_reports')
      .update({ end_date: input.endDate })
      .eq('id', report.id)
      .eq('organization_id', auth.context.orgId)
      .eq('status', 'reported')
      .select()
      .single();
    if (updateError || !updated) {
      if (updateError?.code === '23P01') {
        return { success: false, error: 'overlap_conflict' };
      }
      console.error('Failed to end sickness report:', updateError);
      return { success: false, error: 'update_failed' };
    }

    const result = toSicknessReport(updated as SicknessReportRow);
    await appendReportEvent({
      orgId: auth.context.orgId,
      report: result,
      eventType: 'ended',
      payload: {
        before: { end_date: report.endDate },
        after: { end_date: result.endDate },
      },
      actorUserId: auth.context.userId,
    });
    invalidateSickness(auth.context.orgId);
    return { success: true, report: result };
  } catch (error) {
    console.error('Unexpected error in endSicknessReport:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Full correction of dates/portion/type. Managers correcting someone else's
 * report must give a reason; own corrections need none. */
export async function correctSicknessReport(input: {
  reportId: string;
  absenceType: SicknessAbsenceType;
  startDate: string;
  endDate: string | null;
  dayPortion: VacationDayPortion;
  reason?: string;
}): Promise<MutateSicknessReportResult> {
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
    const { data: updated, error: updateError } = await admin
      .from('sickness_reports')
      .update({
        absence_type: input.absenceType,
        start_date: input.startDate,
        end_date: input.endDate,
        day_portion: input.dayPortion,
      })
      .eq('id', report.id)
      .eq('organization_id', auth.context.orgId)
      .eq('status', 'reported')
      .select()
      .single();
    if (updateError || !updated) {
      if (updateError?.code === '23P01') {
        return { success: false, error: 'overlap_conflict' };
      }
      console.error('Failed to correct sickness report:', updateError);
      return { success: false, error: 'update_failed' };
    }

    const result = toSicknessReport(updated as SicknessReportRow);
    await appendReportEvent({
      orgId: auth.context.orgId,
      report: result,
      eventType: 'corrected',
      payload: {
        before: {
          absence_type: report.absenceType,
          start_date: report.startDate,
          end_date: report.endDate,
          day_portion: report.dayPortion,
        },
        after: {
          absence_type: result.absenceType,
          start_date: result.startDate,
          end_date: result.endDate,
          day_portion: result.dayPortion,
        },
        reason,
      },
      actorUserId: auth.context.userId,
    });
    invalidateSickness(auth.context.orgId);
    return { success: true, report: result };
  } catch (error) {
    console.error('Unexpected error in correctSicknessReport:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Cancel = recorded in error. Others' reports require a reason. */
export async function cancelSicknessReport(input: {
  reportId: string;
  reason?: string;
}): Promise<MutateSicknessReportResult> {
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
    const { data: updated, error: updateError } = await admin
      .from('sickness_reports')
      .update({
        status: 'cancelled',
        cancelled_by: auth.context.userId,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
      })
      .eq('id', report.id)
      .eq('organization_id', auth.context.orgId)
      .eq('status', 'reported')
      .select()
      .single();
    if (updateError || !updated) {
      console.error('Failed to cancel sickness report:', updateError);
      return { success: false, error: 'update_failed' };
    }

    const result = toSicknessReport(updated as SicknessReportRow);
    await appendReportEvent({
      orgId: auth.context.orgId,
      report: result,
      eventType: 'cancelled',
      payload: {
        start_date: report.startDate,
        end_date: report.endDate,
        reason,
      },
      actorUserId: auth.context.userId,
    });
    invalidateSickness(auth.context.orgId);
    return { success: true, report: result };
  } catch (error) {
    console.error('Unexpected error in cancelSicknessReport:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Evidence tracking (state only, no files — P1-24 owns document privacy).
 * Managers only; presented as the organization's own choice, never a rule. */
export async function setSicknessEvidence(input: {
  reportId: string;
  evidenceRequired: boolean;
  evidenceStatus: SicknessEvidenceStatus;
}): Promise<MutateSicknessReportResult> {
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
    const { data: updated, error: updateError } = await admin
      .from('sickness_reports')
      .update({
        evidence_required: input.evidenceRequired,
        evidence_status: input.evidenceStatus,
      })
      .eq('id', report.id)
      .eq('organization_id', auth.context.orgId)
      .eq('status', 'reported')
      .select()
      .single();
    if (updateError || !updated) {
      console.error('Failed to update sickness evidence:', updateError);
      return { success: false, error: 'update_failed' };
    }

    const result = toSicknessReport(updated as SicknessReportRow);
    await appendReportEvent({
      orgId: auth.context.orgId,
      report: result,
      eventType: 'evidence_updated',
      payload: {
        before: {
          evidence_required: report.evidenceRequired,
          evidence_status: report.evidenceStatus,
        },
        after: {
          evidence_required: result.evidenceRequired,
          evidence_status: result.evidenceStatus,
        },
      },
      actorUserId: auth.context.userId,
    });
    invalidateSickness(auth.context.orgId);
    return { success: true, report: result };
  } catch (error) {
    console.error('Unexpected error in setSicknessEvidence:', error);
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
  personName: string;
  startDate: string;
  /** Clamped for open-ended reports; openEnded marks the honest difference. */
  endDate: string;
  openEnded: boolean;
  dayPortion: VacationDayPortion;
};

export type SicknessCalendarEntriesResult =
  | { success: true; entries: SicknessCalendarEntry[] }
  | { success: false; error: string };

export async function getSicknessCalendarEntries(): Promise<SicknessCalendarEntriesResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId, role } = auth.context;
    const isManager = isManagerRole(role);

    const admin = createSupabaseAdminClient();
    // Same bounded window as the vacation calendar payload.
    const businessDate = getBusinessTodayIso();
    const windowStartIso = shiftIsoDateByDays(businessDate, -365);
    const windowEndIso = shiftIsoDateByDays(businessDate, 730);
    let query = admin
      .from('sickness_reports')
      .select('id, employee_record_id, start_date, end_date, day_portion')
      .eq('organization_id', orgId)
      .eq('status', 'reported')
      .lte('start_date', windowEndIso)
      .or(`end_date.gte.${windowStartIso},end_date.is.null`);

    if (!isManager) {
      const { recordId, failed } = await loadOwnEmployeeRecordId(orgId, userId);
      if (failed) return { success: false, error: 'load_failed' };
      if (!recordId) return { success: true, entries: [] };
      query = query.eq('employee_record_id', recordId);
    }

    const { data: rows, error } = await query;
    if (error) {
      console.error('Failed to load sickness calendar entries:', error);
      return { success: false, error: 'load_failed' };
    }
    if (!rows || rows.length === 0) return { success: true, entries: [] };

    const recordIds = [...new Set(rows.map((row) => row.employee_record_id))];
    const { data: records, error: recordsError } = await admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .in('id', recordIds);
    if (recordsError) {
      console.error('Failed to load sickness calendar records:', recordsError);
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
        'Failed to load sickness calendar profiles:',
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
        endDate: row.end_date ?? windowEndIso,
        openEnded: row.end_date === null,
        dayPortion: row.day_portion as VacationDayPortion,
      })),
    };
  } catch (error) {
    console.error('Unexpected error in getSicknessCalendarEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

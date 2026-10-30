'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { isValidIsoDate } from '@/lib/calendar/date-range';
import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { addLocalDays } from '@/lib/date-time/berlin';
import { putStorageObject, discardStorageObjects, createSignedDownloadUrl } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { Constants } from '@/lib/supabase/database.types';
import { toJson } from '@/lib/supabase/json';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { readCompleteRows } from '@/lib/supabase/query-batches';
import { readTimeAccountManagement, requireAuth } from './access';
import { failureCode, parseStrictInteger, refuseNonManager } from './action-support';
import { DEFAULT_CREDIT_RULES, DEFAULT_SUPPLEMENT_RULES, DEFAULT_WARNING_RULES } from './defaults';
import type { buildPayrollExportPackage } from './export';
import { type ClosePeriodResult, isTimeAccountFailureCode, type TimeAccountActionResult } from './messages';
import {
  buildReservedPayrollExportPackage,
  failReservedExportOnError,
  reservePayrollExport,
} from './payroll-export-server';
import {
  buildTimePeriodPreparation,
  getBerlinInstant,
  hashPayload,
  PERIOD_SOURCE_ROW_CAP,
  requirePeriodRows,
} from './period-preparation';
import { readOpenPeriodSessions } from './queries';
import { isValidOptionalIsoDateRange } from './validation';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { optionalFormText, parseFormData } from '@/lib/validation/form-data';

// Boundary schemas of the form actions: ids and bounded text. The value rules
// below keep their own error codes.
const id = uuidSchema.optional();
const text = optionalFormText;
const createStarterTimePolicyFormSchema = z.object({
  effectiveFrom: text(10),
  name: text(200),
  policyKind: text(40),
});
const assignEmployeeTimePolicyFormSchema = z.object({
  employeeRecordId: id,
  policyId: id,
  validFrom: text(10),
  validUntil: text(10),
  reason: text(2000),
});
const openMissingTimeAccountsFormSchema = z.object({
  employeeRecordId: id,
  openingMinutes: text(12),
  openedOn: text(10),
  reason: text(2000),
});
const correctTimeAccountOpeningDateFormSchema = z.object({
  accountId: id,
  openedOn: text(10),
  reason: text(2000),
});
const submitTimeAccountAdjustmentFormSchema = z.object({
  accountId: id,
  expectedVersion: text(12),
  adjustmentKind: text(40),
  minutes: text(12),
  effectiveDate: text(10),
  reason: text(2000),
});
const prepareTimePeriodFormSchema = z.object({ month: text(7) });
const closeTimePeriodFormSchema = z.object({ periodId: id });
const reopenTimePeriodFormSchema = z.object({ periodId: id, reason: text(2000) });
const generatePayrollExportFormSchema = z.object({ periodId: id });
const downloadPayrollExportFormSchema = z.object({ exportId: id });
const adjustmentKindSchema = z.enum(Constants.public.Enums.time_account_adjustment_kind);

/**
 * The caller's time-account rights. `managementReadFailed` marks a failed
 * responsibility read; `canManage` is then false, and the surface shows the
 * failure with a retry instead of treating it as "not responsible".
 */
export async function getTimeAccountAccess(): Promise<
  { success: true } & {
    canManage: boolean;
    managementReadFailed: boolean;
    isAdmin: boolean;
    canProposeAdjustments: boolean;
    canExportPayroll: boolean;
  }
> {
  const context = await requireAuth();
  const management = await readTimeAccountManagement(context);
  return {
    success: true,
    canManage: management.success && management.canManage,
    managementReadFailed: !management.success,
    isAdmin: context.role === 'admin',
    canProposeAdjustments: context.role === 'admin' || context.role === 'buero',
    canExportPayroll: context.isManagerOrAbove,
  };
}

// `month` is a validated `YYYY-MM` (prepareTimePeriod checks it).
function monthBounds(month: string): {
  start: string;
  end: string;
  endExclusive: string;
} {
  const start = `${month}-01`;
  const nextMonth = new Date(`${start}T12:00:00.000Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const endExclusive = nextMonth.toISOString().slice(0, 10);
  return { start, end: addLocalDays(endExclusive, -1), endExclusive };
}

export async function createStarterTimePolicy(
  formInput: FormData,
): Promise<TimeAccountActionResult<'createPolicy'>> {
  const formData = parseFormData(formInput, createStarterTimePolicyFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  if (context.role !== 'admin') return { success: false, error: 'forbidden' };
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '');
  const name = String(formData.get('name') ?? 'Standard-Arbeitszeit');
  const createAsException = formData.get('policyKind') === 'exception';
  const operationId = randomUUID();
  if (!name.trim()) return { success: false, error: 'invalid_policy_name' };
  if (!isValidIsoDate(effectiveFrom)) return { success: false, error: 'invalid_input' };
  const payload = {
    effectiveFrom,
    name,
    createAsException,
    credit: DEFAULT_CREDIT_RULES,
    supplements: DEFAULT_SUPPLEMENT_RULES,
    warnings: DEFAULT_WARNING_RULES,
  };
  const admin = createSupabaseAdminClient();
  const { data: currentPolicy, error: currentPolicyError } = await loggedRead(
    'createStarterTimePolicy: time_account_policies read failed',
    admin
      .from('time_account_policies')
      .select('id')
      .eq('organization_id', context.orgId)
      .eq('is_default', true)
      .is('retired_at', null)
      .maybeSingle(),
  );
  // A null policy id creates a new default policy; a failed read must not fork it.
  if (currentPolicyError) return { success: false, error: 'policy_save_failed' };
  const { error } = await admin.rpc(
    'create_time_account_policy_version',
    rpcArgs('create_time_account_policy_version', {
      p_organization_id: context.orgId,
      p_policy_id: createAsException ? null : (currentPolicy?.id ?? null),
      p_name: name,
      p_is_default: !createAsException,
      p_effective_from: effectiveFrom,
      p_vacation_treatment: 'paid',
      p_sickness_treatment: 'paid',
      p_night_window_start: null,
      p_night_window_end: null,
      p_credit_rules: toJson(DEFAULT_CREDIT_RULES),
      p_supplement_rules: toJson(DEFAULT_SUPPLEMENT_RULES),
      p_warning_rules: toJson(DEFAULT_WARNING_RULES),
      p_actor_id: context.userId,
      p_operation_id: operationId,
      p_request_hash: hashPayload(payload),
    }),
  );
  if (error)
    return {
      success: false,
      error: failureCode(
        'createPolicy',
        'policy_save_failed',
        'createStarterTimePolicy: create_time_account_policy_version failed',
        error,
      ),
    };
  revalidatePath('/zeiterfassung/einstellungen');
  revalidatePath('/einstellungen/zeiterfassung');
  return { success: true };
}

export async function assignEmployeeTimePolicy(
  formInput: FormData,
): Promise<TimeAccountActionResult<'assignPolicy'>> {
  const formData = parseFormData(formInput, assignEmployeeTimePolicyFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  if (context.role !== 'admin') return { success: false, error: 'forbidden' };
  const employeeRecordId = String(formData.get('employeeRecordId') ?? '');
  const policyId = String(formData.get('policyId') ?? '');
  const validFrom = String(formData.get('validFrom') ?? '');
  const validUntilValue = String(formData.get('validUntil') ?? '');
  const reason = String(formData.get('reason') ?? 'Individuelle Arbeitszeitregel');
  if (
    !employeeRecordId ||
    !policyId ||
    !isValidOptionalIsoDateRange(validFrom, validUntilValue) ||
    !reason.trim()
  )
    return { success: false, error: 'invalid_input' };
  const operationId = randomUUID();
  const payload = {
    employeeRecordId,
    policyId,
    validFrom,
    validUntil: validUntilValue || null,
    reason,
  };
  const { error } = await createSupabaseAdminClient().rpc(
    'assign_time_account_policy',
    rpcArgs('assign_time_account_policy', {
      p_organization_id: context.orgId,
      p_employee_record_id: employeeRecordId,
      p_policy_id: policyId,
      p_valid_from: validFrom,
      p_valid_until: validUntilValue || null,
      p_reason: reason,
      p_actor_id: context.userId,
      p_operation_id: operationId,
      p_request_hash: hashPayload(payload),
    }),
  );
  if (error)
    return {
      success: false,
      error: failureCode(
        'assignPolicy',
        'assignment_failed',
        'assignEmployeeTimePolicy: assign_time_account_policy failed',
        error,
      ),
    };
  revalidatePath('/zeiterfassung/einstellungen');
  revalidatePath('/einstellungen/zeiterfassung');
  return { success: true };
}

export async function openMissingTimeAccounts(
  formInput: FormData,
): Promise<TimeAccountActionResult<'openAccount'>> {
  const formData = parseFormData(formInput, openMissingTimeAccountsFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  if (context.role !== 'admin') return { success: false, error: 'forbidden' };
  const employeeRecordId = String(formData.get('employeeRecordId') ?? '');
  const openingMinutes = parseStrictInteger(formData.get('openingMinutes'));
  const openedOn = String(formData.get('openedOn') ?? '');
  const reason = String(formData.get('reason') ?? 'Einführung des Zeitkontos');
  if (!employeeRecordId || openingMinutes === null || !isValidIsoDate(openedOn))
    return { success: false, error: 'invalid_input' };
  if (!reason.trim()) return { success: false, error: 'reason_required' };
  const admin = createSupabaseAdminClient();
  const operationId = randomUUID();
  const payload = { employeeRecordId, openedOn, openingMinutes, reason };
  const { error } = await admin.rpc('open_time_account', {
    p_organization_id: context.orgId,
    p_employee_record_id: employeeRecordId,
    p_opening_minutes: openingMinutes,
    p_opened_on: openedOn,
    p_reason: reason,
    p_actor_id: context.userId,
    p_operation_id: operationId,
    p_request_hash: hashPayload(payload),
  });
  if (error)
    return {
      success: false,
      error: failureCode(
        'openAccount',
        'open_failed',
        'openMissingTimeAccounts: open_time_account failed',
        error,
      ),
    };
  revalidatePath('/zeiterfassung/einstellungen');
  revalidatePath('/einstellungen/zeiterfassung');
  revalidatePath('/zeiterfassung/zeitkonto');
  return { success: true };
}

/**
 * Moves an account's opening date. The database function books the move as a
 * reversal and a new opening with the old date, new date and reason, and
 * refuses it while a closed period depends on either date.
 */
export async function correctTimeAccountOpeningDate(
  formInput: FormData,
): Promise<TimeAccountActionResult<'correctOpening'>> {
  const formData = parseFormData(formInput, correctTimeAccountOpeningDateFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  if (context.role !== 'admin') return { success: false, error: 'forbidden' };
  const accountId = String(formData.get('accountId') ?? '');
  const openedOn = String(formData.get('openedOn') ?? '');
  const reason = String(formData.get('reason') ?? '');
  if (!accountId || !isValidIsoDate(openedOn)) return { success: false, error: 'invalid_input' };
  if (!reason.trim()) return { success: false, error: 'reason_required' };
  const operationId = randomUUID();
  const { error } = await createSupabaseAdminClient().rpc('correct_time_account_opening_date', {
    p_organization_id: context.orgId,
    p_account_id: accountId,
    p_opened_on: openedOn,
    p_reason: reason,
    p_actor_id: context.userId,
    p_operation_id: operationId,
    p_request_hash: hashPayload({ accountId, openedOn, reason }),
  });
  if (error)
    return {
      success: false,
      error: failureCode(
        'correctOpening',
        'correction_failed',
        'correctTimeAccountOpeningDate: correct_time_account_opening_date failed',
        error,
      ),
    };
  revalidatePath('/zeiterfassung/einstellungen');
  revalidatePath('/einstellungen/zeiterfassung');
  revalidatePath('/zeiterfassung/zeitkonto');
  revalidatePath('/zeiterfassung/perioden');
  return { success: true };
}

export async function submitTimeAccountAdjustment(
  formInput: FormData,
): Promise<TimeAccountActionResult<'submitAdjustment'>> {
  const formData = parseFormData(formInput, submitTimeAccountAdjustmentFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  if (context.role !== 'admin' && context.role !== 'buero') return { success: false, error: 'forbidden' };
  const accountId = String(formData.get('accountId') ?? '');
  const expectedVersion = parseStrictInteger(formData.get('expectedVersion'));
  const adjustmentKind = String(formData.get('adjustmentKind') ?? '');
  const parsedAdjustmentKind = adjustmentKindSchema.safeParse(adjustmentKind);
  const minutes = parseStrictInteger(formData.get('minutes'));
  const effectiveDate = String(formData.get('effectiveDate') ?? '');
  const reason = String(formData.get('reason') ?? '');
  if (
    !accountId ||
    expectedVersion === null ||
    minutes === null ||
    minutes === 0 ||
    !parsedAdjustmentKind.success ||
    !isValidIsoDate(effectiveDate) ||
    !reason.trim()
  )
    return { success: false, error: 'invalid_adjustment' };
  const operationId = randomUUID();
  const payload = {
    accountId,
    expectedVersion,
    adjustmentKind,
    minutes,
    effectiveDate,
    reason,
  };
  const { error } = await createSupabaseAdminClient().rpc('submit_time_account_adjustment', {
    p_organization_id: context.orgId,
    p_account_id: accountId,
    p_expected_account_version: expectedVersion,
    p_adjustment_kind: parsedAdjustmentKind.data,
    p_minutes: minutes,
    p_effective_date: effectiveDate,
    p_reason: reason,
    p_actor_id: context.userId,
    p_operation_id: operationId,
    p_request_hash: hashPayload(payload),
  });
  if (error)
    return {
      success: false,
      error: failureCode(
        'submitAdjustment',
        'adjustment_failed',
        'submitTimeAccountAdjustment: submit_time_account_adjustment failed',
        error,
      ),
    };
  revalidatePath('/zeiterfassung/einstellungen');
  revalidatePath('/einstellungen/zeiterfassung');
  revalidatePath('/zeiterfassung/zeitkonto');
  return { success: true };
}

/** Prepares a month; the success names the period, so the form opens its detail. */
export async function prepareTimePeriod(
  formInput: FormData,
): Promise<TimeAccountActionResult<'prepare', { periodId: string | null }>> {
  const formData = parseFormData(formInput, prepareTimePeriodFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  const refusal = await refuseNonManager(context);
  if (refusal) return refusal;
  const month = String(formData.get('month') ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { success: false, error: 'invalid_input' };
  const bounds = monthBounds(month);
  const admin = createSupabaseAdminClient();
  try {
    const startInstant = getBerlinInstant(`${bounds.start}T00:00`);
    const endInstant = getBerlinInstant(`${bounds.endExclusive}T00:00`);
    // Fingerprint first: prepare_time_period refuses one that changed since,
    // so every source the fingerprint covers is also in the findings below.
    const fingerprint = await admin.rpc('get_time_period_source_fingerprint', {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_period_start_date: bounds.start,
      p_period_end_date: bounds.end,
    });
    const sourceFingerprint = fingerprint.data;
    if (fingerprint.error || !sourceFingerprint)
      throw new Error(fingerprint.error?.message ?? 'fingerprint_failed');
    const { employeePayload, dailyPayload, sourcePayload, findingPayload } = await buildTimePeriodPreparation(
      { admin, context, bounds, startInstant, endInstant },
    );
    const operationId = randomUUID();
    const payload = { organizationId: context.orgId, bounds, sourceFingerprint };
    const { data: calculationId, error } = await admin.rpc('prepare_time_period', {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_period_start_date: bounds.start,
      p_period_end_date: bounds.end,
      p_source_fingerprint: sourceFingerprint,
      p_employee_results: toJson(employeePayload),
      p_daily_results: toJson(dailyPayload),
      p_sources: toJson(sourcePayload),
      p_findings: toJson(findingPayload),
      p_operation_id: operationId,
      p_request_hash: hashPayload(payload),
    });
    if (error) throw error;
    const { data: calculationRow } = await loggedRead(
      'prepareTimePeriod: time_period_calculations read failed',
      admin
        .from('time_period_calculations')
        .select('period_id')
        .eq('organization_id', context.orgId)
        .eq('id', calculationId)
        .single(),
      true,
    );
    revalidatePath('/zeiterfassung/perioden');
    revalidatePath('/zeiterfassung/zeitkonto');
    return { success: true, periodId: calculationRow?.period_id ?? null };
  } catch (error) {
    return {
      success: false,
      error: failureCode('prepare', 'prepare_failed', 'prepareTimePeriod failed', error),
    };
  }
}

// The names of the employees whose session blocks the close. A failed read
// keeps the refusal and drops only the names.
async function readBlockingSessionNames(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  periodId: string,
): Promise<string[]> {
  try {
    const { data: period, error } = await admin
      .from('time_periods')
      .select('period_end_date')
      .eq('organization_id', organizationId)
      .eq('id', periodId)
      .single();
    if (error) throw error;
    const sessions = await readOpenPeriodSessions(admin, organizationId, period.period_end_date);
    return [...new Set(sessions.map((session) => session.employeeName))];
  } catch (error) {
    // best-effort: the close is still refused; only the names in the refusal are missing.
    logError('closeTimePeriod: open session names failed', error);
    return [];
  }
}

export async function closeTimePeriod(formInput: FormData): Promise<ClosePeriodResult> {
  const formData = parseFormData(formInput, closeTimePeriodFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  const refusal = await refuseNonManager(context);
  if (refusal) return refusal;
  const periodId = String(formData.get('periodId') ?? '');
  if (!periodId) return { success: false, error: 'invalid_input' };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('close_time_period', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_period_id: periodId,
    p_operation_id: randomUUID(),
    p_request_hash: hashPayload({ periodId }),
  });
  if (error) {
    if (error.message === 'period_open_sessions')
      return {
        success: false,
        error: 'period_open_sessions',
        employeeNames: await readBlockingSessionNames(admin, context.orgId, periodId),
      };
    if (isTimeAccountFailureCode('close', error.message)) return { success: false, error: error.message };
    logError('closeTimePeriod: close_time_period failed', error);
    return { success: false, error: 'close_failed' };
  }
  revalidatePath('/zeiterfassung/perioden');
  revalidatePath(`/zeiterfassung/perioden/${periodId}`);
  revalidatePath('/zeiterfassung/zeitkonto');
  return { success: true };
}

export async function reopenTimePeriod(formInput: FormData): Promise<TimeAccountActionResult<'reopen'>> {
  const formData = parseFormData(formInput, reopenTimePeriodFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  if (context.role !== 'admin') return { success: false, error: 'forbidden' };
  const periodId = String(formData.get('periodId') ?? '');
  if (!periodId) return { success: false, error: 'invalid_input' };
  const reason = String(formData.get('reason') ?? 'Korrektur erforderlich');
  const operationId = randomUUID();
  const { error } = await createSupabaseAdminClient().rpc('reopen_time_period', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_period_id: periodId,
    p_reason: reason,
    p_operation_id: operationId,
    p_request_hash: hashPayload({ periodId, reason }),
  });
  if (error)
    return {
      success: false,
      error: failureCode('reopen', 'reopen_failed', 'reopenTimePeriod: reopen_time_period failed', error),
    };
  revalidatePath('/zeiterfassung/perioden');
  revalidatePath(`/zeiterfassung/perioden/${periodId}`);
  revalidatePath('/zeiterfassung/zeitkonto');
  return { success: true };
}

const PAYROLL_CODE_MAPPINGS = [
  ['target', null, 'SOLL'],
  ['source_attendance', null, 'ANWESEND'],
  ['effective_attendance', null, 'EFFEKTIV'],
  ['vacation', null, 'URLAUB'],
  ['sickness', null, 'KRANK'],
  ['overtime', null, 'MEHRARBEIT'],
  ['night_supplement', null, 'NACHT'],
  ['sunday_supplement', null, 'SONNTAG'],
  ['public_holiday_supplement', null, 'FEIERTAG'],
  ['manual_adjustment', null, 'KORREKTUR'],
  ['expiry', null, 'VERFALL'],
  ['payout', null, 'AUSZAHLUNG'],
  ['opening_balance', null, 'START'],
  ['closing_balance', null, 'SALDO'],
  ['credited_activity', 'work', 'ARBEIT'],
  ['credited_activity', 'travel', 'FAHRT'],
  ['credited_activity', 'break', 'PAUSE'],
  ['credited_activity', 'standby', 'BEREITSCHAFT'],
  ['credited_activity', 'callout', 'EINSATZ'],
  ['credited_activity', 'internal_activity', 'INTERN'],
].map(([valueKind, activityKind, outputCode]) => ({
  value_kind: valueKind,
  activity_kind: activityKind,
  output_code: outputCode,
}));

export async function createDefaultPayrollMapping(): Promise<TimeAccountActionResult<'createMapping'>> {
  const context = await requireAuth();
  if (context.role !== 'admin') return { success: false, error: 'forbidden' };
  try {
    await saveDefaultPayrollMapping(context);
  } catch (error) {
    return {
      success: false,
      error: failureCode('createMapping', 'mapping_failed', 'createDefaultPayrollMapping failed', error),
    };
  }
  revalidatePath('/zeiterfassung/einstellungen');
  revalidatePath('/einstellungen/zeiterfassung');
  return { success: true };
}

// Throws a stable code (or a provider error) on every refusal; the action maps it.
async function saveDefaultPayrollMapping(context: { orgId: string; userId: string }): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: employees } = await readCompleteRows(
    (from, to) =>
      admin
        .from('employee_records')
        .select('id, employee_number')
        .eq('organization_id', context.orgId)
        .order('created_at')
        .order('id')
        .range(from, to),
    PERIOD_SOURCE_ROW_CAP,
  ).then(requirePeriodRows);
  const employeeMappings = (employees ?? []).map((employee) => {
    if (!employee.employee_number) throw new Error('employee_number_required');
    return { employee_record_id: employee.id, external_employee_reference: employee.employee_number };
  });
  const operationId = randomUUID();
  const payload = { employeeMappings, codeMappings: PAYROLL_CODE_MAPPINGS };
  const { error } = await admin.rpc('create_payroll_mapping_version', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_employee_mappings: employeeMappings,
    p_code_mappings: PAYROLL_CODE_MAPPINGS,
    p_operation_id: operationId,
    p_request_hash: hashPayload(payload),
  });
  if (error) throw error;
}

// Stores the package, records its document, and finalizes the export; any
// failure removes the document row, discards the stored object, and rethrows.
async function storePayrollExportPackage(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  context: { orgId: string; userId: string };
  period: { period_start_date: string };
  exportId: string;
  packageResult: ReturnType<typeof buildPayrollExportPackage>;
}): Promise<void> {
  const { admin, context, period, exportId, packageResult } = input;
  const storagePath = `${context.orgId}/lohnexporte/${period.period_start_date}/${exportId}.zip`;
  let stored = false;
  let documentId: string | null = null;
  try {
    await putStorageObject({
      organizationId: context.orgId,
      path: storagePath,
      body: packageResult.bytes,
      contentType: 'application/zip',
    });
    stored = true;
    const newDocumentId = randomUUID();
    const fileName = `Lohnexport-${period.period_start_date}.zip`;
    const { error: documentError } = await admin.from('documents').insert({
      id: newDocumentId,
      organization_id: context.orgId,
      storage_path: storagePath,
      original_file_name: fileName,
      display_name: fileName,
      mime_type: 'application/zip',
      size_bytes: packageResult.bytes.length,
      uploaded_by: context.userId,
      metadata: {
        kind: 'payroll_export',
        exportId,
        sha256: packageResult.sha256,
      },
    });
    if (documentError) throw documentError;
    documentId = newDocumentId;
    const { error: finalizeError } = await admin.rpc('finalize_payroll_export', {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_export_id: exportId,
      p_document_id: newDocumentId,
      p_zip_sha256: packageResult.sha256,
      p_size_bytes: packageResult.bytes.length,
      p_operation_id: randomUUID(),
    });
    if (finalizeError) throw finalizeError;
  } catch (error) {
    // Remove the document row first, so no visible document points at a discarded object.
    if (documentId) {
      const { error: documentDeleteError } = await admin
        .from('documents')
        .delete()
        .eq('organization_id', context.orgId)
        .eq('id', documentId);
      if (documentDeleteError)
        logError('generatePayrollExport: documents cleanup failed', documentDeleteError);
    }
    // discardStorageObjects logs its own failure and never throws.
    if (stored) await discardStorageObjects({ organizationId: context.orgId, paths: [storagePath] });
    throw error;
  }
}

export async function generatePayrollExport(
  formInput: FormData,
): Promise<TimeAccountActionResult<'generateExport'>> {
  const formData = parseFormData(formInput, generatePayrollExportFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  if (!context.isManagerOrAbove) return { success: false, error: 'forbidden' };
  const periodId = String(formData.get('periodId') ?? '');
  if (!periodId) return { success: false, error: 'invalid_input' };
  try {
    await buildAndStorePayrollExport(context, periodId);
  } catch (error) {
    return {
      success: false,
      error: failureCode('generateExport', 'export_failed', 'generatePayrollExport failed', error),
    };
  }
  revalidatePath(`/zeiterfassung/perioden/${periodId}`);
  return { success: true };
}

// Throws a stable code (or a provider error) on every refusal; the action maps it.
async function buildAndStorePayrollExport(
  context: { orgId: string; userId: string },
  periodId: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const reservation = await reservePayrollExport(admin, context, periodId);
  if (!reservation) return;
  const { exportId, period } = reservation;
  await failReservedExportOnError(admin, context, exportId, async () => {
    const packageResult = await buildReservedPayrollExportPackage(admin, context, reservation);
    await storePayrollExportPackage({ admin, context, period, exportId, packageResult });
  });
}

/** A signed download URL for a ready export; the form opens it as a file download. */
export async function downloadPayrollExport(
  formInput: FormData,
): Promise<TimeAccountActionResult<'downloadExport', { url: string }>> {
  const formData = parseFormData(formInput, downloadPayrollExportFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  if (!context.isManagerOrAbove) return { success: false, error: 'forbidden' };
  const exportId = String(formData.get('exportId') ?? '');
  if (!exportId) return { success: false, error: 'invalid_input' };
  try {
    return { success: true, url: await createPayrollExportDownloadUrl(context, exportId) };
  } catch (error) {
    return {
      success: false,
      error: failureCode('downloadExport', 'download_failed', 'downloadPayrollExport failed', error),
    };
  }
}

async function createPayrollExportDownloadUrl(context: { orgId: string }, exportId: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data: exportRow, error: exportError } = await loggedRead(
    'downloadPayrollExport: payroll_exports read failed',
    admin
      .from('payroll_exports')
      .select('document_id')
      .eq('id', exportId)
      .eq('organization_id', context.orgId)
      .eq('state', 'ready')
      .maybeSingle(),
  );
  if (exportError) throw new Error('load_failed');
  if (!exportRow?.document_id) throw new Error('export_not_ready');
  const { data: document, error: documentError } = await loggedRead(
    'downloadPayrollExport: documents read failed',
    admin
      .from('documents')
      .select('storage_path, original_file_name')
      .eq('id', exportRow.document_id)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (documentError) throw new Error('load_failed');
  if (!document) throw new Error('document_not_found');
  return createSignedDownloadUrl({
    path: document.storage_path,
    organizationId: context.orgId,
    disposition: 'attachment',
    downloadFileName: document.original_file_name,
  });
}

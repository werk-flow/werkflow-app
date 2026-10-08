'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { isValidIsoDate } from '@/lib/calendar/date-range';
import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { addLocalDays } from '@/lib/planning/date-time';
import { putStorageObject, discardStorageObjects, createSignedDownloadUrl } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isJsonRecord, toJson } from '@/lib/supabase/json';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { ActionFailure } from '@/lib/action-result';
import { readTimeAccountManagement, requireAuth } from './access';
import { DEFAULT_CREDIT_RULES, DEFAULT_SUPPLEMENT_RULES, DEFAULT_WARNING_RULES } from './defaults';
import { buildPayrollExportPackage, distributeCreditedMinutes } from './export';
import {
  type ClosePeriodResult,
  isTimeAccountFailureCode,
  type TimeAccountAction,
  type TimeAccountActionResult,
  type TimeAccountFailureCode,
} from './messages';
import {
  buildTimePeriodPreparation,
  getBerlinInstant,
  hashPayload,
  PERIOD_SOURCE_ROW_CAP,
  requirePeriodRows,
} from './period-preparation';
import { readOpenPeriodSessions } from './queries';
import type {
  PayrollExportAllocationRow,
  PayrollExportCorrectionRow,
  PayrollExportValueRow,
  PayrollValueKind,
} from './types';
import { isValidOptionalIsoDateRange, requireJsonRecord, requirePresent } from './validation';
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
const submitTimeAccountAdjustmentFormSchema = z.object({
  accountId: id,
  expectedVersion: text(12),
  adjustmentKind: text(40),
  minutes: text(12),
  effectiveDate: text(10),
  reason: text(2000),
});
const decideTimeAccountAdjustmentFormSchema = z.object({
  requestId: id,
  expectedVersion: text(12),
  decision: text(40),
  reason: text(2000),
});
const prepareTimePeriodFormSchema = z.object({ month: text(7) });
const decidePeriodFindingFormSchema = z.object({
  findingId: id,
  periodId: id,
  decision: text(40),
  reason: text(2000),
});
const closeTimePeriodFormSchema = z.object({ periodId: id });
const reopenTimePeriodFormSchema = z.object({ periodId: id, reason: text(2000) });
const generatePayrollExportFormSchema = z.object({ periodId: id });
const downloadPayrollExportFormSchema = z.object({ exportId: id });

/**
 * The caller's time-account rights. `managementReadFailed` marks a failed
 * responsibility read; `canManage` is then false, and the surface shows the
 * failure with a retry instead of treating it as "not responsible".
 */
export async function getTimeAccountAccess(): Promise<{
  canManage: boolean;
  managementReadFailed: boolean;
  isAdmin: boolean;
  canProposeAdjustments: boolean;
}> {
  const context = await requireAuth();
  const management = await readTimeAccountManagement(context);
  return {
    canManage: management.success && management.canManage,
    managementReadFailed: !management.success,
    isAdmin: context.role === 'admin',
    canProposeAdjustments: context.role === 'admin' || context.role === 'buero',
  };
}

/** The manager gate of the period actions: a failed responsibility read is its own code. */
async function refuseNonManager(
  context: Parameters<typeof readTimeAccountManagement>[0],
): Promise<ActionFailure<'responsibility_load_failed' | 'forbidden'> | null> {
  const management = await readTimeAccountManagement(context);
  if (!management.success) return management;
  return management.canManage ? null : { success: false, error: 'forbidden' };
}

/**
 * The stable code of a refused period RPC or of a thrown period step: a known
 * code passes through (also with a detail suffix such as
 * `incomplete_period_population: …`), anything else is logged and becomes
 * the action's catch-all code.
 */
function failureCode<Action extends TimeAccountAction>(
  action: Action,
  fallback: TimeAccountFailureCode<Action>,
  label: string,
  error: unknown,
): TimeAccountFailureCode<Action> {
  const message =
    error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)
      ? String(error.message)
      : '';
  const code = message.split(':')[0]?.trim() ?? '';
  if (isTimeAccountFailureCode(action, code)) return code;
  logError(label, error);
  return fallback;
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

function parseStrictInteger(value: FormDataEntryValue | null): number | null {
  const text = typeof value === 'string' ? value : '';
  if (!/^-?\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
  const minutes = parseStrictInteger(formData.get('minutes'));
  const effectiveDate = String(formData.get('effectiveDate') ?? '');
  const reason = String(formData.get('reason') ?? '');
  if (
    !accountId ||
    expectedVersion === null ||
    minutes === null ||
    minutes === 0 ||
    !['manual_adjustment', 'expiry', 'payout'].includes(adjustmentKind) ||
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
    p_adjustment_kind: adjustmentKind as 'manual_adjustment' | 'expiry' | 'payout',
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

export async function decideTimeAccountAdjustment(
  formInput: FormData,
): Promise<TimeAccountActionResult<'decideAdjustment'>> {
  const formData = parseFormData(formInput, decideTimeAccountAdjustmentFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  const refusal = await refuseNonManager(context);
  if (refusal) return refusal;
  const requestId = String(formData.get('requestId') ?? '');
  const expectedVersion = parseStrictInteger(formData.get('expectedVersion'));
  const decision = String(formData.get('decision') ?? '');
  const reason = String(formData.get('reason') ?? '');
  if (!requestId || expectedVersion === null || !['approved', 'rejected'].includes(decision))
    return { success: false, error: 'invalid_input' };
  if (!reason.trim()) return { success: false, error: 'reason_required' };
  const { error } = await createSupabaseAdminClient().rpc('decide_time_account_adjustment', {
    p_organization_id: context.orgId,
    p_request_id: requestId,
    p_expected_version: expectedVersion,
    p_decision: decision as 'approved' | 'rejected',
    p_reason: reason,
    p_actor_id: context.userId,
    p_operation_id: randomUUID(),
  });
  if (error)
    return {
      success: false,
      error: failureCode(
        'decideAdjustment',
        'decision_failed',
        'decideTimeAccountAdjustment: decide_time_account_adjustment failed',
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
    const { employeePayload, dailyPayload, sourcePayload, findingPayload } = await buildTimePeriodPreparation(
      { admin, context, bounds, startInstant, endInstant },
    );
    const { data: sourceFingerprint, error: fingerprintError } = await admin.rpc(
      'get_time_period_source_fingerprint',
      {
        p_actor_id: context.userId,
        p_organization_id: context.orgId,
        p_period_start_date: bounds.start,
        p_period_end_date: bounds.end,
      },
    );
    if (fingerprintError || !sourceFingerprint)
      throw new Error(fingerprintError?.message ?? 'fingerprint_failed');
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

export async function decidePeriodFinding(
  formInput: FormData,
): Promise<TimeAccountActionResult<'decideFinding'>> {
  const formData = parseFormData(formInput, decidePeriodFindingFormSchema);
  if (!formData) return { success: false, error: 'invalid_input' };
  const context = await requireAuth();
  const refusal = await refuseNonManager(context);
  if (refusal) return refusal;
  const findingId = String(formData.get('findingId') ?? '');
  const periodId = String(formData.get('periodId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const reason = String(formData.get('reason') ?? 'Geprüft');
  if (
    !findingId ||
    !periodId ||
    !['approved', 'rejected', 'acknowledged'].includes(decision) ||
    !reason.trim()
  )
    return { success: false, error: 'invalid_input' };
  const { error } = await createSupabaseAdminClient().rpc('decide_time_period_finding', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_finding_id: findingId,
    p_decision: decision as 'approved' | 'rejected' | 'acknowledged',
    p_reason: reason,
    p_operation_id: randomUUID(),
  });
  if (error)
    return {
      success: false,
      error: failureCode(
        'decideFinding',
        'decision_failed',
        'decidePeriodFinding: decide_time_period_finding failed',
        error,
      ),
    };
  revalidatePath(`/zeiterfassung/perioden/${periodId}`);
  return { success: true };
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

/** Account events that the payroll export carries as value rows. */
const PAYROLL_ACCOUNT_EVENT_KINDS = [
  'opening_balance',
  'manual_adjustment',
  'expiry',
  'payout',
] as const satisfies readonly PayrollValueKind[];

function isPayrollAccountEventKind(kind: string): kind is (typeof PAYROLL_ACCOUNT_EVENT_KINDS)[number] {
  return PAYROLL_ACCOUNT_EVENT_KINDS.some((payrollKind) => payrollKind === kind);
}

async function loadPayrollExportSources(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  context: { orgId: string };
  calculationId: string;
  closeVersionId: string;
  mappingVersionId: string;
  periodStartDate: string;
  periodEndDate: string;
}) {
  const { admin, context, calculationId, closeVersionId, mappingVersionId, periodStartDate, periodEndDate } =
    input;
  const [
    { data: calculation },
    { data: closeVersion },
    { data: mappingVersion },
    { data: employeeMappings },
    { data: codeMappings },
    { data: employeeResults },
  ] = await Promise.all([
    admin
      .from('time_period_calculations')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('id', calculationId)
      .single(),
    admin
      .from('time_period_close_versions')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('id', closeVersionId)
      .single(),
    admin
      .from('payroll_mapping_versions')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('id', mappingVersionId)
      .single(),
    readCompleteRows(
      (from, to) =>
        admin
          .from('payroll_employee_mappings')
          .select('*')
          .eq('organization_id', context.orgId)
          .eq('mapping_version_id', mappingVersionId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('payroll_code_mappings')
          .select('*')
          .eq('organization_id', context.orgId)
          .eq('mapping_version_id', mappingVersionId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_period_employee_results')
          .select('*')
          .eq('organization_id', context.orgId)
          .eq('calculation_id', calculationId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
  ]);
  if (!calculation || !closeVersion || !mappingVersion) throw new Error('export_context_missing');
  const employeeResultIds = (employeeResults ?? []).map((result) => result.id);
  const employeeIds = (employeeResults ?? []).map((result) => result.employee_record_id);
  const [
    { data: dailyResults },
    { data: resultSources },
    { data: accountEvents },
    { data: correctionRequests },
  ] = await Promise.all([
    readInBatches(employeeResultIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_period_daily_results')
            .select('*')
            .eq('organization_id', context.orgId)
            .in('employee_result_id', [...batch])
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ),
    ).then(requirePeriodRows),
    readInBatches(employeeResultIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_period_result_sources')
            .select('*')
            .eq('organization_id', context.orgId)
            .in('employee_result_id', [...batch])
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ),
    ).then(requirePeriodRows),
    readInBatches(employeeIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_account_events')
            .select('*')
            .eq('organization_id', context.orgId)
            .in('employee_record_id', [...batch])
            .gte('effective_date', periodStartDate)
            .lte('effective_date', periodEndDate)
            .in('event_kind', [...PAYROLL_ACCOUNT_EVENT_KINDS])
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ),
    ).then(requirePeriodRows),
    readInBatches(employeeIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_correction_requests')
            .select('id, subject_employee_record_id')
            .eq('organization_id', context.orgId)
            .in('subject_employee_record_id', [...batch])
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ),
    ).then(requirePeriodRows),
  ]);
  const correctionRequestIds = (correctionRequests ?? []).map((request) => request.id);
  const { data: correctionApplications } = await readInBatches(correctionRequestIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_correction_applications')
          .select('id, request_id, revision, source_fingerprint, applied_snapshot')
          .eq('organization_id', context.orgId)
          .in('request_id', [...batch])
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ),
  ).then(requirePeriodRows);
  return {
    calculation,
    closeVersion,
    mappingVersion,
    employeeMappings,
    codeMappings,
    employeeResults,
    employeeIds,
    dailyResults,
    resultSources,
    accountEvents,
    correctionRequests,
    correctionApplications,
  };
}

type PayrollExportSources = Awaited<ReturnType<typeof loadPayrollExportSources>>;
type PayrollEmployeeResult = PayrollExportSources['employeeResults'][number];
type PayrollExternalReferences = Map<
  string,
  PayrollExportSources['employeeMappings'][number]['external_employee_reference']
>;

function buildPayrollValueRows(input: {
  calculation: { version: number };
  period: { period_end_date: string };
  dailyResults: PayrollExportSources['dailyResults'];
  employeeResults: PayrollExportSources['employeeResults'];
  accountEvents: PayrollExportSources['accountEvents'];
  resultById: Map<string, PayrollEmployeeResult>;
  resultByEmployeeRecordId: Map<string, PayrollEmployeeResult>;
  externalByEmployee: PayrollExternalReferences;
  outputCodeFor: (valueKind: string, activityKind?: string) => string;
}): PayrollExportValueRow[] {
  const { calculation, period, dailyResults, employeeResults, accountEvents } = input;
  const { resultById, resultByEmployeeRecordId, externalByEmployee, outputCodeFor } = input;
  const valueRows: PayrollExportValueRow[] = [];
  const appendValue = (input: {
    rowId: string;
    employeeRecordId: string;
    localDate: string;
    valueKind: PayrollValueKind;
    activityKind?: string;
    sourceSeconds?: number;
    minutes: number;
    roundingDeltaSeconds?: number;
    policyVersionId: string;
  }): void => {
    if (input.minutes === 0 && (input.sourceSeconds ?? 0) === 0) return;
    valueRows.push({
      rowId: input.rowId,
      employeeRecordId: input.employeeRecordId,
      externalEmployeeReference: requirePresent(
        externalByEmployee.get(input.employeeRecordId),
        'payroll_employee_mapping_missing',
      ),
      localDate: input.localDate,
      valueKind: input.valueKind,
      outputCode: outputCodeFor(input.valueKind, input.activityKind),
      sourceSeconds: input.sourceSeconds ?? 0,
      minutes: input.minutes,
      roundingDeltaSeconds: input.roundingDeltaSeconds ?? 0,
      policyVersionId: input.policyVersionId,
      calculationVersion: calculation.version,
    });
  };
  for (const daily of dailyResults ?? []) {
    const result = resultById.get(daily.employee_result_id);
    if (!result) continue;
    const common = {
      employeeRecordId: daily.employee_record_id,
      localDate: daily.local_date,
      policyVersionId: result.policy_version_id ?? '',
    };
    appendValue({
      ...common,
      rowId: `${daily.id}:source`,
      valueKind: 'source_attendance',
      sourceSeconds: Number(daily.source_seconds),
      minutes: daily.source_minutes,
      roundingDeltaSeconds: Number(daily.rounding_delta_seconds),
    });
    appendValue({
      ...common,
      rowId: `${daily.id}:effective`,
      valueKind: 'effective_attendance',
      sourceSeconds: Number(daily.credited_seconds),
      minutes: daily.credited_minutes,
    });
    appendValue({
      ...common,
      rowId: `${daily.id}:credited`,
      valueKind: 'credited_activity',
      activityKind: daily.activity_kind,
      sourceSeconds: Number(daily.source_seconds),
      minutes: daily.credited_minutes,
      roundingDeltaSeconds: Number(daily.rounding_delta_seconds),
    });
    for (const [valueKind, minutes] of [
      ['vacation', daily.vacation_minutes],
      ['sickness', daily.sickness_minutes],
      ['night_supplement', daily.night_minutes],
      ['sunday_supplement', daily.sunday_minutes],
      ['public_holiday_supplement', daily.public_holiday_minutes],
    ] as const)
      appendValue({
        ...common,
        rowId: `${daily.id}:${valueKind}`,
        valueKind,
        minutes,
      });
  }
  for (const result of employeeResults ?? []) {
    const common = {
      employeeRecordId: result.employee_record_id,
      localDate: period.period_end_date,
      policyVersionId: result.policy_version_id ?? '',
    };
    appendValue({
      ...common,
      rowId: `${result.id}:target`,
      valueKind: 'target',
      minutes: result.target_minutes,
    });
    appendValue({
      ...common,
      rowId: `${result.id}:overtime`,
      valueKind: 'overtime',
      minutes: result.overtime_candidate_minutes,
    });
    appendValue({
      ...common,
      rowId: `${result.id}:opening`,
      valueKind: 'opening_balance',
      minutes: result.previous_balance_minutes,
    });
    appendValue({
      ...common,
      rowId: `${result.id}:closing`,
      valueKind: 'closing_balance',
      minutes: result.closing_balance_minutes,
    });
  }
  for (const event of accountEvents ?? []) {
    if (!isPayrollAccountEventKind(event.event_kind)) continue;
    const result = resultByEmployeeRecordId.get(event.employee_record_id);
    appendValue({
      rowId: `${event.id}:${event.event_kind}`,
      employeeRecordId: event.employee_record_id,
      localDate: event.effective_date,
      valueKind: event.event_kind,
      minutes: event.minutes,
      policyVersionId: result?.policy_version_id ?? '',
    });
  }
  return valueRows;
}

function buildPayrollAllocationRows(input: {
  resultSources: PayrollExportSources['resultSources'];
  dailyById: Map<string, PayrollExportSources['dailyResults'][number]>;
  resultById: Map<string, PayrollEmployeeResult>;
  externalByEmployee: PayrollExternalReferences;
}): PayrollExportAllocationRow[] {
  const { resultSources, dailyById, resultById, externalByEmployee } = input;
  const allocationMinutesBySourceId = new Map<string, number>();
  const sourcesByDailyResultId = new Map<string, Array<NonNullable<typeof resultSources>[number]>>();
  for (const source of resultSources ?? []) {
    if (!source.daily_result_id) continue;
    const list = sourcesByDailyResultId.get(source.daily_result_id) ?? [];
    list.push(source);
    sourcesByDailyResultId.set(source.daily_result_id, list);
  }
  for (const [dailyResultId, dailySources] of sourcesByDailyResultId) {
    const daily = dailyById.get(dailyResultId);
    if (!daily) continue;
    const distribution = distributeCreditedMinutes(
      dailySources.map((source) => ({
        id: source.id,
        sourceSeconds: Number(
          requireJsonRecord(source.source_snapshot, 'period_source_snapshot_invalid').sourceSeconds ?? 0,
        ),
      })),
      daily.credited_minutes,
    );
    for (const [sourceId, minutes] of distribution) allocationMinutesBySourceId.set(sourceId, minutes);
  }
  const allocationRows: PayrollExportAllocationRow[] = (resultSources ?? []).flatMap((source) => {
    if (!source.daily_result_id) return [];
    const daily = dailyById.get(source.daily_result_id);
    const result = resultById.get(source.employee_result_id);
    if (!daily || !result) return [];
    const snapshot = requireJsonRecord(source.source_snapshot, 'period_source_snapshot_invalid');
    const sourceSeconds = Number(snapshot.sourceSeconds ?? 0);
    const creditedMinutes = allocationMinutesBySourceId.get(source.id) ?? 0;
    return [
      {
        rowId: source.id,
        employeeRecordId: result.employee_record_id,
        externalEmployeeReference: requirePresent(
          externalByEmployee.get(result.employee_record_id),
          'payroll_employee_mapping_missing',
        ),
        localDate: daily.local_date,
        activityKind: daily.activity_kind,
        sourceReference: `${source.source_kind}:${source.source_id ?? source.source_key}`,
        sourceSeconds,
        creditedMinutes,
        allocationKind: String(snapshot.allocationKind ?? 'unallocated'),
        jobNumber: String(snapshot.jobNumber ?? ''),
        projectNumber: String(snapshot.projectNumber ?? ''),
      },
    ];
  });
  return allocationRows;
}

function buildPayrollCorrectionRows(input: {
  correctionApplications: PayrollExportSources['correctionApplications'];
  requestEmployeeById: Map<
    string,
    PayrollExportSources['correctionRequests'][number]['subject_employee_record_id']
  >;
  period: { period_start_date: string; period_end_date: string };
}): PayrollExportCorrectionRow[] {
  const { correctionApplications, requestEmployeeById, period } = input;
  // Facts carry any ISO offset; compare instants, not strings. Start inclusive, end exclusive.
  const periodStart = Date.parse(getBerlinInstant(`${period.period_start_date}T00:00`));
  const periodEnd = Date.parse(getBerlinInstant(`${addLocalDays(period.period_end_date, 1)}T00:00`));
  const correctionRows: PayrollExportCorrectionRow[] = (correctionApplications ?? []).flatMap(
    (application) => {
      const employeeRecordId = requestEmployeeById.get(application.request_id);
      const snapshot: unknown = application.applied_snapshot;
      const facts: unknown[] = isJsonRecord(snapshot) && Array.isArray(snapshot.facts) ? snapshot.facts : [];
      const affectsPeriod = facts.some((fact) => {
        if (!isJsonRecord(fact) || typeof fact.timestamp !== 'string') return false;
        const instant = Date.parse(fact.timestamp);
        return instant >= periodStart && instant < periodEnd;
      });
      if (!employeeRecordId || !affectsPeriod) return [];
      return [
        {
          rowId: application.id,
          employeeRecordId,
          requestId: application.request_id,
          revision: Number(application.revision),
          applicationId: application.id,
          sourceFingerprint: application.source_fingerprint,
        },
      ];
    },
  );
  return correctionRows;
}

// A safe reason for the failed export row: a thrown code, or the provider's
// error code. A message that is not a code (a database or storage message can
// carry row values or keys) becomes generation_failed.
function exportFailureReason(error: unknown): string {
  if (error instanceof Error && /^[a-z][a-z0-9_]*$/.test(error.message)) return error.message;
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string')
    return `provider_error:${error.code}`;
  return 'generation_failed';
}

// Runs the generation of a reserved export. Any failure marks the export
// failed and rethrows, so no export stays generating; one whose process
// stopped altogether fails at the next reservation of its period
// (reserve_payroll_export).
async function failReservedExportOnError(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  context: { orgId: string; userId: string },
  exportId: string,
  generate: () => Promise<void>,
): Promise<void> {
  try {
    await generate();
  } catch (error) {
    const { error: failError } = await admin.rpc('fail_payroll_export', {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_export_id: exportId,
      p_failure_reason: exportFailureReason(error),
      p_operation_id: randomUUID(),
    });
    if (failError) logError('generatePayrollExport: fail_payroll_export failed', failError);
    throw error;
  }
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
  const refusal = await refuseNonManager(context);
  if (refusal) return refusal;
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
  const { data: period, error: periodError } = await loggedRead(
    'generatePayrollExport: time_periods read failed',
    admin
      .from('time_periods')
      .select('*')
      .eq('id', periodId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (periodError) throw new Error('load_failed');
  if (!period?.current_calculation_id || !period.current_close_version_id)
    throw new Error('period_not_closed');
  const { data: profile, error: profileError } = await loggedRead(
    'generatePayrollExport: payroll_mapping_profiles read failed',
    admin
      .from('payroll_mapping_profiles')
      .select('current_version_id')
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (profileError) throw new Error('load_failed');
  if (!profile?.current_version_id) throw new Error('mapping_not_configured');
  const {
    calculation,
    closeVersion,
    mappingVersion,
    employeeMappings,
    codeMappings,
    employeeResults,
    employeeIds,
    dailyResults,
    resultSources,
    accountEvents,
    correctionRequests,
    correctionApplications,
  } = await loadPayrollExportSources({
    admin,
    context,
    calculationId: period.current_calculation_id,
    closeVersionId: period.current_close_version_id,
    mappingVersionId: profile.current_version_id,
    periodStartDate: period.period_start_date,
    periodEndDate: period.period_end_date,
  });
  const externalByEmployee = new Map(
    (employeeMappings ?? []).map((mapping) => [
      mapping.employee_record_id,
      mapping.external_employee_reference,
    ]),
  );
  for (const employeeId of employeeIds) {
    if (!externalByEmployee.get(employeeId)?.trim()) throw new Error('payroll_employee_mapping_missing');
  }
  const codeByKey = new Map(
    (codeMappings ?? []).map((mapping) => [
      `${mapping.value_kind}|${mapping.activity_kind ?? ''}`,
      mapping.output_code,
    ]),
  );
  const resultById = new Map((employeeResults ?? []).map((result) => [result.id, result]));
  const resultByEmployeeRecordId = new Map(
    (employeeResults ?? []).map((result) => [result.employee_record_id, result]),
  );
  const dailyById = new Map((dailyResults ?? []).map((daily) => [daily.id, daily]));
  const requestEmployeeById = new Map(
    (correctionRequests ?? []).map((request) => [request.id, request.subject_employee_record_id]),
  );
  const outputCodeFor = (valueKind: string, activityKind = ''): string =>
    codeByKey.get(`${valueKind}|${activityKind}`) ?? codeByKey.get(`${valueKind}|`) ?? '';
  const valueRows = buildPayrollValueRows({
    calculation,
    period,
    dailyResults,
    employeeResults,
    accountEvents,
    resultById,
    resultByEmployeeRecordId,
    externalByEmployee,
    outputCodeFor,
  });
  const allocationRows = buildPayrollAllocationRows({
    resultSources,
    dailyById,
    resultById,
    externalByEmployee,
  });
  const correctionRows = buildPayrollCorrectionRows({ correctionApplications, requestEmployeeById, period });
  valueRows.sort((left, right) => left.rowId.localeCompare(right.rowId));
  allocationRows.sort((left, right) => left.rowId.localeCompare(right.rowId));
  correctionRows.sort((left, right) => left.rowId.localeCompare(right.rowId));
  const contentFingerprint = hashPayload({
    periodId,
    closeVersion: closeVersion.id,
    mappingVersion: mappingVersion.id,
    valueRows,
    allocationRows,
    correctionRows,
  });
  const { data: latestReadyExport, error: latestReadyError } = await loggedRead(
    'generatePayrollExport: payroll_exports read failed',
    admin
      .from('payroll_exports')
      .select('id, close_version_id, content_fingerprint')
      .eq('organization_id', context.orgId)
      .eq('period_id', periodId)
      .eq('state', 'ready')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  // Without the current ready export, the new one would not supersede it.
  if (latestReadyError) throw new Error('export_failed');
  if (
    latestReadyExport?.close_version_id === closeVersion.id &&
    latestReadyExport?.content_fingerprint === contentFingerprint
  )
    return;
  const supersedesExportId = latestReadyExport?.id ?? null;
  const operationId = randomUUID();
  const { data: exportId, error: reserveError } = await admin.rpc(
    'reserve_payroll_export',
    rpcArgs('reserve_payroll_export', {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_period_id: periodId,
      p_mapping_version_id: mappingVersion.id,
      p_generator_version: 'p1-23-v1',
      p_content_fingerprint: contentFingerprint,
      p_supersedes_export_id: supersedesExportId,
      p_operation_id: operationId,
      p_request_hash: hashPayload({ periodId, contentFingerprint }),
    }),
  );
  if (reserveError || !exportId) throw new Error(reserveError?.message ?? 'export_reservation_failed');
  await failReservedExportOnError(admin, context, exportId, async () => {
    const { data: exportRow, error: exportRowError } = await admin
      .from('payroll_exports')
      .select('version')
      .eq('organization_id', context.orgId)
      .eq('id', exportId)
      .single();
    if (exportRowError || !exportRow)
      throw new Error(exportRowError?.message ?? 'export_reservation_missing');
    const generatedAt = closeVersion.closed_at;
    const packageResult = buildPayrollExportPackage({
      manifest: {
        schemaVersion: 1,
        exportId,
        exportVersion: exportRow.version,
        supersedesExportId,
        organizationId: context.orgId,
        periodStart: period.period_start_date,
        periodEnd: period.period_end_date,
        closeVersion: closeVersion.version,
        mappingVersion: mappingVersion.version,
        generatorVersion: 'p1-23-v1',
        generatedAt,
        scope: 'organization_period',
      },
      valueRows,
      allocationRows,
      correctionRows,
    });
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
  const refusal = await refuseNonManager(context);
  if (refusal) return refusal;
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

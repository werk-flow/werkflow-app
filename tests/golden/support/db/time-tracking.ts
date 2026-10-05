import { resolveBerlinWallTime } from '../../../../lib/planning/date-time';
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_CREDIT_RULES,
  DEFAULT_SUPPLEMENT_RULES,
  DEFAULT_WARNING_RULES,
} from '../../../../lib/time-accounts/defaults';
import { MissingTestFixtureError, createAdminClient } from './shared';

export type ManualTimeEntryState = { id: string; status: string };

export async function getLatestManualTimeEntryState(
  orgId: string,
  userId: string,
): Promise<ManualTimeEntryState> {
  const { data, error } = await createAdminClient()
    .from('time_entries')
    .select('id, status')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('is_manual', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Pending time entry query failed for ${userId}: ${error.message}`);
  }
  if (!data) {
    throw new MissingTestFixtureError(`Pending time entry missing for ${userId}`);
  }
  return { id: data.id as string, status: data.status as string };
}

export async function getOrganizationTimeEntryCount(orgId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from('time_entries')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId);
  if (error) throw new Error(`Organization time-entry count failed: ${error.message}`);
  return count ?? 0;
}

export async function getOrganizationTimeEntrySnapshot(
  orgId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await createAdminClient()
    .from('time_entries')
    .select('id, user_id, entry_type, timestamp, status, job_id, is_manual')
    .eq('organization_id', orgId)
    .order('id', { ascending: true });
  if (error) {
    throw new Error(`Time entry snapshot failed for ${orgId}: ${error.message}`);
  }
  return data ?? [];
}

export async function getTimeCaptureState(orgId: string, userId: string) {
  const rowLimit = 10_000;
  const admin = createAdminClient();
  const { data: sessions, error: sessionError } = await admin
    .from('time_sessions')
    .select('*')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .order('started_at')
    .order('id')
    .limit(rowLimit + 1);
  if (sessionError) throw new Error(`Time-session lookup failed: ${sessionError.message}`);
  if ((sessions?.length ?? 0) > rowLimit) {
    throw new Error(`Time-session lookup exceeded ${rowLimit} rows.`);
  }
  const sessionIds = (sessions ?? []).map((session) => session.id as string);
  const [segmentsResult, operationsResult, eventsResult, legacyResult] = await Promise.all([
    sessionIds.length
      ? admin
          .from('time_segments')
          .select('*')
          .in('session_id', sessionIds)
          .order('started_at')
          .order('id')
          .limit(rowLimit + 1)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from('time_operations')
      .select('*')
      .eq('organization_id', orgId)
      .eq('actor_id', userId)
      .order('created_at')
      .order('id')
      .limit(rowLimit + 1),
    sessionIds.length
      ? admin
          .from('time_segment_events')
          .select('*')
          .in('session_id', sessionIds)
          .order('occurred_at')
          .order('event_sequence')
          .limit(rowLimit + 1)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from('time_entries')
      .select('*')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .order('timestamp')
      .order('created_at')
      .order('id')
      .limit(rowLimit + 1),
  ]);
  const error = segmentsResult.error ?? operationsResult.error ?? eventsResult.error ?? legacyResult.error;
  if (error) throw new Error(`Time-capture lookup failed: ${error.message}`);
  if (
    [segmentsResult, operationsResult, eventsResult, legacyResult].some(
      (result) => (result.data?.length ?? 0) > rowLimit,
    )
  ) {
    throw new Error(`Time-capture lookup exceeded ${rowLimit} rows.`);
  }
  return {
    sessions: sessions ?? [],
    segments: segmentsResult.data ?? [],
    operations: operationsResult.data ?? [],
    events: eventsResult.data ?? [],
    legacyEntries: legacyResult.data ?? [],
  };
}

export async function seedLegacyOpenTimeEntry(orgId: string, userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: latest, error: latestError } = await admin
    .from('time_entries')
    .select('entry_type')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .neq('status', 'rejected')
    .neq('status', 'pending_delete')
    .order('timestamp', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) {
    throw new Error(`Legacy time fixture precondition failed: ${latestError.message}`);
  }
  if (['clock_in', 'break_end', 'break_start'].includes(latest?.entry_type ?? '')) {
    throw new Error('Legacy time fixture requires a clocked-out user.');
  }
  const { error } = await admin.from('time_entries').insert({
    organization_id: orgId,
    user_id: userId,
    entry_type: 'clock_in',
    timestamp: new Date().toISOString(),
    is_manual: false,
    status: 'approved',
  });
  if (error) throw new Error(`Legacy time fixture failed: ${error.message}`);
}

/** Seeds one approved, uncorrected manual clock-in/clock-out pair on a Berlin date (HH:MM wall times). */
export async function seedApprovedManualInterval(input: {
  organizationId: string;
  userId: string;
  date: string;
  from: string;
  to: string;
}): Promise<void> {
  const start = resolveBerlinWallTime(`${input.date}T${input.from}`);
  const end = resolveBerlinWallTime(`${input.date}T${input.to}`);
  if (!start || !end) throw new Error('Manual interval fixture requires a valid Berlin interval.');
  const { error } = await createAdminClient()
    .from('time_entries')
    .insert([
      {
        organization_id: input.organizationId,
        user_id: input.userId,
        entry_type: 'clock_in' as const,
        timestamp: start.instant.toISOString(),
        status: 'approved' as const,
        is_manual: true,
      },
      {
        organization_id: input.organizationId,
        user_id: input.userId,
        entry_type: 'clock_out' as const,
        timestamp: end.instant.toISOString(),
        status: 'approved' as const,
        is_manual: true,
      },
    ]);
  if (error) throw new Error(`Manual interval fixture failed: ${error.message}`);
}

/** Seeds one open manual submission (a clock-in/clock-out pair) on a Berlin date; returns both entry ids. */
export async function seedPendingManualInterval(input: {
  organizationId: string;
  userId: string;
  date: string;
  from: string;
  to: string;
}): Promise<{ clockInId: string; clockOutId: string }> {
  const start = resolveBerlinWallTime(`${input.date}T${input.from}`);
  const end = resolveBerlinWallTime(`${input.date}T${input.to}`);
  if (!start || !end) throw new Error('Pending interval fixture requires a valid Berlin interval.');
  const ids = { clockInId: randomUUID(), clockOutId: randomUUID() };
  // One insert is one submission: both rows share their creation time.
  const { error } = await createAdminClient()
    .from('time_entries')
    .insert([
      {
        id: ids.clockInId,
        organization_id: input.organizationId,
        user_id: input.userId,
        entry_type: 'clock_in' as const,
        timestamp: start.instant.toISOString(),
        status: 'pending' as const,
        is_manual: true,
      },
      {
        id: ids.clockOutId,
        organization_id: input.organizationId,
        user_id: input.userId,
        entry_type: 'clock_out' as const,
        timestamp: end.instant.toISOString(),
        status: 'pending' as const,
        is_manual: true,
      },
    ]);
  if (error) throw new Error(`Pending interval fixture failed: ${error.message}`);
  return ids;
}

/** The current status of the given time entries, by id. */
export async function getTimeEntryStatuses(orgId: string, entryIds: readonly string[]): Promise<string[]> {
  const { data, error } = await createAdminClient()
    .from('time_entries')
    .select('id, status')
    .eq('organization_id', orgId)
    .in('id', [...entryIds]);
  if (error) throw new Error(`Time entry status lookup failed: ${error.message}`);
  return entryIds.map((id) => data.find((row) => row.id === id)?.status ?? 'missing');
}

export async function getTimeCorrectionState(orgId: string) {
  const admin = createAdminClient();
  const rowLimit = 10_000;
  const [requests, revisions, sources, events, applications] = await Promise.all([
    admin
      .from('time_correction_requests')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at')
      .limit(rowLimit + 1),
    admin
      .from('time_correction_request_revisions')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at')
      .limit(rowLimit + 1),
    admin
      .from('time_correction_request_sources')
      .select('*')
      .eq('organization_id', orgId)
      .order('request_id')
      .order('revision')
      .order('ordinal')
      .limit(rowLimit + 1),
    admin
      .from('time_correction_events')
      .select('*')
      .eq('organization_id', orgId)
      .order('occurred_at')
      .order('id')
      .limit(rowLimit + 1),
    admin
      .from('time_correction_applications')
      .select('*')
      .eq('organization_id', orgId)
      .order('applied_at')
      .order('id')
      .limit(rowLimit + 1),
  ]);
  const firstError = requests.error ?? revisions.error ?? sources.error ?? events.error ?? applications.error;
  if (firstError) throw new Error(`Time-correction lookup failed: ${firstError.message}`);
  if (
    [requests, revisions, sources, events, applications].some(
      (result) => (result.data?.length ?? 0) > rowLimit,
    )
  )
    throw new Error(`Time-correction lookup exceeded ${rowLimit} rows.`);
  return {
    requests: requests.data ?? [],
    revisions: revisions.data ?? [],
    sources: sources.data ?? [],
    events: events.data ?? [],
    applications: applications.data ?? [],
  };
}

export async function getP123State(organizationId: string) {
  const admin = createAdminClient();
  const [
    accounts,
    events,
    periods,
    calculations,
    results,
    findings,
    closes,
    mappings,
    exports,
    policyAssignments,
    adjustmentRequests,
    adjustmentEvents,
  ] = await Promise.all([
    admin.from('time_accounts').select('*').eq('organization_id', organizationId).order('employee_record_id'),
    admin
      .from('time_account_events')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at')
      .order('id'),
    admin
      .from('time_periods')
      .select('*')
      .eq('organization_id', organizationId)
      .order('period_start_date')
      .order('id'),
    admin
      .from('time_period_calculations')
      .select('*')
      .eq('organization_id', organizationId)
      .order('version')
      .order('id'),
    admin.from('time_period_employee_results').select('*').eq('organization_id', organizationId),
    admin.from('time_period_findings').select('*').eq('organization_id', organizationId),
    admin
      .from('time_period_close_versions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('version')
      .order('id'),
    admin
      .from('payroll_mapping_versions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('version')
      .order('id'),
    admin
      .from('payroll_exports')
      .select('*')
      .eq('organization_id', organizationId)
      .order('version')
      .order('id'),
    admin
      .from('time_account_policy_assignments')
      .select('*')
      .eq('organization_id', organizationId)
      .order('valid_from')
      .order('id'),
    admin
      .from('time_account_adjustment_requests')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at')
      .order('id'),
    admin.from('time_account_adjustment_events').select('*').eq('organization_id', organizationId),
  ]);
  const error =
    accounts.error ??
    events.error ??
    periods.error ??
    calculations.error ??
    results.error ??
    findings.error ??
    closes.error ??
    mappings.error ??
    exports.error ??
    policyAssignments.error ??
    adjustmentRequests.error ??
    adjustmentEvents.error;
  if (error) throw new Error(`P1-23 state query failed: ${error.message}`);
  return {
    accounts: accounts.data ?? [],
    events: events.data ?? [],
    periods: periods.data ?? [],
    calculations: calculations.data ?? [],
    results: results.data ?? [],
    findings: findings.data ?? [],
    closes: closes.data ?? [],
    mappings: mappings.data ?? [],
    exports: exports.data ?? [],
    policyAssignments: policyAssignments.data ?? [],
    adjustmentRequests: adjustmentRequests.data ?? [],
    adjustmentEvents: adjustmentEvents.data ?? [],
  };
}

/**
 * Confirms the organization's default time policy through the same RPC and starter rules as the
 * settings action, unless a current default exists. Setup only; golden P1-23 confirms it in the UI.
 */
export async function confirmP123DefaultPolicy(input: {
  organizationId: string;
  actorUserId: string;
  effectiveFrom: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: current, error: currentError } = await admin
    .from('time_account_policies')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('is_default', true)
    .is('retired_at', null)
    .maybeSingle();
  if (currentError) throw new Error(`P1-23 default policy lookup failed: ${currentError.message}`);
  if (current) return;
  const payload = {
    effectiveFrom: input.effectiveFrom,
    name: 'Standard-Arbeitszeit',
    createAsException: false,
    credit: DEFAULT_CREDIT_RULES,
    supplements: DEFAULT_SUPPLEMENT_RULES,
    warnings: DEFAULT_WARNING_RULES,
  };
  // The generated Args type marks the nullable policy id and night window as strings; the
  // settings action calls this RPC through the untyped admin client with the same nulls.
  const untypedAdmin: SupabaseClient = admin;
  const { error } = await untypedAdmin.rpc('create_time_account_policy_version', {
    p_organization_id: input.organizationId,
    p_policy_id: null,
    p_name: payload.name,
    p_is_default: true,
    p_effective_from: input.effectiveFrom,
    p_vacation_treatment: 'paid',
    p_sickness_treatment: 'paid',
    p_night_window_start: null,
    p_night_window_end: null,
    p_credit_rules: DEFAULT_CREDIT_RULES,
    p_supplement_rules: DEFAULT_SUPPLEMENT_RULES,
    p_warning_rules: DEFAULT_WARNING_RULES,
    p_actor_id: input.actorUserId,
    p_operation_id: randomUUID(),
    p_request_hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  });
  if (error) throw new Error(`P1-23 default policy setup failed: ${error.message}`);
}

export async function seedP123UnclosedLegacySequence(input: {
  organizationId: string;
  userId: string;
  startedAt: string;
}): Promise<void> {
  const existing = await getP123LegacyTransition(
    input.organizationId,
    input.userId,
    'clock_in',
    input.startedAt,
  );
  if (existing) return;
  const { error } = await createAdminClient().from('time_entries').insert({
    organization_id: input.organizationId,
    user_id: input.userId,
    entry_type: 'clock_in',
    timestamp: input.startedAt,
    is_manual: true,
    status: 'approved',
  });
  if (error) throw new Error(`P1-23 open legacy-sequence setup failed: ${error.message}`);
}

export async function closeP123LegacySequence(input: {
  organizationId: string;
  userId: string;
  endedAt: string;
}): Promise<void> {
  const existing = await getP123LegacyTransition(
    input.organizationId,
    input.userId,
    'clock_out',
    input.endedAt,
  );
  if (existing) return;
  const { error } = await createAdminClient().from('time_entries').insert({
    organization_id: input.organizationId,
    user_id: input.userId,
    entry_type: 'clock_out',
    timestamp: input.endedAt,
    is_manual: true,
    status: 'approved',
  });
  if (error) throw new Error(`P1-23 legacy-sequence cleanup failed: ${error.message}`);
}

async function getP123LegacyTransition(
  organizationId: string,
  userId: string,
  entryType: 'clock_in' | 'clock_out',
  timestamp: string,
): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from('time_entries')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('entry_type', entryType)
    .eq('timestamp', timestamp)
    .eq('is_manual', true)
    .eq('status', 'approved')
    .maybeSingle();
  if (error) throw new Error(`P1-23 exact legacy transition lookup failed: ${error.message}`);
  return data?.id ?? null;
}

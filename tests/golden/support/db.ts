import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  toWorkSchedule,
  type WorkSchedule,
  type WorkScheduleRow,
} from '../../../lib/personnel/schedule';
import {
  toEmploymentCondition,
  type EmploymentCondition,
  type EmploymentConditionRow,
} from '../../../lib/personnel/types';
import {
  parseHolidayRegionHistory,
  type OrganizationHolidayCalendar,
} from '../../../lib/personnel/targets';
import { requireEnv } from './env';

// Read-only service-role lookups for gate assertions. Specs drive everything
// user-visible through the UI; these helpers only observe database state that
// the UI cannot prove (the invite code inside the email link, and the stock
// ledger behind the visible quantities).

function createAdminClient(): SupabaseClient {
  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The invite email link carries this code; reading it from the database is the
// harness's stand-in for opening the invitee's mailbox.
export async function getPendingInviteCode(orgId: string, email: string): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('organization_invites')
    .select('invite_code')
    .eq('organization_id', orgId)
    .eq('email', email.toLowerCase())
    .eq('status', 'pending')
    .single();

  if (error || !data) {
    throw new Error(`No pending invite found for ${email}: ${error?.message}`);
  }
  return data.invite_code as string;
}

export type RequestConversionState = {
  status: string;
  convertedJobId: string | null;
  convertedProjectId: string | null;
  convertedAt: string | null;
  convertedBy: string | null;
};

// P1-02: DB-side proof that a conversion happened exactly once and is
// attributable — the UI shows the link, this shows the once-only facts.
export async function getRequestConversionState(
  orgId: string,
  requestNumber: string
): Promise<RequestConversionState> {
  const { data, error } = await createAdminClient()
    .from('client_requests')
    .select('status, converted_job_id, converted_project_id, converted_at, converted_by')
    .eq('organization_id', orgId)
    .eq('request_number', requestNumber)
    .single();

  if (error || !data) {
    throw new Error(`No request found with number ${requestNumber}: ${error?.message}`);
  }

  return {
    status: data.status as string,
    convertedJobId: (data.converted_job_id as string | null) ?? null,
    convertedProjectId: (data.converted_project_id as string | null) ?? null,
    convertedAt: (data.converted_at as string | null) ?? null,
    convertedBy: (data.converted_by as string | null) ?? null,
  };
}

export type EmployeeRecordState = {
  id: string;
  userId: string | null;
  employeeNumber: string | null;
  entryDate: string | null;
  exitDate: string | null;
  recordCountForUser: number;
  // Null once the membership was removed (e.g. the destructive-removal check).
  membershipJoinedAt: string | null;
};

// P1-03: DB-side proof for personnel facts the UI cannot show directly —
// exactly one record per person per organization, the backfilled entry date,
// and the exit marking after a destructive membership removal.
export async function getEmployeeRecordStateByUser(
  orgId: string,
  userId: string
): Promise<EmployeeRecordState> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('employee_records')
    .select('id, user_id, employee_number, entry_date, exit_date')
    .eq('organization_id', orgId)
    .eq('user_id', userId);

  if (error || !data || data.length === 0) {
    throw new Error(`No employee record found for user ${userId}: ${error?.message}`);
  }

  const { data: membership } = await admin
    .from('organization_members')
    .select('joined_at')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  const row = data[0];
  return {
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    employeeNumber: (row.employee_number as string | null) ?? null,
    entryDate: (row.entry_date as string | null) ?? null,
    exitDate: (row.exit_date as string | null) ?? null,
    recordCountForUser: data.length,
    membershipJoinedAt: (membership?.joined_at as string | null) ?? null,
  };
}

// P1-04: which work-schedule rows a real signed-in user can see under RLS.
// The UI never shows foreign schedules, so the self-or-manager SELECT policy
// (managers all org rows, a person exactly their own) is proved here.
// Deliberately no signOut: the default scope would revoke the user's other
// sessions and break the browser fixtures of later tests.
export async function getVisibleWorkScheduleRecordIdsAs(
  user: { email: string; password: string },
  orgId: string
): Promise<string[]> {
  const client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) {
    throw new Error(`Sign-in failed for ${user.email}: ${signInError.message}`);
  }

  const { data, error } = await client
    .from('work_schedules')
    .select('employee_record_id')
    .eq('organization_id', orgId);
  if (error) {
    throw new Error(`work_schedules query failed for ${user.email}: ${error.message}`);
  }

  return [...new Set((data ?? []).map((row) => row.employee_record_id as string))];
}

export type ResponsibilityConfigurationState = {
  id: string;
  mode: string;
  holderEmployeeRecordIds: string[];
};

export async function getLatestResponsibilityConfigurationState(
  orgId: string,
  responsibility: 'time_approval' | 'leave_approval'
): Promise<ResponsibilityConfigurationState> {
  const admin = createAdminClient();
  const { data: configuration, error } = await admin
    .from('organization_responsibility_configurations')
    .select('id, mode')
    .eq('organization_id', orgId)
    .eq('responsibility', responsibility)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !configuration) {
    throw new Error(`Responsibility configuration missing: ${error?.message}`);
  }

  const { data: assignments, error: assignmentError } = await admin
    .from('organization_responsibility_assignments')
    .select('employee_record_id')
    .eq('configuration_id', configuration.id);
  if (assignmentError) {
    throw new Error(`Responsibility assignments query failed: ${assignmentError.message}`);
  }

  return {
    id: configuration.id as string,
    mode: configuration.mode as string,
    holderEmployeeRecordIds: (assignments ?? [])
      .map((assignment) => assignment.employee_record_id as string)
      .sort(),
  };
}

export async function getVisibleResponsibilityEmployeeRecordIdsAs(
  user: { email: string; password: string },
  orgId: string
): Promise<string[]> {
  const client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) {
    throw new Error(`Sign-in failed for ${user.email}: ${signInError.message}`);
  }

  const { data, error } = await client
    .from('organization_responsibility_assignments')
    .select('employee_record_id')
    .eq('organization_id', orgId);
  if (error) {
    throw new Error(`Responsibility RLS query failed for ${user.email}: ${error.message}`);
  }

  return [
    ...new Set((data ?? []).map((row) => row.employee_record_id as string)),
  ].sort();
}

export async function getLatestManualTimeEntryState(
  orgId: string,
  userId: string
): Promise<{ id: string; status: string }> {
  const { data, error } = await createAdminClient()
    .from('time_entries')
    .select('id, status')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('is_manual', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(`Pending time entry missing for ${userId}: ${error?.message}`);
  }
  return { id: data.id as string, status: data.status as string };
}

export async function expectOwnerRoleMutationRejected(
  orgId: string,
  ownerUserId: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('organization_members')
    .update({ role: 'employee' })
    .eq('organization_id', orgId)
    .eq('user_id', ownerUserId);
  if (!error?.message.includes('organization_owner_is_protected')) {
    if (!error) {
      const { error: restoreError } = await admin
        .from('organization_members')
        .update({ role: 'admin' })
        .eq('organization_id', orgId)
        .eq('user_id', ownerUserId);
      if (restoreError) {
        throw new Error(
          `Owner role mutation unexpectedly succeeded and restoration failed: ${restoreError.message}`
        );
      }
    }
    throw new Error(
      `Owner role mutation was not rejected by the database: ${error?.message ?? 'no error'}`
    );
  }

  const { data: membership, error: readError } = await admin
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', ownerUserId)
    .single();
  if (readError) {
    throw new Error(`Owner membership verification failed: ${readError.message}`);
  }
  if (membership.role !== 'admin') {
    throw new Error('Owner membership changed despite last-admin protection.');
  }
}

// P1-06: the exact target/counting context the app itself uses, so spec
// expectations (consumed days, weekly Soll) are computed from the same stored
// state and in-code rules as the product — never re-invented date logic.
export type VacationTargetContext = {
  schedules: WorkSchedule[];
  conditions: EmploymentCondition[];
  calendar: OrganizationHolidayCalendar;
};

export async function getTargetContextForRecord(
  orgId: string,
  employeeRecordId: string
): Promise<VacationTargetContext> {
  const admin = createAdminClient();
  const [schedulesResult, conditionsResult, settingsResult, closureResult] =
    await Promise.all([
      admin
        .from('work_schedules')
        .select('*')
        .eq('organization_id', orgId)
        .eq('employee_record_id', employeeRecordId),
      admin
        .from('employment_conditions')
        .select('*')
        .eq('organization_id', orgId)
        .eq('employee_record_id', employeeRecordId),
      admin
        .from('organization_settings')
        .select('holiday_region, holiday_region_history')
        .eq('organization_id', orgId)
        .maybeSingle(),
      admin
        .from('organization_closure_days')
        .select('id, closure_date, label')
        .eq('organization_id', orgId),
    ]);

  const firstError =
    schedulesResult.error ??
    conditionsResult.error ??
    settingsResult.error ??
    closureResult.error;
  if (firstError) {
    throw new Error(`Target context query failed: ${firstError.message}`);
  }

  return {
    schedules: (schedulesResult.data ?? []).map((row) =>
      toWorkSchedule(row as WorkScheduleRow)
    ),
    conditions: (conditionsResult.data ?? []).map((row) =>
      toEmploymentCondition(row as EmploymentConditionRow)
    ),
    calendar: {
      holidayRegion:
        (settingsResult.data?.holiday_region as string | null) ?? null,
      holidayRegionHistory: parseHolidayRegionHistory(
        settingsResult.data?.holiday_region_history
      ),
      closureDays: (closureResult.data ?? []).map((row) => ({
        id: row.id as string,
        closureDate: row.closure_date as string,
        label: (row.label as string | null) ?? null,
      })),
    },
  };
}

export type VacationRequestState = {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  dayPortion: string;
  approvedDaysByYear: Record<string, number> | null;
  eventTypes: string[];
};

// Latest vacation request of a record plus its append-only event trail — the
// DB-side proof for decision facts, snapshots, and traceable restoration.
export async function getLatestVacationRequestState(
  orgId: string,
  employeeRecordId: string
): Promise<VacationRequestState> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('vacation_requests')
    .select('id, status, start_date, end_date, day_portion, approved_days_by_year')
    .eq('organization_id', orgId)
    .eq('employee_record_id', employeeRecordId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(
      `No vacation request found for record ${employeeRecordId}: ${error?.message}`
    );
  }

  const { data: events, error: eventsError } = await admin
    .from('vacation_request_events')
    .select('event_type, created_at')
    .eq('vacation_request_id', data.id)
    .order('created_at', { ascending: true });
  if (eventsError) {
    throw new Error(`Vacation event query failed: ${eventsError.message}`);
  }

  return {
    id: data.id as string,
    status: data.status as string,
    startDate: data.start_date as string,
    endDate: data.end_date as string,
    dayPortion: data.day_portion as string,
    approvedDaysByYear:
      (data.approved_days_by_year as Record<string, number> | null) ?? null,
    eventTypes: (events ?? []).map((event) => event.event_type as string),
  };
}

// P1-06: which vacation-request rows a real signed-in user can see under RLS
// (managers all org rows, a person exactly their own, outsiders none).
export async function getVisibleVacationRequestRecordIdsAs(
  user: { email: string; password: string },
  orgId: string
): Promise<string[]> {
  const client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) {
    throw new Error(`Sign-in failed for ${user.email}: ${signInError.message}`);
  }

  const { data, error } = await client
    .from('vacation_requests')
    .select('employee_record_id')
    .eq('organization_id', orgId);
  if (error) {
    throw new Error(
      `vacation_requests query failed for ${user.email}: ${error.message}`
    );
  }

  return [
    ...new Set((data ?? []).map((row) => row.employee_record_id as string)),
  ].sort();
}

// P1-07: pattern-level attention state — read markers and append-only pattern
// events for one user. Proves that a marked-read fact is stored and audited
// (the "an item that disappears is explainable" contract).
export type AttentionPatternState = {
  readStates: Array<{
    sourceType: string;
    sourceId: string;
    stateVersion: string;
  }>;
  events: Array<{ sourceType: string; sourceId: string; eventType: string }>;
};

export async function getAttentionPatternStateForUser(
  orgId: string,
  userId: string
): Promise<AttentionPatternState> {
  const admin = createAdminClient();
  const [readStatesResult, eventsResult] = await Promise.all([
    admin
      .from('attention_read_states')
      .select('source_type, source_id, state_version')
      .eq('organization_id', orgId)
      .eq('user_id', userId),
    admin
      .from('attention_events')
      .select('source_type, source_id, event_type, created_at')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
  ]);
  if (readStatesResult.error || eventsResult.error) {
    throw new Error(
      `Attention state query failed: ${
        readStatesResult.error?.message ?? eventsResult.error?.message
      }`
    );
  }

  return {
    readStates: (readStatesResult.data ?? []).map((row) => ({
      sourceType: row.source_type as string,
      sourceId: row.source_id as string,
      stateVersion: row.state_version as string,
    })),
    events: (eventsResult.data ?? []).map((row) => ({
      sourceType: row.source_type as string,
      sourceId: row.source_id as string,
      eventType: row.event_type as string,
    })),
  };
}

// P1-07: which attention rows a real signed-in user can see under RLS.
// Read markers are strictly self-scoped (even managers see only their own);
// pattern events are self-or-manager. Outsiders see nothing.
export async function getVisibleAttentionOwnersAs(
  user: { email: string; password: string },
  orgId: string
): Promise<{ readStateUserIds: string[]; eventUserIds: string[] }> {
  const client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) {
    throw new Error(`Sign-in failed for ${user.email}: ${signInError.message}`);
  }

  const [readStatesResult, eventsResult] = await Promise.all([
    client
      .from('attention_read_states')
      .select('user_id')
      .eq('organization_id', orgId),
    client
      .from('attention_events')
      .select('user_id')
      .eq('organization_id', orgId),
  ]);
  if (readStatesResult.error || eventsResult.error) {
    throw new Error(
      `Attention RLS query failed for ${user.email}: ${
        readStatesResult.error?.message ?? eventsResult.error?.message
      }`
    );
  }

  return {
    readStateUserIds: [
      ...new Set(
        (readStatesResult.data ?? []).map((row) => row.user_id as string)
      ),
    ].sort(),
    eventUserIds: [
      ...new Set(
        (eventsResult.data ?? []).map((row) => row.user_id as string)
      ),
    ].sort(),
  };
}

// P1-07: the one open client request GG-01 leaves behind, by number.
export async function getClientRequestByNumber(
  orgId: string,
  requestNumber: string
): Promise<{ id: string; status: string; assignedTo: string | null }> {
  const { data, error } = await createAdminClient()
    .from('client_requests')
    .select('id, status, assigned_to')
    .eq('organization_id', orgId)
    .eq('request_number', requestNumber)
    .single();
  if (error || !data) {
    throw new Error(
      `No client request found with number ${requestNumber}: ${error?.message}`
    );
  }
  return {
    id: data.id as string,
    status: data.status as string,
    assignedTo: (data.assigned_to as string | null) ?? null,
  };
}

// P1-07: how many client requests are currently open (offen/in_klaerung) —
// the mode-independent input for unified-badge expectations.
export async function countOpenClientRequests(orgId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from('client_requests')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .in('status', ['offen', 'in_klaerung']);
  if (error) {
    throw new Error(`Open request count failed: ${error.message}`);
  }
  return count ?? 0;
}

// P1-07: all vacation requests of one record keyed by start date, so specs can
// address a specific request's id (the attention item identity) even when the
// person has several.
export async function getVacationRequestIdsByStartDate(
  orgId: string,
  employeeRecordId: string
): Promise<Map<string, { id: string; status: string }>> {
  const { data, error } = await createAdminClient()
    .from('vacation_requests')
    .select('id, status, start_date, created_at')
    .eq('organization_id', orgId)
    .eq('employee_record_id', employeeRecordId)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(`Vacation request lookup failed: ${error.message}`);
  }
  const byStartDate = new Map<string, { id: string; status: string }>();
  for (const row of data ?? []) {
    // Later requests win: a withdrawn request and its re-submission share the
    // start date and the newer one is the acting item.
    byStartDate.set(row.start_date as string, {
      id: row.id as string,
      status: row.status as string,
    });
  }
  return byStartDate;
}

// P1-08: latest sickness report of a record plus its append-only event trail —
// the DB-side proof for reported facts, corrections, evidence bookkeeping,
// and traceable cancellation.
export type SicknessReportDbState = {
  id: string;
  status: string;
  absenceType: string;
  startDate: string;
  endDate: string | null;
  dayPortion: string;
  evidenceRequired: boolean;
  evidenceStatus: string;
  cancellationReason: string | null;
  eventTypes: string[];
};

export async function getLatestSicknessReportState(
  orgId: string,
  employeeRecordId: string
): Promise<SicknessReportDbState> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sickness_reports')
    .select(
      'id, status, absence_type, start_date, end_date, day_portion, evidence_required, evidence_status, cancellation_reason'
    )
    .eq('organization_id', orgId)
    .eq('employee_record_id', employeeRecordId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(
      `No sickness report found for record ${employeeRecordId}: ${error?.message}`
    );
  }

  const { data: events, error: eventsError } = await admin
    .from('sickness_report_events')
    .select('event_type, created_at')
    .eq('sickness_report_id', data.id)
    .order('created_at', { ascending: true });
  if (eventsError) {
    throw new Error(`Sickness event query failed: ${eventsError.message}`);
  }

  return {
    id: data.id as string,
    status: data.status as string,
    absenceType: data.absence_type as string,
    startDate: data.start_date as string,
    endDate: (data.end_date as string | null) ?? null,
    dayPortion: data.day_portion as string,
    evidenceRequired: data.evidence_required as boolean,
    evidenceStatus: data.evidence_status as string,
    cancellationReason: (data.cancellation_reason as string | null) ?? null,
    eventTypes: (events ?? []).map((event) => event.event_type as string),
  };
}

// P1-08: which sickness-report rows a real signed-in user can see under RLS
// (managers all org rows, a person exactly their own, outsiders none) — the
// browser never shows foreign reports, so the privacy matrix's row-level
// boundary is proved here with real credentials. No signOut, as documented on
// getVisibleWorkScheduleRecordIdsAs.
export async function getVisibleSicknessRecordIdsAs(
  user: { email: string; password: string },
  orgId: string
): Promise<string[]> {
  const client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) {
    throw new Error(`Sign-in failed for ${user.email}: ${signInError.message}`);
  }

  const { data, error } = await client
    .from('sickness_reports')
    .select('employee_record_id')
    .eq('organization_id', orgId);
  if (error) {
    throw new Error(
      `sickness_reports query failed for ${user.email}: ${error.message}`
    );
  }

  return [
    ...new Set((data ?? []).map((row) => row.employee_record_id as string)),
  ].sort();
}

// P1-08: the effective absence spans (approved vacation + active sickness,
// open ends clamped to the window) for one record — the same inputs the app's
// target loaders build, so spec Soll expectations can never drift from the
// product's own arithmetic.
export async function getAbsenceSpansForRecord(
  orgId: string,
  employeeRecordId: string,
  windowStartIso: string,
  windowEndIso: string
): Promise<
  Array<{
    type: 'vacation' | 'sickness';
    startDate: string;
    endDate: string;
    dayPortion: 'full' | 'half_day';
  }>
> {
  const admin = createAdminClient();
  const [vacationResult, sicknessResult] = await Promise.all([
    admin
      .from('vacation_requests')
      .select('start_date, end_date, day_portion')
      .eq('organization_id', orgId)
      .eq('employee_record_id', employeeRecordId)
      .eq('status', 'approved')
      .lte('start_date', windowEndIso)
      .gte('end_date', windowStartIso),
    admin
      .from('sickness_reports')
      .select('start_date, end_date, day_portion')
      .eq('organization_id', orgId)
      .eq('employee_record_id', employeeRecordId)
      .eq('status', 'reported')
      .lte('start_date', windowEndIso)
      .or(`end_date.gte.${windowStartIso},end_date.is.null`),
  ]);
  if (vacationResult.error || sicknessResult.error) {
    throw new Error(
      `Absence span query failed: ${
        vacationResult.error?.message ?? sicknessResult.error?.message
      }`
    );
  }

  return [
    ...(vacationResult.data ?? []).map((row) => ({
      type: 'vacation' as const,
      startDate: row.start_date as string,
      endDate: row.end_date as string,
      dayPortion: row.day_portion as 'full' | 'half_day',
    })),
    ...(sicknessResult.data ?? []).map((row) => ({
      type: 'sickness' as const,
      startDate: row.start_date as string,
      endDate: (row.end_date as string | null) ?? windowEndIso,
      dayPortion: row.day_portion as 'full' | 'half_day',
    })),
  ];
}

// P1-08: whether a record has approved vacation intersecting [startIso, ∞) or
// [startIso, endIso] — the mode-independent expectation for the overlap hint.
export async function hasApprovedVacationIntersecting(
  orgId: string,
  employeeRecordId: string,
  startIso: string,
  endIso: string | null
): Promise<boolean> {
  let query = createAdminClient()
    .from('vacation_requests')
    .select('id')
    .eq('organization_id', orgId)
    .eq('employee_record_id', employeeRecordId)
    .eq('status', 'approved')
    .gte('end_date', startIso)
    .limit(1);
  if (endIso !== null) {
    query = query.lte('start_date', endIso);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`Vacation intersection query failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

// P1-09: real-credential visibility across the qualification domain. The
// employee may see only their own membership/capability rows and the matching
// vocabulary/team labels; managers see the organization; outsiders see none.
export async function getVisibleQualificationStateAs(
  user: { email: string; password: string },
  orgId: string
): Promise<{
  teamEmployeeRecordIds: string[];
  capabilityEmployeeRecordIds: string[];
  evidenceStates: string[];
  requirementCount: number;
  assessmentCount: number;
}> {
  const client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) {
    throw new Error(`Sign-in failed for ${user.email}: ${signInError.message}`);
  }

  const [memberships, capabilities, requirements, assessments] =
    await Promise.all([
      client
        .from('team_memberships')
        .select('employee_record_id')
        .eq('organization_id', orgId),
      client
        .from('employee_capabilities')
        .select('employee_record_id, evidence_state')
        .eq('organization_id', orgId),
      client
        .from('job_capability_requirements')
        .select('id')
        .eq('organization_id', orgId),
      client
        .from('job_qualification_assessments')
        .select('id')
        .eq('organization_id', orgId),
    ]);
  const firstError =
    memberships.error ??
    capabilities.error ??
    requirements.error ??
    assessments.error;
  if (firstError) {
    throw new Error(
      `Qualification RLS query failed for ${user.email}: ${firstError.message}`
    );
  }

  return {
    teamEmployeeRecordIds: [
      ...new Set(
        (memberships.data ?? []).map(
          (row) => row.employee_record_id as string
        )
      ),
    ].sort(),
    capabilityEmployeeRecordIds: [
      ...new Set(
        (capabilities.data ?? []).map(
          (row) => row.employee_record_id as string
        )
      ),
    ].sort(),
    evidenceStates: (capabilities.data ?? [])
      .map((row) => row.evidence_state as string)
      .sort(),
    requirementCount: requirements.data?.length ?? 0,
    assessmentCount: assessments.data?.length ?? 0,
  };
}

// P1-10: authoritative relationship records and their append-only histories.
// The browser proves visible behavior; these observations prove actor/history
// facts and the manager-only RLS boundary with real credentials.
export async function getCustomerRelationshipState(
  orgId: string,
  customerName: string
): Promise<{
  clientId: string;
  followUps: Array<{
    id: string;
    title: string;
    status: string;
    ownerUserId: string;
    completedBy: string | null;
  }>;
  followUpEventTypes: string[];
  preferenceEventTypes: string[];
}> {
  const admin = createAdminClient();
  const { data: client, error: clientError } = await admin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('name', customerName)
    .single();
  if (clientError || !client) {
    throw new Error(`Customer ${customerName} not found: ${clientError?.message}`);
  }
  const [followUps, followUpEvents, preferenceEvents] = await Promise.all([
    admin
      .from('client_follow_ups')
      .select('id,title,status,owner_user_id,completed_by')
      .eq('organization_id', orgId)
      .eq('client_id', client.id)
      .order('created_at', { ascending: true }),
    admin
      .from('client_follow_up_events')
      .select('event_type')
      .eq('organization_id', orgId)
      .eq('client_id', client.id)
      .order('created_at', { ascending: true }),
    admin
      .from('client_communication_preference_events')
      .select('event_type')
      .eq('organization_id', orgId)
      .eq('client_id', client.id)
      .order('created_at', { ascending: true }),
  ]);
  const firstError = followUps.error ?? followUpEvents.error ?? preferenceEvents.error;
  if (firstError) {
    throw new Error(`Customer relationship observation failed: ${firstError.message}`);
  }
  return {
    clientId: client.id as string,
    followUps: (followUps.data ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      status: row.status as string,
      ownerUserId: row.owner_user_id as string,
      completedBy: (row.completed_by as string | null) ?? null,
    })),
    followUpEventTypes: (followUpEvents.data ?? []).map(
      (row) => row.event_type as string
    ),
    preferenceEventTypes: (preferenceEvents.data ?? []).map(
      (row) => row.event_type as string
    ),
  };
}

export async function getVisibleCustomerRelationshipStateAs(
  user: { email: string; password: string },
  orgId: string
): Promise<Record<string, number>> {
  const client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) {
    throw new Error(`Sign-in failed for ${user.email}: ${signInError.message}`);
  }

  const tableNames = [
    'clients',
    'client_contacts',
    'client_sites',
    'client_follow_ups',
    'client_follow_up_events',
    'client_communication_settings',
    'client_communication_preferences',
    'client_communication_preference_events',
  ] as const;
  const results = await Promise.all(
    tableNames.map(async (tableName) => {
      const { count, error } = await client
        .from(tableName)
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId);
      if (error) {
        throw new Error(
          `Customer relationship RLS query ${tableName} failed for ${user.email}: ${error.message}`
        );
      }
      return [tableName, count ?? 0] as const;
    })
  );
  return Object.fromEntries(results);
}

export async function getCapabilityHistoryState(
  orgId: string,
  employeeRecordId: string,
  capabilityName: string
): Promise<{
  rows: Array<{
    id: string;
    validFrom: string;
    validUntil: string | null;
    supersedesId: string | null;
    supersededAt: string | null;
    evidenceState: string;
    confirmationStatus: string;
  }>;
  employeeEventTypes: string[];
}> {
  const admin = createAdminClient();
  const { data: definition, error: definitionError } = await admin
    .from('organization_capabilities')
    .select('id')
    .eq('organization_id', orgId)
    .eq('name', capabilityName)
    .single();
  if (definitionError || !definition) {
    throw new Error(
      `Capability ${capabilityName} missing: ${definitionError?.message}`
    );
  }
  const [rowsResult, eventsResult] = await Promise.all([
    admin
      .from('employee_capabilities')
      .select(
        'id, valid_from, valid_until, supersedes_id, superseded_at, evidence_state, confirmation_status, created_at'
      )
      .eq('organization_id', orgId)
      .eq('employee_record_id', employeeRecordId)
      .eq('capability_id', definition.id)
      .order('created_at', { ascending: true }),
    admin
      .from('employee_record_events')
      .select('event_type, created_at')
      .eq('organization_id', orgId)
      .eq('employee_record_id', employeeRecordId)
      .in('event_type', [
        'qualification_added',
        'qualification_corrected',
        'qualification_renewed',
      ])
      .order('created_at', { ascending: true }),
  ]);
  if (rowsResult.error || eventsResult.error) {
    throw new Error(
      `Capability history query failed: ${
        rowsResult.error?.message ?? eventsResult.error?.message
      }`
    );
  }
  return {
    rows: (rowsResult.data ?? []).map((row) => ({
      id: row.id as string,
      validFrom: row.valid_from as string,
      validUntil: (row.valid_until as string | null) ?? null,
      supersedesId: (row.supersedes_id as string | null) ?? null,
      supersededAt: (row.superseded_at as string | null) ?? null,
      evidenceState: row.evidence_state as string,
      confirmationStatus: row.confirmation_status as string,
    })),
    employeeEventTypes: (eventsResult.data ?? []).map(
      (event) => event.event_type as string
    ),
  };
}

export async function getJobQualificationState(
  orgId: string,
  jobNumber: string
): Promise<{
  jobId: string;
  requirementCount: number;
  assessments: Array<{
    overrideReason: string | null;
    teamSourceId: string | null;
    fingerprint: string;
  }>;
}> {
  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('job_number', jobNumber)
    .single();
  if (jobError || !job) {
    throw new Error(`Job ${jobNumber} missing: ${jobError?.message}`);
  }
  const [requirements, assessments] = await Promise.all([
    admin
      .from('job_capability_requirements')
      .select('id')
      .eq('organization_id', orgId)
      .eq('job_id', job.id),
    admin
      .from('job_qualification_assessments')
      .select('override_reason, team_source_id, coverage_fingerprint, created_at')
      .eq('organization_id', orgId)
      .eq('job_id', job.id)
      .order('created_at', { ascending: true }),
  ]);
  if (requirements.error || assessments.error) {
    throw new Error(
      `Job qualification query failed: ${
        requirements.error?.message ?? assessments.error?.message
      }`
    );
  }
  return {
    jobId: job.id as string,
    requirementCount: requirements.data?.length ?? 0,
    assessments: (assessments.data ?? []).map((row) => ({
      overrideReason: (row.override_reason as string | null) ?? null,
      teamSourceId: (row.team_source_id as string | null) ?? null,
      fingerprint: row.coverage_fingerprint as string,
    })),
  };
}

export type PlanningDbState = {
  jobId: string | null;
  occurrenceCount: number;
  seriesCount: number;
  assignmentCount: number;
  assessmentCount: number;
  capacityConflictKinds: string[];
  qualificationEvaluationCount: number;
  overrideReasons: string[];
  eventTypes: string[];
  actualTimeCount: number;
  occurrences: Array<{
    id: string;
    seriesId: string | null;
    originalStartLocal: string | null;
    startAt: string | null;
    endAt: string | null;
    startDate: string | null;
    endDateExclusive: string | null;
    status: string;
    isException: boolean;
    legacySourceJobId: string | null;
  }>;
};

// P1-11: read-only proof for stable occurrence identity, append-only audit,
// multiple visits per authoritative job, and plan-versus-actual separation.
export async function getPlanningState(
  orgId: string,
  subject: { jobNumber?: string; internalTitle?: string }
): Promise<PlanningDbState> {
  const admin = createAdminClient();
  if (!subject.jobNumber && !subject.internalTitle) {
    throw new Error('getPlanningState requires jobNumber or internalTitle');
  }
  let jobId: string | null = null;
  if (subject.jobNumber) {
    const { data: job, error } = await admin
      .from('jobs')
      .select('id')
      .eq('organization_id', orgId)
      .eq('job_number', subject.jobNumber)
      .single();
    if (error || !job) {
      throw new Error(`Planning job lookup failed: ${error?.message}`);
    }
    jobId = job.id as string;
  }

  let occurrenceQuery = admin
    .from('planning_occurrences')
    .select('id, series_id, original_start_local, start_at, end_at, start_date, end_date_exclusive, status, is_exception, legacy_source_job_id')
    .eq('organization_id', orgId)
    .order('original_start_local', { ascending: true, nullsFirst: false })
    .limit(1001);
  if (jobId) occurrenceQuery = occurrenceQuery.eq('job_id', jobId);
  if (subject.internalTitle) {
    occurrenceQuery = occurrenceQuery
      .eq('entry_kind', 'internal')
      .eq('title', subject.internalTitle);
  }
  const { data: occurrenceRows, error: occurrenceError } =
    await occurrenceQuery;
  if (occurrenceError) {
    throw new Error(`Planning occurrence lookup failed: ${occurrenceError?.message}`);
  }
  if ((occurrenceRows?.length ?? 0) > 1000) {
    throw new Error('Planning occurrence lookup exceeded the 1000-row safety limit');
  }

  const occurrenceIds = (occurrenceRows ?? []).map((row) => row.id as string);
  const seriesIds = [
    ...new Set(
      (occurrenceRows ?? []).flatMap((row) =>
        row.series_id ? [row.series_id as string] : []
      )
    ),
  ];
  const [seriesResult, assignmentResult, assessmentResult, eventResult, timeResult] =
    await Promise.all([
      seriesIds.length
        ? admin
            .from('planning_series')
            .select('id')
            .eq('organization_id', orgId)
            .in('id', seriesIds)
        : Promise.resolve({ data: [], error: null }),
      occurrenceIds.length
        ? admin
            .from('planning_occurrence_assignments')
            .select('id')
            .eq('organization_id', orgId)
            .in('occurrence_id', occurrenceIds)
            .limit(10_001)
        : Promise.resolve({ data: [], error: null }),
      occurrenceIds.length
        ? admin
            .from('planning_occurrence_assessments')
            .select('id, capacity_snapshot, qualification_snapshot, override_reason')
            .eq('organization_id', orgId)
            .in('occurrence_id', occurrenceIds)
            .limit(10_001)
        : Promise.resolve({ data: [], error: null }),
      occurrenceIds.length
        ? admin
            .from('planning_events')
            .select('event_type')
            .eq('organization_id', orgId)
            .in('occurrence_id', occurrenceIds)
            .order('created_at')
            .limit(10_001)
        : Promise.resolve({ data: [], error: null }),
      jobId
        ? admin
            .from('time_entries')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('job_id', jobId)
        : Promise.resolve({ count: 0, error: null }),
    ]);
  const firstError =
    seriesResult.error ??
    assignmentResult.error ??
    assessmentResult.error ??
    eventResult.error ??
    timeResult.error;
  if (firstError) {
    throw new Error(`Planning state lookup failed: ${firstError.message}`);
  }
  if (
    (assignmentResult.data?.length ?? 0) > 10_000 ||
    (assessmentResult.data?.length ?? 0) > 10_000 ||
    (eventResult.data?.length ?? 0) > 10_000
  ) {
    throw new Error('Planning related-record lookup exceeded its safety limit');
  }

  return {
    jobId,
    occurrenceCount: occurrenceRows?.length ?? 0,
    seriesCount: seriesResult.data?.length ?? 0,
    assignmentCount: assignmentResult.data?.length ?? 0,
    assessmentCount: assessmentResult.data?.length ?? 0,
    capacityConflictKinds: [
      ...new Set(
        (assessmentResult.data ?? []).flatMap((row) => {
          const snapshot = row.capacity_snapshot as {
            conflicts?: Array<{ kind?: string }>;
          } | null;
          return (snapshot?.conflicts ?? []).flatMap((conflict) =>
            conflict.kind ? [conflict.kind] : []
          );
        })
      ),
    ].sort(),
    qualificationEvaluationCount: (assessmentResult.data ?? []).reduce(
      (count, row) => {
        const snapshot = row.qualification_snapshot as {
          evaluations?: unknown[];
        } | null;
        return count + (snapshot?.evaluations?.length ?? 0);
      },
      0
    ),
    overrideReasons: (assessmentResult.data ?? []).flatMap((row) =>
      row.override_reason ? [row.override_reason as string] : []
    ),
    eventTypes: (eventResult.data ?? []).map(
      (row) => row.event_type as string
    ),
    actualTimeCount: timeResult.count ?? 0,
    occurrences: (occurrenceRows ?? []).map((row) => ({
      id: row.id as string,
      seriesId: (row.series_id as string | null) ?? null,
      originalStartLocal:
        (row.original_start_local as string | null) ?? null,
      startAt: (row.start_at as string | null) ?? null,
      endAt: (row.end_at as string | null) ?? null,
      startDate: (row.start_date as string | null) ?? null,
      endDateExclusive:
        (row.end_date_exclusive as string | null) ?? null,
      status: row.status as string,
      isException: row.is_exception as boolean,
      legacySourceJobId:
        (row.legacy_source_job_id as string | null) ?? null,
    })),
  };
}

export async function getOrganizationTimeEntryCount(
  orgId: string
): Promise<number> {
  const { count, error } = await createAdminClient()
    .from('time_entries')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId);
  if (error) throw new Error(`Organization time-entry count failed: ${error.message}`);
  return count ?? 0;
}

export async function getVisiblePlanningStateAs(
  user: { email: string; password: string },
  orgId: string
): Promise<Record<'planning_series' | 'planning_occurrences' | 'planning_occurrence_assignments' | 'planning_occurrence_assessments' | 'planning_events', number>> {
  const client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) {
    throw new Error(`Planning RLS sign-in failed: ${signInError.message}`);
  }
  const tables = [
    'planning_series',
    'planning_occurrences',
    'planning_occurrence_assignments',
    'planning_occurrence_assessments',
    'planning_events',
  ] as const;
  const results = await Promise.all(
    tables.map((table) =>
      client
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
    )
  );
  const error = results.find((result) => result.error)?.error;
  if (error) throw new Error(`Planning RLS lookup failed: ${error.message}`);
  return Object.fromEntries(
    tables.map((table, index) => [table, results[index].count ?? 0])
  ) as Record<(typeof tables)[number], number>;
}

export type InventoryLedgerState = {
  quantityOnHand: number;
  movementTotal: number;
  lastQuantityAfter: number;
  movementCount: number;
};

// Snapshot of one item/location pair: the stored stock level plus what the
// movement ledger implies. A consistent ledger means quantityOnHand equals
// both the sum of all deltas and the last movement's quantity_after.
export async function getInventoryLedgerState(
  orgId: string,
  itemId: string,
  locationId: string
): Promise<InventoryLedgerState> {
  const admin = createAdminClient();

  const { data: stockLevel, error: stockError } = await admin
    .from('inventory_stock_levels')
    .select('quantity_on_hand')
    .eq('organization_id', orgId)
    .eq('item_id', itemId)
    .eq('location_id', locationId)
    .maybeSingle();
  if (stockError) {
    throw new Error(`Failed to read stock level: ${stockError.message}`);
  }

  const { data: movements, error: movementError } = await admin
    .from('inventory_movements')
    .select('quantity_delta, quantity_after, created_at')
    .eq('organization_id', orgId)
    .eq('item_id', itemId)
    .eq('location_id', locationId)
    .order('created_at', { ascending: true });
  if (movementError) {
    throw new Error(`Failed to read inventory movements: ${movementError.message}`);
  }

  const rows = movements ?? [];
  const movementTotal = rows.reduce((sum, row) => sum + Number(row.quantity_delta), 0);
  const lastQuantityAfter =
    rows.length > 0 ? Number(rows[rows.length - 1].quantity_after) : 0;

  return {
    quantityOnHand: Number(stockLevel?.quantity_on_hand ?? 0),
    movementTotal,
    lastQuantityAfter,
    movementCount: rows.length,
  };
}

// ============================================
// P1-12: dispatch, parking context, and customer-commitment lookups.
// Read-only — specs drive every business mutation through the UI.
// ============================================

export type DispatchDbState = {
  dispatches: Array<{
    dispatchId: string;
    status: string;
    targetKind: 'occurrence' | 'job';
    currentRevisionNumber: number | null;
    revisionChangeKinds: string[];
    currentRecipientRecordIds: string[];
    acknowledgements: Array<{
      revisionNumber: number;
      employeeRecordId: string;
      state: string;
      challengeResolution: string | null;
    }>;
    eventTypes: string[];
  }>;
};

async function resolveJobIdByNumber(
  admin: SupabaseClient,
  orgId: string,
  jobNumber: string
): Promise<string> {
  const { data, error } = await admin
    .from('jobs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('job_number', jobNumber)
    .single();
  if (error || !data) {
    throw new Error(`Job ${jobNumber} not found: ${error?.message}`);
  }
  return data.id as string;
}

export async function getDispatchState(
  orgId: string,
  jobNumber: string
): Promise<DispatchDbState> {
  const admin = createAdminClient();
  const jobId = await resolveJobIdByNumber(admin, orgId, jobNumber);
  const { data: occurrences, error: occurrenceError } = await admin
    .from('planning_occurrences')
    .select('id')
    .eq('organization_id', orgId)
    .eq('job_id', jobId)
    .limit(501);
  if (occurrenceError || (occurrences?.length ?? 0) > 500) {
    throw new Error(
      `Dispatch occurrence lookup failed: ${occurrenceError?.message ?? 'overflow'}`
    );
  }
  const occurrenceIds = (occurrences ?? []).map((row) => row.id as string);
  let dispatchQuery = admin
    .from('planning_dispatches')
    .select('id, status, occurrence_id, job_id, current_revision_id, created_at')
    .eq('organization_id', orgId);
  dispatchQuery = occurrenceIds.length
    ? dispatchQuery.or(
        `job_id.eq.${jobId},occurrence_id.in.(${occurrenceIds.join(',')})`
      )
    : dispatchQuery.eq('job_id', jobId);
  const { data: dispatches, error: dispatchError } = await dispatchQuery
    .order('created_at', { ascending: true })
    .limit(101);
  if (dispatchError || (dispatches?.length ?? 0) > 100) {
    throw new Error(
      `Dispatch lookup failed: ${dispatchError?.message ?? 'overflow'}`
    );
  }
  const dispatchIds = (dispatches ?? []).map((row) => row.id as string);
  if (!dispatchIds.length) return { dispatches: [] };

  const [revisionsResult, recipientsResult, acksResult, eventsResult] =
    await Promise.all([
      admin
        .from('planning_dispatch_revisions')
        .select('id, dispatch_id, revision_number, change_kind')
        .eq('organization_id', orgId)
        .in('dispatch_id', dispatchIds)
        .order('revision_number', { ascending: true })
        .limit(1001),
      admin
        .from('planning_dispatch_recipients')
        .select('revision_id, employee_record_id')
        .eq('organization_id', orgId)
        .in('dispatch_id', dispatchIds)
        .limit(5001),
      admin
        .from('planning_dispatch_acknowledgements')
        .select(
          'revision_id, employee_record_id, state, challenge_resolution, created_at'
        )
        .eq('organization_id', orgId)
        .in('dispatch_id', dispatchIds)
        .order('created_at', { ascending: true })
        .limit(5001),
      admin
        .from('planning_dispatch_events')
        .select('dispatch_id, event_type, created_at')
        .eq('organization_id', orgId)
        .in('dispatch_id', dispatchIds)
        .order('created_at', { ascending: true })
        .limit(1001),
    ]);
  const lookupError =
    revisionsResult.error ??
    recipientsResult.error ??
    acksResult.error ??
    eventsResult.error;
  if (
    lookupError ||
    (revisionsResult.data?.length ?? 0) > 1000 ||
    (recipientsResult.data?.length ?? 0) > 5000 ||
    (acksResult.data?.length ?? 0) > 5000 ||
    (eventsResult.data?.length ?? 0) > 1000
  ) {
    throw new Error(
      `Dispatch detail lookup failed: ${lookupError?.message ?? 'overflow'}`
    );
  }
  const revisionNumberById = new Map(
    (revisionsResult.data ?? []).map((row) => [row.id, row.revision_number])
  );
  const requireRevisionNumber = (revisionId: string): number => {
    const revisionNumber = revisionNumberById.get(revisionId);
    if (revisionNumber === undefined) {
      throw new Error(`Dispatch revision ${revisionId} missing from lookup`);
    }
    return revisionNumber;
  };

  return {
    dispatches: (dispatches ?? []).map((dispatch) => {
      const revisions = (revisionsResult.data ?? []).filter(
        (row) => row.dispatch_id === dispatch.id
      );
      return {
        dispatchId: dispatch.id,
        status: dispatch.status,
        targetKind: dispatch.occurrence_id ? 'occurrence' : 'job',
        currentRevisionNumber:
          revisionNumberById.get(dispatch.current_revision_id) ?? null,
        revisionChangeKinds: revisions.map((row) => row.change_kind as string),
        currentRecipientRecordIds: (recipientsResult.data ?? [])
          .filter((row) => row.revision_id === dispatch.current_revision_id)
          .map((row) => row.employee_record_id as string),
        acknowledgements: (acksResult.data ?? [])
          .filter((row) =>
            revisions.some((revision) => revision.id === row.revision_id)
          )
          .map((row) => ({
            revisionNumber: requireRevisionNumber(row.revision_id),
            employeeRecordId: row.employee_record_id as string,
            state: row.state as string,
            challengeResolution: row.challenge_resolution as string | null,
          })),
        eventTypes: (eventsResult.data ?? [])
          .filter((row) => row.dispatch_id === dispatch.id)
          .map((row) => row.event_type as string),
      };
    }),
  };
}

export async function getParkingState(
  orgId: string,
  jobNumber: string
): Promise<{
  context: {
    reason: string;
    note: string | null;
    responsibleEmployeeRecordId: string | null;
    nextReviewDate: string | null;
  } | null;
  eventTypes: string[];
}> {
  const admin = createAdminClient();
  const jobId = await resolveJobIdByNumber(admin, orgId, jobNumber);
  const [contextResult, eventsResult] = await Promise.all([
    admin
      .from('job_parking_contexts')
      .select('reason, note, responsible_employee_record_id, next_review_date')
      .eq('organization_id', orgId)
      .eq('job_id', jobId)
      .maybeSingle(),
    admin
      .from('job_parking_events')
      .select('event_type, created_at')
      .eq('organization_id', orgId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: true })
      .limit(501),
  ]);
  if (
    contextResult.error ||
    eventsResult.error ||
    (eventsResult.data?.length ?? 0) > 500
  ) {
    throw new Error(
      `Parking lookup failed: ${(contextResult.error ?? eventsResult.error)?.message ?? 'overflow'}`
    );
  }
  return {
    context: contextResult.data
      ? {
          reason: contextResult.data.reason as string,
          note: contextResult.data.note as string | null,
          responsibleEmployeeRecordId:
            contextResult.data.responsible_employee_record_id as string | null,
          nextReviewDate: contextResult.data.next_review_date as string | null,
        }
      : null,
    eventTypes: (eventsResult.data ?? []).map((row) => row.event_type as string),
  };
}

export async function getCommitmentState(
  orgId: string,
  jobNumber: string
): Promise<
  Array<{
    status: string;
    committedDate: string;
    supersedesId: string | null;
  }>
> {
  const admin = createAdminClient();
  const jobId = await resolveJobIdByNumber(admin, orgId, jobNumber);
  const { data: occurrences, error: occurrenceError } = await admin
    .from('planning_occurrences')
    .select('id')
    .eq('organization_id', orgId)
    .eq('job_id', jobId)
    .limit(501);
  if (occurrenceError || (occurrences?.length ?? 0) > 500) {
    throw new Error(
      `Commitment occurrence lookup failed: ${occurrenceError?.message ?? 'overflow'}`
    );
  }
  const occurrenceIds = (occurrences ?? []).map((row) => row.id as string);
  if (!occurrenceIds.length) return [];
  const { data, error } = await admin
    .from('planning_customer_commitments')
    .select('status, committed_date, supersedes_id, recorded_at')
    .eq('organization_id', orgId)
    .in('occurrence_id', occurrenceIds)
    .order('recorded_at', { ascending: true })
    .limit(501);
  if (error || (data?.length ?? 0) > 500) {
    throw new Error(`Commitment lookup failed: ${error?.message ?? 'overflow'}`);
  }
  return (data ?? []).map((row) => ({
    status: row.status as string,
    committedDate: row.committed_date as string,
    supersedesId: row.supersedes_id as string | null,
  }));
}

export async function getVisibleDispatchStateAs(
  user: { email: string; password: string },
  orgId: string
): Promise<
  Record<
    | 'planning_dispatches'
    | 'planning_dispatch_revisions'
    | 'planning_dispatch_recipients'
    | 'planning_dispatch_acknowledgements'
    | 'planning_dispatch_events'
    | 'job_parking_contexts'
    | 'planning_customer_commitments',
    number
  >
> {
  const client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) {
    throw new Error(`Dispatch RLS sign-in failed: ${signInError.message}`);
  }
  const tables = [
    'planning_dispatches',
    'planning_dispatch_revisions',
    'planning_dispatch_recipients',
    'planning_dispatch_acknowledgements',
    'planning_dispatch_events',
    'job_parking_contexts',
    'planning_customer_commitments',
  ] as const;
  // Sequential on purpose: a parallel burst of head-count requests right
  // after three sign-ins intermittently dropped a connection in suite runs.
  const counts: number[] = [];
  for (const table of tables) {
    // job_parking_contexts is keyed by job_id; every other table has an id.
    const countColumn = table === 'job_parking_contexts' ? 'job_id' : 'id';
    const { count, error } = await client
      .from(table)
      .select(countColumn, { count: 'exact', head: true })
      .eq('organization_id', orgId);
    if (error) {
      throw new Error(
        `Dispatch RLS lookup failed for ${table}: ${error.message || error.code || JSON.stringify(error)}`
      );
    }
    counts.push(count ?? 0);
  }
  return Object.fromEntries(
    tables.map((table, index) => [table, counts[index]])
  ) as Record<(typeof tables)[number], number>;
}

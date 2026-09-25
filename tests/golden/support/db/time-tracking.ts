import { MissingTestFixtureError, createAdminClient, withRoleClient } from './shared';

export type ManualTimeEntryState = { id: string; status: string };

export async function getLatestManualTimeEntryState(
  orgId: string,
  userId: string,
): Promise<ManualTimeEntryState> {
  const { data, error } = await createAdminClient()
    .from("time_entries")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("is_manual", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Pending time entry query failed for ${userId}: ${error.message}`,
    );
  }
  if (!data) {
    throw new MissingTestFixtureError(
      `Pending time entry missing for ${userId}`,
    );
  }
  return { id: data.id as string, status: data.status as string };
}

export async function findLatestManualTimeEntryState(
  orgId: string,
  userId: string,
): Promise<ManualTimeEntryState | null> {
  try {
    return await getLatestManualTimeEntryState(orgId, userId);
  } catch (error) {
    if (error instanceof MissingTestFixtureError) return null;
    throw error;
  }
}

export async function getOrganizationTimeEntryCount(
  orgId: string,
): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  if (error)
    throw new Error(`Organization time-entry count failed: ${error.message}`);
  return count ?? 0;
}

export async function getOrganizationTimeEntrySnapshot(
  orgId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await createAdminClient()
    .from("time_entries")
    .select("id, user_id, entry_type, timestamp, status, job_id, is_manual")
    .eq("organization_id", orgId)
    .order("id", { ascending: true });
  if (error) {
    throw new Error(
      `Time entry snapshot failed for ${orgId}: ${error.message}`,
    );
  }
  return data ?? [];
}

export async function getTimeCaptureState(orgId: string, userId: string) {
  const rowLimit = 10_000;
  const admin = createAdminClient();
  const { data: sessions, error: sessionError } = await admin
    .from("time_sessions")
    .select("*")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .order("started_at")
    .order("id")
    .limit(rowLimit + 1);
  if (sessionError) throw new Error(`Time-session lookup failed: ${sessionError.message}`);
  if ((sessions?.length ?? 0) > rowLimit) {
    throw new Error(`Time-session lookup exceeded ${rowLimit} rows.`);
  }
  const sessionIds = (sessions ?? []).map((session) => session.id as string);
  const [segmentsResult, operationsResult, eventsResult, legacyResult] = await Promise.all([
    sessionIds.length
      ? admin.from("time_segments").select("*").in("session_id", sessionIds)
          .order("started_at").order("id").limit(rowLimit + 1)
      : Promise.resolve({ data: [], error: null }),
    admin.from("time_operations").select("*").eq("organization_id", orgId)
      .eq("actor_id", userId).order("created_at").order("id").limit(rowLimit + 1),
    sessionIds.length
      ? admin.from("time_segment_events").select("*").in("session_id", sessionIds)
          .order("occurred_at").order("event_sequence").limit(rowLimit + 1)
      : Promise.resolve({ data: [], error: null }),
    admin.from("time_entries").select("*").eq("organization_id", orgId)
      .eq("user_id", userId).order("timestamp").order("created_at").order("id")
      .limit(rowLimit + 1),
  ]);
  const error = segmentsResult.error ?? operationsResult.error ?? eventsResult.error ?? legacyResult.error;
  if (error) throw new Error(`Time-capture lookup failed: ${error.message}`);
  if ([segmentsResult, operationsResult, eventsResult, legacyResult].some(
    (result) => (result.data?.length ?? 0) > rowLimit,
  )) {
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
    .from("time_entries")
    .select("entry_type")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .neq("status", "rejected")
    .neq("status", "pending_delete")
    .order("timestamp", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) {
    throw new Error(`Legacy time fixture precondition failed: ${latestError.message}`);
  }
  if (["clock_in", "break_end", "break_start"].includes(latest?.entry_type ?? "")) {
    throw new Error("Legacy time fixture requires a clocked-out user.");
  }
  const { error } = await admin.from("time_entries").insert({
    organization_id: orgId,
    user_id: userId,
    entry_type: "clock_in",
    timestamp: new Date().toISOString(),
    is_manual: false,
    status: "approved",
  });
  if (error) throw new Error(`Legacy time fixture failed: ${error.message}`);
}

export async function getTimeCaptureCountsAs(
  user: { email: string; password: string },
  orgId: string,
) {
  return withRoleClient(user, async (client) => {
    const tables = ["time_sessions", "time_segments", "time_operations", "time_segment_events"] as const;
    const counts = {} as Record<(typeof tables)[number], number>;
    for (const table of tables) {
      const { count, error } = await client
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId);
      if (error) throw new Error(`Time-capture RLS lookup failed for ${table}: ${error.message}`);
      counts[table] = count ?? 0;
    }
    return counts;
  });
}

export async function getTimeCorrectionState(orgId: string) {
  const admin = createAdminClient();
  const rowLimit = 10_000;
  const [requests, revisions, sources, events, applications] = await Promise.all([
    admin.from("time_correction_requests").select("*")
      .eq("organization_id", orgId).order("created_at").limit(rowLimit + 1),
    admin.from("time_correction_request_revisions").select("*")
      .eq("organization_id", orgId).order("created_at").limit(rowLimit + 1),
    admin.from("time_correction_request_sources").select("*")
      .eq("organization_id", orgId).order("request_id").order("revision").order("ordinal")
      .limit(rowLimit + 1),
    admin.from("time_correction_events").select("*")
      .eq("organization_id", orgId).order("occurred_at").order("id").limit(rowLimit + 1),
    admin.from("time_correction_applications").select("*")
      .eq("organization_id", orgId).order("applied_at").order("id").limit(rowLimit + 1),
  ]);
  const firstError = requests.error ?? revisions.error ?? sources.error
    ?? events.error ?? applications.error;
  if (firstError) throw new Error(`Time-correction lookup failed: ${firstError.message}`);
  if ([requests, revisions, sources, events, applications].some(
    (result) => (result.data?.length ?? 0) > rowLimit,
  )) throw new Error(`Time-correction lookup exceeded ${rowLimit} rows.`);
  return {
    requests: requests.data ?? [],
    revisions: revisions.data ?? [],
    sources: sources.data ?? [],
    events: events.data ?? [],
    applications: applications.data ?? [],
  };
}

export async function getTimeCorrectionCountsAs(
  user: { email: string; password: string },
  orgId: string,
) {
  return withRoleClient(user, async (client) => {
    const tables = [
      "time_correction_requests",
      "time_correction_request_revisions",
      "time_correction_request_sources",
      "time_correction_events",
      "time_correction_applications",
    ] as const;
    const counts = {} as Record<(typeof tables)[number], number>;
    for (const table of tables) {
      const { count, error } = await client.from(table)
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId);
      if (error) throw new Error(`Time-correction RLS lookup failed for ${table}: ${error.message}`);
      counts[table] = count ?? 0;
    }
    return counts;
  });
}

export async function getP123State(organizationId: string) {
  const admin = createAdminClient();
  const [accounts, events, periods, calculations, results, findings, closes, mappings, exports,
    policyAssignments, adjustmentRequests, adjustmentEvents] =
    await Promise.all([
      admin.from("time_accounts").select("*").eq("organization_id", organizationId).order("employee_record_id"),
      admin.from("time_account_events").select("*").eq("organization_id", organizationId).order("created_at").order("id"),
      admin.from("time_periods").select("*").eq("organization_id", organizationId).order("period_start_date").order("id"),
      admin.from("time_period_calculations").select("*").eq("organization_id", organizationId).order("version").order("id"),
      admin.from("time_period_employee_results").select("*").eq("organization_id", organizationId),
      admin.from("time_period_findings").select("*").eq("organization_id", organizationId),
      admin.from("time_period_close_versions").select("*").eq("organization_id", organizationId).order("version").order("id"),
      admin.from("payroll_mapping_versions").select("*").eq("organization_id", organizationId).order("version").order("id"),
      admin.from("payroll_exports").select("*").eq("organization_id", organizationId).order("version").order("id"),
      admin.from("time_account_policy_assignments").select("*").eq("organization_id", organizationId).order("valid_from").order("id"),
      admin.from("time_account_adjustment_requests").select("*").eq("organization_id", organizationId).order("created_at").order("id"),
      admin.from("time_account_adjustment_events").select("*").eq("organization_id", organizationId),
    ]);
  const error =
    accounts.error ?? events.error ?? periods.error ?? calculations.error ??
    results.error ?? findings.error ?? closes.error ?? mappings.error ?? exports.error ??
    policyAssignments.error ?? adjustmentRequests.error ?? adjustmentEvents.error;
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

export async function seedP123UnclosedLegacySequence(input: {
  organizationId: string;
  userId: string;
  startedAt: string;
}): Promise<void> {
  const existing = await getP123LegacyTransition(
    input.organizationId,
    input.userId,
    "clock_in",
    input.startedAt,
  );
  if (existing) return;
  const { error } = await createAdminClient()
    .from("time_entries")
    .insert({
      organization_id: input.organizationId,
      user_id: input.userId,
      entry_type: "clock_in",
      timestamp: input.startedAt,
      is_manual: true,
      status: "approved",
    });
  if (error)
    throw new Error(`P1-23 open legacy-sequence setup failed: ${error.message}`);
}

export async function closeP123LegacySequence(input: {
  organizationId: string;
  userId: string;
  endedAt: string;
}): Promise<void> {
  const existing = await getP123LegacyTransition(
    input.organizationId,
    input.userId,
    "clock_out",
    input.endedAt,
  );
  if (existing) return;
  const { error } = await createAdminClient()
    .from("time_entries")
    .insert({
      organization_id: input.organizationId,
      user_id: input.userId,
      entry_type: "clock_out",
      timestamp: input.endedAt,
      is_manual: true,
      status: "approved",
    });
  if (error)
    throw new Error(`P1-23 legacy-sequence cleanup failed: ${error.message}`);
}

export async function getP123LegacyTransition(
  organizationId: string,
  userId: string,
  entryType: "clock_in" | "clock_out",
  timestamp: string,
): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("time_entries")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("entry_type", entryType)
    .eq("timestamp", timestamp)
    .eq("is_manual", true)
    .eq("status", "approved")
    .maybeSingle();
  if (error)
    throw new Error(
      `P1-23 exact legacy transition lookup failed: ${error.message}`,
    );
  return data?.id ?? null;
}

export async function getP123CountsAs(
  user: { email: string; password: string },
  organizationId: string,
) {
  const tableNames = [
    "time_accounts",
    "time_periods",
    "time_period_employee_results",
    "payroll_exports",
  ] as const;
  return withRoleClient(user, async (client) => {
    const counts = await Promise.all(
      tableNames.map(async (tableName) => {
        const { count, error } = await client
          .from(tableName)
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId);
        if (error)
          throw new Error(`P1-23 ${tableName} RLS query failed: ${error.message}`);
        return [tableName, count ?? 0] as const;
      }),
    );
    return Object.fromEntries(counts) as Record<(typeof tableNames)[number], number>;
  });
}

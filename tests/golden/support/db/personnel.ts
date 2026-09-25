import { createHash } from "node:crypto";
import { createAdminClient, withRoleClient } from './shared';

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
  userId: string,
): Promise<EmployeeRecordState> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("employee_records")
    .select("id, user_id, employee_number, entry_date, exit_date")
    .eq("organization_id", orgId)
    .eq("user_id", userId);

  if (error || !data || data.length === 0) {
    throw new Error(
      `No employee record found for user ${userId}: ${error?.message}`,
    );
  }

  const { data: membership } = await admin
    .from("organization_members")
    .select("joined_at")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  const [row] = data;
  if (!row) throw new Error(`No employee record found for user ${userId}`);
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

export type EmployeeRecordEventState = {
  eventType: string;
  eventPayload: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
};

export async function getEmployeeRecordEventStates(
  orgId: string,
  employeeRecordId: string,
): Promise<EmployeeRecordEventState[]> {
  const { data, error } = await createAdminClient()
    .from("employee_record_events")
    .select("event_type, event_payload, created_by, created_at")
    .eq("organization_id", orgId)
    .eq("employee_record_id", employeeRecordId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`Employee record events query failed: ${error.message}`);
  }

  return (data ?? []).map((event) => ({
    eventType: event.event_type as string,
    eventPayload: (event.event_payload ?? {}) as Record<string, unknown>,
    createdBy: (event.created_by as string | null) ?? null,
    createdAt: event.created_at as string,
  }));
}

// P1-04: which work-schedule rows a real signed-in user can see under RLS.
// The UI never shows foreign schedules, so the self-or-manager SELECT policy
// (managers all org rows, a person exactly their own) is proved here.
export async function getVisibleWorkScheduleRecordIdsAs(
  user: { email: string; password: string },
  orgId: string,
): Promise<string[]> {
  return withRoleClient(user, async (client) => {
    const { data, error } = await client
      .from("work_schedules")
      .select("employee_record_id")
      .eq("organization_id", orgId);
    if (error) {
      throw new Error(
        `work_schedules query failed for ${user.email}: ${error.message}`,
      );
    }
    return [
      ...new Set((data ?? []).map((row) => row.employee_record_id as string)),
    ];
  });
}

export type ResponsibilityConfigurationState = {
  id: string;
  mode: string;
  holderEmployeeRecordIds: string[];
};

export async function getLatestResponsibilityConfigurationState(
  orgId: string,
  responsibility: "time_approval" | "leave_approval",
): Promise<ResponsibilityConfigurationState> {
  const admin = createAdminClient();
  const { data: configuration, error } = await admin
    .from("organization_responsibility_configurations")
    .select("id, mode")
    .eq("organization_id", orgId)
    .eq("responsibility", responsibility)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !configuration) {
    throw new Error(`Responsibility configuration missing: ${error?.message}`);
  }

  const { data: assignments, error: assignmentError } = await admin
    .from("organization_responsibility_assignments")
    .select("employee_record_id")
    .eq("configuration_id", configuration.id);
  if (assignmentError) {
    throw new Error(
      `Responsibility assignments query failed: ${assignmentError.message}`,
    );
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
  orgId: string,
): Promise<string[]> {
  return withRoleClient(user, async (client) => {
    const { data, error } = await client
      .from("organization_responsibility_assignments")
      .select("employee_record_id")
      .eq("organization_id", orgId);
    if (error) {
      throw new Error(
        `Responsibility RLS query failed for ${user.email}: ${error.message}`,
      );
    }
    return [
      ...new Set((data ?? []).map((row) => row.employee_record_id as string)),
    ].sort();
  });
}

/**
 * Every employee record of the organization gets one work schedule, so planning
 * for a person no longer raises the "no schedule" warning that needs a reason.
 */
export async function giveEmployeesWorkSchedules(input: {
  organizationId: string;
  actorUserId: string;
  validFrom: string;
  weekdayMinutes: number;
  weekendMinutes: number;
  note: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: employees, error: employeeError } = await admin
    .from("employee_records")
    .select("id")
    .eq("organization_id", input.organizationId);
  if (employeeError || !employees?.length)
    throw new Error(
      `Work schedule setup failed: ${employeeError?.message ?? "no employees"}`,
    );
  const { error } = await admin.from("work_schedules").upsert(
    employees.map((employee) => ({
      organization_id: input.organizationId,
      employee_record_id: employee.id,
      valid_from: input.validFrom,
      monday_minutes: input.weekdayMinutes,
      tuesday_minutes: input.weekdayMinutes,
      wednesday_minutes: input.weekdayMinutes,
      thursday_minutes: input.weekdayMinutes,
      friday_minutes: input.weekdayMinutes,
      saturday_minutes: input.weekendMinutes,
      sunday_minutes: input.weekendMinutes,
      note: input.note,
      created_by: input.actorUserId,
    })),
    { onConflict: "employee_record_id,valid_from" },
  );
  if (error) throw new Error(`Work schedule setup failed: ${error.message}`);
}

export async function prepareP123PersonnelPrerequisites(input: {
  organizationId: string;
  actorUserId: string;
  validFrom: string;
}): Promise<Array<{ id: string; userId: string | null }>> {
  const admin = createAdminClient();
  const { data: employees, error: employeeError } = await admin
    .from("employee_records")
    .select("id, user_id, employee_number")
    .eq("organization_id", input.organizationId)
    .order("id");
  if (employeeError || !employees?.length)
    throw new Error(
      `P1-23 employee setup failed: ${employeeError?.message ?? "no employees"}`,
    );
  const { error: dateError } = await admin
    .from("employee_records")
    .update({ entry_date: input.validFrom })
    .eq("organization_id", input.organizationId);
  if (dateError)
    throw new Error(`P1-23 entry-date setup failed: ${dateError.message}`);
  for (const employee of employees) {
    if (employee.employee_number) continue;
    const { error: numberError } = await admin
      .from("employee_records")
      .update({ employee_number: `P123-${employee.id.slice(0, 8)}` })
      .eq("id", employee.id)
      .eq("organization_id", input.organizationId);
    if (numberError)
      throw new Error(`P1-23 employee-number setup failed: ${numberError.message}`);
  }
  const weekdayMinutes = [480, 420, 360, 240];
  const { error: scheduleError } = await admin.from("work_schedules").upsert(
    employees.map((employee, index) => {
      const dailyMinutes =
        weekdayMinutes[index % weekdayMinutes.length] ?? 480;
      return {
        organization_id: input.organizationId,
        employee_record_id: employee.id,
        valid_from: input.validFrom,
        monday_minutes: dailyMinutes,
        tuesday_minutes: dailyMinutes,
        wednesday_minutes: dailyMinutes,
        thursday_minutes: dailyMinutes,
        friday_minutes: dailyMinutes,
        saturday_minutes: 0,
        sunday_minutes: 0,
        note: "P1-23 acceptance prerequisite",
        created_by: input.actorUserId,
      };
    }),
    { onConflict: "employee_record_id,valid_from" },
  );
  if (scheduleError)
    throw new Error(`P1-23 schedule setup failed: ${scheduleError.message}`);
  return employees.map((employee) => ({
    id: employee.id,
    userId: employee.user_id,
  }));
}

export async function openRemainingP123Accounts(input: {
  organizationId: string;
  actorUserId: string;
  openedOn: string;
}): Promise<void> {
  const admin = createAdminClient();
  const [{ data: employees, error: employeeError }, { data: accounts, error: accountError }] =
    await Promise.all([
      admin.from("employee_records").select("id").eq("organization_id", input.organizationId).order("id"),
      admin.from("time_accounts").select("employee_record_id").eq("organization_id", input.organizationId),
    ]);
  if (employeeError || accountError)
    throw new Error(
      `P1-23 account fixture lookup failed: ${employeeError?.message ?? accountError?.message}`,
    );
  const existing = new Set((accounts ?? []).map((account) => account.employee_record_id));
  for (const employee of employees ?? []) {
    if (existing.has(employee.id)) continue;
    const requestHash = createHash("sha256")
      .update(`${input.organizationId}:${employee.id}:${input.openedOn}`)
      .digest("hex");
    const operationId = `${requestHash.slice(0, 8)}-${requestHash.slice(8, 12)}-${requestHash.slice(12, 16)}-${requestHash.slice(16, 20)}-${requestHash.slice(20, 32)}`;
    const { error } = await admin.rpc("open_time_account", {
      p_organization_id: input.organizationId,
      p_employee_record_id: employee.id,
      p_opening_minutes: 0,
      p_opened_on: input.openedOn,
      p_reason: "P1-23 acceptance opening",
      p_actor_id: input.actorUserId,
      p_operation_id: operationId,
      p_request_hash: requestHash,
    });
    if (error)
      throw new Error(`P1-23 account fixture RPC failed: ${error.message}`);
  }
}

export async function getP124State(organizationId: string) {
  const admin = createAdminClient();
  const [access, accessTransitions, employment, employmentTransitions, plans, requirements,
    protectedDocuments, releases, acknowledgements, operations, events] = await Promise.all([
      admin.from("personnel_access_lifecycles").select("*").eq("organization_id", organizationId).order("created_at"),
      admin.from("personnel_access_transitions").select("*").eq("organization_id", organizationId).order("created_at").order("id"),
      admin.from("personnel_employment_lifecycles").select("*").eq("organization_id", organizationId).order("created_at"),
      admin.from("personnel_employment_transitions").select("*").eq("organization_id", organizationId).order("created_at").order("id"),
      admin.from("personnel_onboarding_plans").select("*").eq("organization_id", organizationId).order("created_at"),
      admin.from("personnel_onboarding_requirements").select("*").eq("organization_id", organizationId).order("created_at").order("id"),
      admin.from("personnel_documents").select("*, documents!inner(display_name)").eq("organization_id", organizationId).order("classified_at").order("id"),
      admin.from("personnel_document_releases").select("*").eq("organization_id", organizationId).order("released_at").order("id"),
      admin.from("personnel_acknowledgements").select("*").eq("organization_id", organizationId).order("acknowledged_at"),
      admin.from("personnel_lifecycle_operations").select("*").eq("organization_id", organizationId).order("created_at"),
      admin.from("employee_record_events").select("*").eq("organization_id", organizationId).order("created_at").order("id"),
    ]);
  const results = [access, accessTransitions, employment, employmentTransitions, plans, requirements,
    protectedDocuments, releases, acknowledgements, operations, events];
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`P1-24 state lookup failed: ${failed.error.message}`);
  return {
    access: access.data ?? [],
    accessTransitions: accessTransitions.data ?? [],
    employment: employment.data ?? [],
    employmentTransitions: employmentTransitions.data ?? [],
    plans: plans.data ?? [],
    requirements: requirements.data ?? [],
    protectedDocuments: protectedDocuments.data ?? [],
    releases: releases.data ?? [],
    acknowledgements: acknowledgements.data ?? [],
    operations: operations.data ?? [],
    events: events.data ?? [],
  };
}

export async function getP124CountsAs(
  user: { email: string; password: string },
  organizationId: string,
) {
  const tables = [
    "personnel_access_lifecycles",
    "personnel_employment_lifecycles",
    "personnel_onboarding_plans",
    "personnel_onboarding_requirements",
    "personnel_documents",
    "personnel_document_releases",
    "personnel_acknowledgements",
  ] as const;
  return withRoleClient(user, async (client) => {
    const entries = await Promise.all(tables.map(async (table) => {
      const { count, error } = await client.from(table)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId);
      if (error) throw new Error(`P1-24 ${table} RLS lookup failed: ${error.message}`);
      if (count === null) throw new Error(`P1-24 ${table} RLS lookup returned no count`);
      return [table, count] as const;
    }));
    return Object.fromEntries(entries) as Record<(typeof tables)[number], number>;
  });
}

export async function getP124NoLoginRecordId(
  organizationId: string,
  lastName: string,
): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("employee_records")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("last_name", lastName)
    .is("user_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`P1-24 no-login personnel lookup failed: ${error.message}`);
  return data?.id ?? null;
}

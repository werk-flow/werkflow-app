import { toWorkSchedule, type WorkSchedule, type WorkScheduleRow } from "../../../../lib/personnel/schedule";
import { toEmploymentCondition, type EmploymentCondition, type EmploymentConditionRow } from "../../../../lib/personnel/types";
import { parseHolidayRegionHistory, type OrganizationHolidayCalendar } from "../../../../lib/personnel/targets";
import { createAdminClient, withRoleClient } from './shared';

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
  employeeRecordId: string,
): Promise<VacationTargetContext> {
  const admin = createAdminClient();
  const [schedulesResult, conditionsResult, settingsResult, closureResult] =
    await Promise.all([
      admin
        .from("work_schedules")
        .select("*")
        .eq("organization_id", orgId)
        .eq("employee_record_id", employeeRecordId),
      admin
        .from("employment_conditions")
        .select("*")
        .eq("organization_id", orgId)
        .eq("employee_record_id", employeeRecordId),
      admin
        .from("organization_settings")
        .select("holiday_region, holiday_region_history")
        .eq("organization_id", orgId)
        .maybeSingle(),
      admin
        .from("organization_closure_days")
        .select("id, closure_date, label")
        .eq("organization_id", orgId),
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
      toWorkSchedule(row as WorkScheduleRow),
    ),
    conditions: (conditionsResult.data ?? []).map((row) =>
      toEmploymentCondition(row as EmploymentConditionRow),
    ),
    calendar: {
      holidayRegion:
        (settingsResult.data?.holiday_region as string | null) ?? null,
      holidayRegionHistory: parseHolidayRegionHistory(
        settingsResult.data?.holiday_region_history,
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
  employeeRecordId: string,
): Promise<VacationRequestState> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vacation_requests")
    .select(
      "id, status, start_date, end_date, day_portion, approved_days_by_year",
    )
    .eq("organization_id", orgId)
    .eq("employee_record_id", employeeRecordId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(
      `No vacation request found for record ${employeeRecordId}: ${error?.message}`,
    );
  }

  const { data: events, error: eventsError } = await admin
    .from("vacation_request_events")
    .select("event_type, created_at")
    .eq("vacation_request_id", data.id)
    .order("created_at", { ascending: true });
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
  orgId: string,
): Promise<string[]> {
  return withRoleClient(user, async (client) => {

    const { data, error } = await client
      .from("vacation_requests")
      .select("employee_record_id")
      .eq("organization_id", orgId);
    if (error) {
      throw new Error(
        `vacation_requests query failed for ${user.email}: ${error.message}`,
      );
    }

    return [
      ...new Set((data ?? []).map((row) => row.employee_record_id as string)),
    ].sort();
  });
}

// P1-07: all vacation requests of one record keyed by start date, so specs can
// address a specific request's id (the attention item identity) even when the
// person has several.
export async function getVacationRequestIdsByStartDate(
  orgId: string,
  employeeRecordId: string,
): Promise<Map<string, { id: string; status: string }>> {
  const { data, error } = await createAdminClient()
    .from("vacation_requests")
    .select("id, status, start_date, created_at")
    .eq("organization_id", orgId)
    .eq("employee_record_id", employeeRecordId)
    .order("created_at", { ascending: true });
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

// P1-08: whether a record has approved vacation intersecting [startIso, ∞) or
// [startIso, endIso] — the mode-independent expectation for the overlap hint.
export async function hasApprovedVacationIntersecting(
  orgId: string,
  employeeRecordId: string,
  startIso: string,
  endIso: string | null,
): Promise<boolean> {
  let query = createAdminClient()
    .from("vacation_requests")
    .select("id")
    .eq("organization_id", orgId)
    .eq("employee_record_id", employeeRecordId)
    .eq("status", "approved")
    .gte("end_date", startIso)
    .limit(1);
  if (endIso !== null) {
    query = query.lte("start_date", endIso);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`Vacation intersection query failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

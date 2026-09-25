import { createAdminClient, withRoleClient } from './shared';

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
  employeeRecordId: string,
): Promise<SicknessReportDbState> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sickness_reports")
    .select(
      "id, status, absence_type, start_date, end_date, day_portion, evidence_required, evidence_status, cancellation_reason",
    )
    .eq("organization_id", orgId)
    .eq("employee_record_id", employeeRecordId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(
      `No sickness report found for record ${employeeRecordId}: ${error?.message}`,
    );
  }

  const { data: events, error: eventsError } = await admin
    .from("sickness_report_events")
    .select("event_type, created_at")
    .eq("sickness_report_id", data.id)
    .order("created_at", { ascending: true });
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
  orgId: string,
): Promise<string[]> {
  return withRoleClient(user, async (client) => {

    const { data, error } = await client
      .from("sickness_reports")
      .select("employee_record_id")
      .eq("organization_id", orgId);
    if (error) {
      throw new Error(
        `sickness_reports query failed for ${user.email}: ${error.message}`,
      );
    }

    return [
      ...new Set((data ?? []).map((row) => row.employee_record_id as string)),
    ].sort();
  });
}

// P1-08: the effective absence spans (approved vacation + active sickness,
// open ends clamped to the window) for one record — the same inputs the app's
// target loaders build, so spec Soll expectations can never drift from the
// product's own arithmetic.
export async function getAbsenceSpansForRecord(
  orgId: string,
  employeeRecordId: string,
  windowStartIso: string,
  windowEndIso: string,
): Promise<
  Array<{
    type: "vacation" | "sickness";
    startDate: string;
    endDate: string;
    dayPortion: "full" | "half_day";
  }>
> {
  const admin = createAdminClient();
  const [vacationResult, sicknessResult] = await Promise.all([
    admin
      .from("vacation_requests")
      .select("start_date, end_date, day_portion")
      .eq("organization_id", orgId)
      .eq("employee_record_id", employeeRecordId)
      .eq("status", "approved")
      .lte("start_date", windowEndIso)
      .gte("end_date", windowStartIso),
    admin
      .from("sickness_reports")
      .select("start_date, end_date, day_portion")
      .eq("organization_id", orgId)
      .eq("employee_record_id", employeeRecordId)
      .eq("status", "reported")
      .lte("start_date", windowEndIso)
      .or(`end_date.gte.${windowStartIso},end_date.is.null`),
  ]);
  if (vacationResult.error || sicknessResult.error) {
    throw new Error(
      `Absence span query failed: ${
        vacationResult.error?.message ?? sicknessResult.error?.message
      }`,
    );
  }

  return [
    ...(vacationResult.data ?? []).map((row) => ({
      type: "vacation" as const,
      startDate: row.start_date as string,
      endDate: row.end_date as string,
      dayPortion: row.day_portion as "full" | "half_day",
    })),
    ...(sicknessResult.data ?? []).map((row) => ({
      type: "sickness" as const,
      startDate: row.start_date as string,
      endDate: (row.end_date as string | null) ?? windowEndIso,
      dayPortion: row.day_portion as "full" | "half_day",
    })),
  ];
}

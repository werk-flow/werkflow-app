import { formatBerlinLocalDate } from "../../../../lib/planning/date-time";
import { createAdminClient, withRoleClient } from './shared';

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
  subject: { jobNumber?: string; internalTitle?: string },
): Promise<PlanningDbState> {
  const admin = createAdminClient();
  if (!subject.jobNumber && !subject.internalTitle) {
    throw new Error("getPlanningState requires jobNumber or internalTitle");
  }
  let jobId: string | null = null;
  if (subject.jobNumber) {
    const { data: job, error } = await admin
      .from("jobs")
      .select("id")
      .eq("organization_id", orgId)
      .eq("job_number", subject.jobNumber)
      .single();
    if (error || !job) {
      throw new Error(`Planning job lookup failed: ${error?.message}`);
    }
    jobId = job.id as string;
  }

  let occurrenceQuery = admin
    .from("planning_occurrences")
    .select(
      "id, series_id, original_start_local, start_at, end_at, start_date, end_date_exclusive, status, is_exception, legacy_source_job_id",
    )
    .eq("organization_id", orgId)
    .order("original_start_local", { ascending: true, nullsFirst: false })
    .limit(1001);
  if (jobId) occurrenceQuery = occurrenceQuery.eq("job_id", jobId);
  if (subject.internalTitle) {
    occurrenceQuery = occurrenceQuery
      .eq("entry_kind", "internal")
      .eq("title", subject.internalTitle);
  }
  const { data: occurrenceRows, error: occurrenceError } =
    await occurrenceQuery;
  if (occurrenceError) {
    throw new Error(
      `Planning occurrence lookup failed: ${occurrenceError?.message}`,
    );
  }
  if ((occurrenceRows?.length ?? 0) > 1000) {
    throw new Error(
      "Planning occurrence lookup exceeded the 1000-row safety limit",
    );
  }

  const occurrenceIds = (occurrenceRows ?? []).map((row) => row.id as string);
  const seriesIds = [
    ...new Set(
      (occurrenceRows ?? []).flatMap((row) =>
        row.series_id ? [row.series_id as string] : [],
      ),
    ),
  ];
  const [
    seriesResult,
    assignmentResult,
    assessmentResult,
    eventResult,
    timeResult,
  ] = await Promise.all([
    seriesIds.length
      ? admin
          .from("planning_series")
          .select("id")
          .eq("organization_id", orgId)
          .in("id", seriesIds)
      : Promise.resolve({ data: [], error: null }),
    occurrenceIds.length
      ? admin
          .from("planning_occurrence_assignments")
          .select("id")
          .eq("organization_id", orgId)
          .in("occurrence_id", occurrenceIds)
          .limit(10_001)
      : Promise.resolve({ data: [], error: null }),
    occurrenceIds.length
      ? admin
          .from("planning_occurrence_assessments")
          .select(
            "id, capacity_snapshot, qualification_snapshot, override_reason",
          )
          .eq("organization_id", orgId)
          .in("occurrence_id", occurrenceIds)
          .limit(10_001)
      : Promise.resolve({ data: [], error: null }),
    occurrenceIds.length
      ? admin
          .from("planning_events")
          .select("event_type")
          .eq("organization_id", orgId)
          .in("occurrence_id", occurrenceIds)
          .order("created_at")
          .limit(10_001)
      : Promise.resolve({ data: [], error: null }),
    jobId
      ? admin
          .from("time_entries")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("job_id", jobId)
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
    throw new Error("Planning related-record lookup exceeded its safety limit");
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
            conflict.kind ? [conflict.kind] : [],
          );
        }),
      ),
    ].sort(),
    qualificationEvaluationCount: (assessmentResult.data ?? []).reduce(
      (count, row) => {
        const snapshot = row.qualification_snapshot as {
          evaluations?: unknown[];
        } | null;
        return count + (snapshot?.evaluations?.length ?? 0);
      },
      0,
    ),
    overrideReasons: (assessmentResult.data ?? []).flatMap((row) =>
      row.override_reason ? [row.override_reason as string] : [],
    ),
    eventTypes: (eventResult.data ?? []).map((row) => row.event_type as string),
    actualTimeCount: timeResult.count ?? 0,
    occurrences: (occurrenceRows ?? []).map((row) => ({
      id: row.id as string,
      seriesId: (row.series_id as string | null) ?? null,
      originalStartLocal: (row.original_start_local as string | null) ?? null,
      startAt: (row.start_at as string | null) ?? null,
      endAt: (row.end_at as string | null) ?? null,
      startDate: (row.start_date as string | null) ?? null,
      endDateExclusive: (row.end_date_exclusive as string | null) ?? null,
      status: row.status as string,
      isException: row.is_exception as boolean,
      legacySourceJobId: (row.legacy_source_job_id as string | null) ?? null,
    })),
  };
}

/** The stored calendar preferences of one member (the `calendar` key), or null before the first save. */
export async function getCalendarPreferencesFor(orgId: string, userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await createAdminClient()
    .from("organization_user_preferences")
    .select("preferences")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Calendar preference read failed: ${error.message}`);
  const stored = (data?.preferences as { calendar?: unknown } | null)?.calendar;
  return stored && typeof stored === "object" ? (stored as Record<string, unknown>) : null;
}

/** The Berlin date an occurrence starts on: the all-day date or the timed instant's local date. */
export function occurrenceLocalDate(occurrence: { startDate: string | null; startAt: string | null } | undefined): string | null {
  if (!occurrence) return null;
  return occurrence.startDate ?? (occurrence.startAt ? formatBerlinLocalDate(occurrence.startAt) : null);
}

export async function getVisiblePlanningStateAs(
  user: { email: string; password: string },
  orgId: string,
): Promise<
  Record<
    | "planning_series"
    | "planning_occurrences"
    | "planning_occurrence_assignments"
    | "planning_occurrence_assessments"
    | "planning_events",
    number
  >
> {
  return withRoleClient(user, async (client) => {
    const tables = [
      "planning_series",
      "planning_occurrences",
      "planning_occurrence_assignments",
      "planning_occurrence_assessments",
      "planning_events",
    ] as const;
    const results = await Promise.all(
      tables.map((table) =>
        client
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId),
      ),
    );
    const error = results.find((result) => result.error)?.error;
    if (error) throw new Error(`Planning RLS lookup failed: ${error.message}`);
    return Object.fromEntries(
      tables.map((table, index) => {
        const result = results[index];
        if (!result) throw new Error(`Planning RLS lookup returned no result for ${table}`);
        return [table, result.count ?? 0];
      }),
    ) as Record<(typeof tables)[number], number>;
  });
}

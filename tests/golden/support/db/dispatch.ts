import { type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, withRoleClient } from './shared';

// ============================================
// P1-12: dispatch, parking context, and customer-commitment lookups.
// Read-only — specs drive every business mutation through the UI.
// ============================================

export type DispatchDbState = {
  dispatches: Array<{
    dispatchId: string;
    status: string;
    targetKind: "occurrence" | "job";
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
  jobNumber: string,
): Promise<string> {
  const { data, error } = await admin
    .from("jobs")
    .select("id")
    .eq("organization_id", orgId)
    .eq("job_number", jobNumber)
    .single();
  if (error || !data) {
    throw new Error(`Job ${jobNumber} not found: ${error?.message}`);
  }
  return data.id as string;
}

export async function getDispatchState(
  orgId: string,
  jobNumber: string,
): Promise<DispatchDbState> {
  const admin = createAdminClient();
  const jobId = await resolveJobIdByNumber(admin, orgId, jobNumber);
  const { data: occurrences, error: occurrenceError } = await admin
    .from("planning_occurrences")
    .select("id")
    .eq("organization_id", orgId)
    .eq("job_id", jobId)
    .limit(501);
  if (occurrenceError || (occurrences?.length ?? 0) > 500) {
    throw new Error(
      `Dispatch occurrence lookup failed: ${occurrenceError?.message ?? "overflow"}`,
    );
  }
  const occurrenceIds = (occurrences ?? []).map((row) => row.id as string);
  let dispatchQuery = admin
    .from("planning_dispatches")
    .select(
      "id, status, occurrence_id, job_id, current_revision_id, created_at",
    )
    .eq("organization_id", orgId);
  dispatchQuery = occurrenceIds.length
    ? dispatchQuery.or(
        `job_id.eq.${jobId},occurrence_id.in.(${occurrenceIds.join(",")})`,
      )
    : dispatchQuery.eq("job_id", jobId);
  const { data: dispatches, error: dispatchError } = await dispatchQuery
    .order("created_at", { ascending: true })
    .limit(101);
  if (dispatchError || (dispatches?.length ?? 0) > 100) {
    throw new Error(
      `Dispatch lookup failed: ${dispatchError?.message ?? "overflow"}`,
    );
  }
  const dispatchIds = (dispatches ?? []).map((row) => row.id as string);
  if (!dispatchIds.length) return { dispatches: [] };

  const [revisionsResult, recipientsResult, acksResult, eventsResult] =
    await Promise.all([
      admin
        .from("planning_dispatch_revisions")
        .select("id, dispatch_id, revision_number, change_kind")
        .eq("organization_id", orgId)
        .in("dispatch_id", dispatchIds)
        .order("revision_number", { ascending: true })
        .limit(1001),
      admin
        .from("planning_dispatch_recipients")
        .select("revision_id, employee_record_id")
        .eq("organization_id", orgId)
        .in("dispatch_id", dispatchIds)
        .limit(5001),
      admin
        .from("planning_dispatch_acknowledgements")
        .select(
          "revision_id, employee_record_id, state, challenge_resolution, created_at",
        )
        .eq("organization_id", orgId)
        .in("dispatch_id", dispatchIds)
        .order("created_at", { ascending: true })
        .limit(5001),
      admin
        .from("planning_dispatch_events")
        .select("dispatch_id, event_type, created_at")
        .eq("organization_id", orgId)
        .in("dispatch_id", dispatchIds)
        .order("created_at", { ascending: true })
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
      `Dispatch detail lookup failed: ${lookupError?.message ?? "overflow"}`,
    );
  }
  const revisionNumberById = new Map(
    (revisionsResult.data ?? []).map((row) => [row.id, row.revision_number]),
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
        (row) => row.dispatch_id === dispatch.id,
      );
      return {
        dispatchId: dispatch.id,
        status: dispatch.status,
        targetKind: dispatch.occurrence_id ? "occurrence" : "job",
        currentRevisionNumber:
          dispatch.current_revision_id
            ? (revisionNumberById.get(dispatch.current_revision_id) ?? null)
          : null,
        revisionChangeKinds: revisions.map((row) => row.change_kind as string),
        currentRecipientRecordIds: (recipientsResult.data ?? [])
          .filter((row) => row.revision_id === dispatch.current_revision_id)
          .map((row) => row.employee_record_id as string),
        acknowledgements: (acksResult.data ?? [])
          .filter((row) =>
            revisions.some((revision) => revision.id === row.revision_id),
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
  jobNumber: string,
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
      .from("work_blockers")
      .select(
        "id, reason, details, responsible_employee_record_id, next_review_date",
      )
      .eq("organization_id", orgId)
      .eq("job_id", jobId)
      .eq("kind", "parking")
      .eq("state", "open")
      .maybeSingle(),
    admin
      .from("work_blocker_events")
      .select("event_type, created_at, work_blockers!inner(job_id)")
      .eq("organization_id", orgId)
      .eq("work_blockers.job_id", jobId)
      .eq("work_blockers.kind", "parking")
      .order("created_at", { ascending: true })
      .limit(501),
  ]);
  if (
    contextResult.error ||
    eventsResult.error ||
    (eventsResult.data?.length ?? 0) > 500
  ) {
    throw new Error(
      `Parking lookup failed: ${(contextResult.error ?? eventsResult.error)?.message ?? "overflow"}`,
    );
  }
  return {
    context: contextResult.data
      ? {
          reason:
            contextResult.data.reason === "material"
              ? "warten_auf_material"
              : (contextResult.data.reason as string),
          note: contextResult.data.details as string | null,
          responsibleEmployeeRecordId: contextResult.data
            .responsible_employee_record_id as string | null,
          nextReviewDate: contextResult.data.next_review_date as string | null,
        }
      : null,
    eventTypes: (eventsResult.data ?? []).map((row) =>
      row.event_type === "parked" ? "context_set" : (row.event_type as string),
    ),
  };
}

export async function getCommitmentState(
  orgId: string,
  jobNumber: string,
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
    .from("planning_occurrences")
    .select("id")
    .eq("organization_id", orgId)
    .eq("job_id", jobId)
    .limit(501);
  if (occurrenceError || (occurrences?.length ?? 0) > 500) {
    throw new Error(
      `Commitment occurrence lookup failed: ${occurrenceError?.message ?? "overflow"}`,
    );
  }
  const occurrenceIds = (occurrences ?? []).map((row) => row.id as string);
  if (!occurrenceIds.length) return [];
  const { data, error } = await admin
    .from("planning_customer_commitments")
    .select("status, committed_date, supersedes_id, recorded_at")
    .eq("organization_id", orgId)
    .in("occurrence_id", occurrenceIds)
    .order("recorded_at", { ascending: true })
    .limit(501);
  if (error || (data?.length ?? 0) > 500) {
    throw new Error(
      `Commitment lookup failed: ${error?.message ?? "overflow"}`,
    );
  }
  return (data ?? []).map((row) => ({
    status: row.status as string,
    committedDate: row.committed_date as string,
    supersedesId: row.supersedes_id as string | null,
  }));
}

export async function getVisibleDispatchStateAs(
  user: { email: string; password: string },
  orgId: string,
): Promise<
  Record<
    | "planning_dispatches"
    | "planning_dispatch_revisions"
    | "planning_dispatch_recipients"
    | "planning_dispatch_acknowledgements"
    | "planning_dispatch_events"
    | "work_blockers"
    | "planning_customer_commitments",
    number
  >
> {
  return withRoleClient(user, async (client) => {
    const tables = [
      "planning_dispatches",
      "planning_dispatch_revisions",
      "planning_dispatch_recipients",
      "planning_dispatch_acknowledgements",
      "planning_dispatch_events",
      "work_blockers",
      "planning_customer_commitments",
    ] as const;
    // Sequential on purpose: a parallel burst of head-count requests right
    // after three sign-ins intermittently dropped a connection in suite runs.
    const counts: number[] = [];
    for (const table of tables) {
      const { count, error } = await client
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId);
      if (error) {
        throw new Error(
          `Dispatch RLS lookup failed for ${table}: ${error.message || error.code || JSON.stringify(error)}`,
        );
      }
      counts.push(count ?? 0);
    }
    return Object.fromEntries(
      tables.map((table, index) => [table, counts[index]]),
    ) as Record<(typeof tables)[number], number>;
  });
}

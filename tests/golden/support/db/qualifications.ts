import { MissingTestFixtureError, createAdminClient, withRoleClient } from './shared';

// P1-09: real-credential visibility across the qualification domain. The
// employee may see only their own membership/capability rows and the matching
// vocabulary/team labels; managers see the organization; outsiders see none.
export async function getVisibleQualificationStateAs(
  user: { email: string; password: string },
  orgId: string,
): Promise<{
  teamEmployeeRecordIds: string[];
  capabilityEmployeeRecordIds: string[];
  evidenceStates: string[];
  requirementCount: number;
  assessmentCount: number;
}> {
  return withRoleClient(user, async (client) => {

    const [memberships, capabilities, requirements, assessments] =
      await Promise.all([
        client
          .from("team_memberships")
          .select("employee_record_id")
          .eq("organization_id", orgId),
        client
          .from("employee_capabilities")
          .select("employee_record_id, evidence_state")
          .eq("organization_id", orgId),
        client
          .from("job_capability_requirements")
          .select("id")
          .eq("organization_id", orgId),
        client
          .from("job_qualification_assessments")
          .select("id")
          .eq("organization_id", orgId),
      ]);
    const firstError =
      memberships.error ??
      capabilities.error ??
      requirements.error ??
      assessments.error;
    if (firstError) {
      throw new Error(
        `Qualification RLS query failed for ${user.email}: ${firstError.message}`,
      );
    }

    return {
      teamEmployeeRecordIds: [
        ...new Set(
          (memberships.data ?? []).map((row) => row.employee_record_id as string),
        ),
      ].sort(),
      capabilityEmployeeRecordIds: [
        ...new Set(
          (capabilities.data ?? []).map(
            (row) => row.employee_record_id as string,
          ),
        ),
      ].sort(),
      evidenceStates: (capabilities.data ?? [])
        .map((row) => row.evidence_state as string)
        .sort(),
      requirementCount: requirements.data?.length ?? 0,
      assessmentCount: assessments.data?.length ?? 0,
    };
  });
}

export async function getCapabilityHistoryState(
  orgId: string,
  employeeRecordId: string,
  capabilityName: string,
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
    .from("organization_capabilities")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", capabilityName)
    .single();
  if (definitionError || !definition) {
    throw new Error(
      `Capability ${capabilityName} missing: ${definitionError?.message}`,
    );
  }
  const [rowsResult, eventsResult] = await Promise.all([
    admin
      .from("employee_capabilities")
      .select(
        "id, valid_from, valid_until, supersedes_id, superseded_at, evidence_state, confirmation_status, created_at",
      )
      .eq("organization_id", orgId)
      .eq("employee_record_id", employeeRecordId)
      .eq("capability_id", definition.id)
      .order("created_at", { ascending: true }),
    admin
      .from("employee_record_events")
      .select("event_type, created_at")
      .eq("organization_id", orgId)
      .eq("employee_record_id", employeeRecordId)
      .in("event_type", [
        "qualification_added",
        "qualification_corrected",
        "qualification_renewed",
      ])
      .order("created_at", { ascending: true }),
  ]);
  if (rowsResult.error || eventsResult.error) {
    throw new Error(
      `Capability history query failed: ${
        rowsResult.error?.message ?? eventsResult.error?.message
      }`,
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
      (event) => event.event_type as string,
    ),
  };
}

export type JobQualificationState = {
  jobId: string;
  requirementCount: number;
  assessments: Array<{
    overrideReason: string | null;
    teamSourceId: string | null;
    fingerprint: string;
  }>;
};

export async function getJobQualificationState(
  orgId: string,
  jobNumber: string,
): Promise<JobQualificationState> {
  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("id")
    .eq("organization_id", orgId)
    .eq("job_number", jobNumber)
    .maybeSingle();
  if (jobError) {
    throw new Error(`Job ${jobNumber} lookup failed: ${jobError.message}`);
  }
  if (!job) {
    throw new MissingTestFixtureError(`Job ${jobNumber} missing`);
  }
  const [requirements, assessments] = await Promise.all([
    admin
      .from("job_capability_requirements")
      .select("id")
      .eq("organization_id", orgId)
      .eq("job_id", job.id),
    admin
      .from("job_qualification_assessments")
      .select(
        "override_reason, team_source_id, coverage_fingerprint, created_at",
      )
      .eq("organization_id", orgId)
      .eq("job_id", job.id)
      .order("created_at", { ascending: true }),
  ]);
  if (requirements.error || assessments.error) {
    throw new Error(
      `Job qualification query failed: ${
        requirements.error?.message ?? assessments.error?.message
      }`,
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

export async function findJobQualificationState(
  orgId: string,
  jobNumber: string,
): Promise<JobQualificationState | null> {
  try {
    return await getJobQualificationState(orgId, jobNumber);
  } catch (error) {
    if (error instanceof MissingTestFixtureError) return null;
    throw error;
  }
}

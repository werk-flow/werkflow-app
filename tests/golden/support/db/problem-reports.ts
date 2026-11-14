import { TEST_SUPPORT_USER, type TestSupportUser } from '../../../../lib/testing/support-user';
import { createAdminClient, persisted, type Persisted } from './shared';

// Problem reports read back for the report journeys, and the seeds of
// support's screens (docs/features/problem-reports.md).

export type PersistedProblemReport = Persisted<{
  number: number;
  reporterId: string;
  status: string;
  description: string | null;
  scrubState: string;
  scrubbedDescription: string | null;
  fileKinds: string[];
}>;

/** The report a person just sent, by its organization and test-specific description, with the kinds of its files. */
export async function getProblemReportByDescription(
  orgId: string,
  description: string,
): Promise<PersistedProblemReport> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('problem_reports')
    .select('id, number, reporter_id, status, description, scrub_state, scrubbed_description')
    .eq('organization_id', orgId)
    .eq('description', description)
    .single();
  if (error) throw new Error(`Problem report lookup failed: ${error.message}`);
  const files = await admin
    .from('problem_report_files')
    .select('kind')
    .eq('organization_id', orgId)
    .eq('report_id', data.id);
  if (files.error) throw new Error(`Problem report file lookup failed: ${files.error.message}`);
  return persisted({
    number: data.number,
    reporterId: data.reporter_id,
    status: data.status,
    description: data.description,
    scrubState: data.scrub_state,
    scrubbedDescription: data.scrubbed_description,
    fileKinds: files.data.map((file) => file.kind).sort(),
  });
}

/**
 * A synthetic support user of the local stack, created on first use with its
 * fixed id, and the token of a one-time sign-in link for it.
 */
export async function ensureSupportUserLink(user: TestSupportUser = TEST_SUPPORT_USER): Promise<string> {
  const admin = createAdminClient();
  const existing = await admin.auth.admin.getUserById(user.id);
  if (!existing.data.user) {
    const created = await admin.auth.admin.createUser({
      id: user.id,
      email: user.email,
      email_confirm: true,
      user_metadata: { first_name: user.firstName, last_name: user.lastName },
    });
    // Another worker may have created it between the read and the write.
    if (created.error && !(await admin.auth.admin.getUserById(user.id)).data.user)
      throw new Error(`Support user setup failed: ${created.error.message}`);
  }
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  const token = link.data.properties?.hashed_token;
  if (link.error || !token)
    throw new Error(`Support sign-in link failed: ${link.error?.message ?? 'no token'}`);
  return token;
}

/**
 * A stored report as a member's device leaves it: its scrubbed copy pending.
 * Seeds once per organization and description: a second call finds the first report.
 */
export async function seedProblemReport(input: {
  orgId: string;
  reporterId: string;
  description: string;
  createdAt: string;
}): Promise<string> {
  const admin = createAdminClient();
  const existing = await admin
    .from('problem_reports')
    .select('id')
    .eq('organization_id', input.orgId)
    .eq('description', input.description)
    .maybeSingle()
    .throwOnError();
  if (existing.data) return existing.data.id;
  const { data } = await admin
    .from('problem_reports')
    .insert({
      organization_id: input.orgId,
      reporter_id: input.reporterId,
      filed_by_id: input.reporterId,
      description: input.description,
      context: {},
      created_at: input.createdAt,
    })
    .select('id')
    .single()
    .throwOnError();
  return data.id;
}

/**
 * A report support already works on: a bug in progress, assigned to the
 * synthetic support user, through the product's own triage function, so its
 * history is the real one. A second call changes nothing.
 */
export async function seedTriagedProblemReport(input: {
  orgId: string;
  reporterId: string;
  description: string;
  createdAt: string;
}): Promise<string> {
  const reportId = await seedProblemReport(input);
  const admin = createAdminClient();
  // The triage names what it is based on: the report as it is now.
  const { data: current } = await admin
    .from('problem_reports')
    .select('status, bucket, assignee_id')
    .eq('organization_id', input.orgId)
    .eq('id', reportId)
    .single()
    .throwOnError();
  await admin
    .rpc('triage_problem_report', {
      p_organization_id: input.orgId,
      p_report_id: reportId,
      p_actor_id: TEST_SUPPORT_USER.id,
      p_changes: { status: 'in_bearbeitung', bucket: 'fehler', assignee_id: TEST_SUPPORT_USER.id },
      p_expected: current,
      p_support_ids: [],
    })
    .throwOnError();
  return reportId;
}

export type PersistedTriage = Persisted<{
  status: string;
  bucket: string | null;
  assigneeId: string | null;
  response: string | null;
  /** The history's entries, oldest first, each as `<type> by <actor id>`. */
  history: string[];
}>;

/** A report's triage fields and history, read back after support saved or opened something. */
export async function getProblemReportTriage(orgId: string, reportId: string): Promise<PersistedTriage> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('problem_reports')
    .select('status, bucket, assignee_id, response')
    .eq('organization_id', orgId)
    .eq('id', reportId)
    .single()
    .throwOnError();
  const events = await admin
    .from('problem_report_events')
    .select('event_type, actor_id')
    .eq('organization_id', orgId)
    .eq('report_id', reportId)
    .order('created_at')
    .order('id')
    .throwOnError();
  return persisted({
    status: data.status,
    bucket: data.bucket,
    assigneeId: data.assignee_id,
    response: data.response,
    history: events.data.map((event) => `${event.event_type} by ${event.actor_id}`),
  });
}

export type PersistedCallerReport = Persisted<{
  id: string;
  number: number;
  reporterId: string;
  filedById: string | null;
}>;

/** The report support filed for a caller, by its organization and test-specific description. */
export async function getCallerReportByDescription(
  orgId: string,
  description: string,
): Promise<PersistedCallerReport> {
  const { data } = await createAdminClient()
    .from('problem_reports')
    .select('id, number, reporter_id, filed_by_id')
    .eq('organization_id', orgId)
    .eq('description', description)
    .single()
    .throwOnError();
  return persisted({
    id: data.id,
    number: data.number,
    reporterId: data.reporter_id,
    filedById: data.filed_by_id,
  });
}

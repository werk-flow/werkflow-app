import { createAdminClient } from './shared';

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
  requestNumber: string,
): Promise<RequestConversionState> {
  const { data, error } = await createAdminClient()
    .from("client_requests")
    .select(
      "status, converted_job_id, converted_project_id, converted_at, converted_by",
    )
    .eq("organization_id", orgId)
    .eq("request_number", requestNumber)
    .single();

  if (error || !data) {
    throw new Error(
      `No request found with number ${requestNumber}: ${error?.message}`,
    );
  }

  return {
    status: data.status as string,
    convertedJobId: (data.converted_job_id as string | null) ?? null,
    convertedProjectId: (data.converted_project_id as string | null) ?? null,
    convertedAt: (data.converted_at as string | null) ?? null,
    convertedBy: (data.converted_by as string | null) ?? null,
  };
}

export async function getRequestAuditState(
  orgId: string,
  requestNumber: string,
): Promise<{
  id: string;
  status: string;
  clientId: string | null;
  contactId: string | null;
  siteId: string | null;
  callerName: string | null;
  callerPhone: string | null;
  callerEmail: string | null;
  callerAddress: string | null;
  details: string | null;
  category: string;
  urgency: string;
  source: string;
  assignedTo: string | null;
  receivedAt: string;
  convertedProjectId: string | null;
  eventTypes: string[];
  eventActorIds: Array<string | null>;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("client_requests")
    .select(
      "id,status,client_id,contact_id,site_id,caller_name,caller_phone,caller_email,caller_address,details,category,urgency,source,assigned_to,received_at,converted_project_id",
    )
    .eq("organization_id", orgId)
    .eq("request_number", requestNumber)
    .single();
  if (error || !data) {
    throw new Error(
      `No request found with number ${requestNumber}: ${error?.message}`,
    );
  }
  const { data: events, error: eventsError } = await admin
    .from("client_request_events")
    .select("event_type,created_by,created_at")
    .eq("organization_id", orgId)
    .eq("request_id", data.id)
    .order("created_at", { ascending: true });
  if (eventsError) {
    throw new Error(`Request events could not be read: ${eventsError.message}`);
  }
  return {
    id: data.id as string,
    status: data.status as string,
    clientId: (data.client_id as string | null) ?? null,
    contactId: (data.contact_id as string | null) ?? null,
    siteId: (data.site_id as string | null) ?? null,
    callerName: (data.caller_name as string | null) ?? null,
    callerPhone: (data.caller_phone as string | null) ?? null,
    callerEmail: (data.caller_email as string | null) ?? null,
    callerAddress: (data.caller_address as string | null) ?? null,
    details: (data.details as string | null) ?? null,
    category: data.category as string,
    urgency: data.urgency as string,
    source: data.source as string,
    assignedTo: (data.assigned_to as string | null) ?? null,
    receivedAt: data.received_at as string,
    convertedProjectId: (data.converted_project_id as string | null) ?? null,
    eventTypes: (events ?? []).map((event) => event.event_type as string),
    eventActorIds: (events ?? []).map(
      (event) => (event.created_by as string | null) ?? null,
    ),
  };
}

export async function getConvertedRequestJobState(
  orgId: string,
  requestNumber: string,
): Promise<{
  jobNumber: string | null;
  title: string;
  description: string | null;
  clientId: string | null;
  contactId: string | null;
  siteId: string | null;
  priority: string;
  status: string;
  plannedDate: string | null;
  planningCount: number;
  dispatchCount: number;
}> {
  const admin = createAdminClient();
  const { data: request, error: requestError } = await admin
    .from("client_requests")
    .select("converted_job_id")
    .eq("organization_id", orgId)
    .eq("request_number", requestNumber)
    .single();
  if (requestError || !request?.converted_job_id) {
    throw new Error(
      `Converted job missing for ${requestNumber}: ${requestError?.message}`,
    );
  }
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select(
      "job_number,title,description,client_id,contact_id,site_id,priority,status,planned_date",
    )
    .eq("organization_id", orgId)
    .eq("id", request.converted_job_id)
    .single();
  if (jobError || !job) {
    throw new Error(`Converted job could not be read: ${jobError?.message}`);
  }
  const [planningResult, dispatchResult] = await Promise.all([
    admin
      .from("planning_occurrences")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("job_id", request.converted_job_id),
    admin
      .from("planning_dispatches")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("job_id", request.converted_job_id),
  ]);
  const countError = planningResult.error ?? dispatchResult.error;
  if (countError) {
    throw new Error(
      `Converted job side effects could not be read: ${countError.message}`,
    );
  }
  return {
    jobNumber: (job.job_number as string | null) ?? null,
    title: job.title as string,
    description: (job.description as string | null) ?? null,
    clientId: (job.client_id as string | null) ?? null,
    contactId: (job.contact_id as string | null) ?? null,
    siteId: (job.site_id as string | null) ?? null,
    priority: job.priority as string,
    status: job.status as string,
    plannedDate: (job.planned_date as string | null) ?? null,
    planningCount: planningResult.count ?? 0,
    dispatchCount: dispatchResult.count ?? 0,
  };
}

// P1-07: how many client requests are currently open (offen/in_klaerung) —
// the mode-independent input for unified-badge expectations.
export async function countOpenClientRequests(orgId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("client_requests")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .in("status", ["offen", "in_klaerung"]);
  if (error) {
    throw new Error(`Open request count failed: ${error.message}`);
  }
  return count ?? 0;
}

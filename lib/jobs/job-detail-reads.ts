import 'server-only';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { toClientContact, toClientSite } from '@/lib/clients/relation-rows';
import type { ClientContact, ClientSite } from '@/lib/clients/types';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { formatBerlinLocalDate, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { formatEmployeeRecordName } from '@/lib/personnel/types';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import {
  JOB_BILLING_PARTIES_EMBED,
  SITE_CONTACTS_EMBED,
  jobBillingPartiesFrom,
} from '@/lib/billing-parties/server';
import type { WorkBillingParties } from '@/lib/billing-parties/types';
import type { ActionContext } from '@/lib/org/action-context';
import { JOB_WORK_LEADS_EMBED, type WorkLeadHoldingRow } from '@/lib/projects/work-lead-types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { projectFieldJobDetails } from './field-work-pack';
import {
  toClient,
  toJob,
  toJobAssignment,
  type Client,
  type JobAssignmentRow,
  type JobAssignmentWithProfile,
  type JobRow,
  type JobWithDetails,
} from './types';
import {
  JOB_FORM_VISIT_LIMIT,
  jobFormEditsSchedule,
  namesJobSchedule,
  type JobVisit,
  type JobVisitPlan,
} from './visit-schedule';

// Site/contact context and the scheduled visit count for the job detail
// surfaces (office and assigned field workers alike). Null when a read
// failed: a missing site or contact would look like none, and a missing count
// would offer a schedule edit the job action refuses.
async function loadJobDetailRelations(
  admin: AdminClient,
  orgId: string,
  job: { id: string; site_id: string | null; contact_id: string | null },
): Promise<{
  site: ClientSite | null;
  contact: ClientContact | null;
  scheduledVisitCount: number;
  /** The site's contacts for the office's billing section; never part of the job. */
  siteContacts: unknown;
} | null> {
  const siteId = job.site_id;
  const contactId = job.contact_id;
  const [siteResult, contactResult, visitCountResult] = await Promise.all([
    siteId
      ? admin
          .from('client_sites')
          .select(`*, ${SITE_CONTACTS_EMBED}`)
          .eq('organization_id', orgId)
          .eq('id', siteId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contactId
      ? admin
          .from('client_contacts')
          .select('*')
          .eq('organization_id', orgId)
          .eq('id', contactId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    countScheduledVisits(admin, orgId, job.id),
  ]);
  const error = siteResult.error ?? contactResult.error ?? visitCountResult.error;
  if (error) {
    logReadFailure('loadJobDetailRelations: site, contact or visit count failed', error);
    return null;
  }

  return {
    site: siteResult.data ? toClientSite(siteResult.data) : null,
    contact: contactResult.data ? toClientContact(contactResult.data) : null,
    scheduledVisitCount: visitCountResult.count ?? 0,
    siteContacts: siteResult.data?.site_contacts ?? [],
  };
}

const VISIT_SELECT =
  'id, start_at, end_at, start_date, people:planning_occurrence_assignments(employee_records(first_name, last_name))';

/**
 * The job's assignees with their names, for the detail readers. A missing name
 * would show the assignee as "Mitarbeiter", so a failed read returns null.
 */
async function readJobAssigneeProfiles(
  admin: AdminClient,
  assignmentRows: JobAssignmentRow[],
  operation: string,
): Promise<JobAssignmentWithProfile[] | null> {
  const assignments: JobAssignmentWithProfile[] = [];
  if (assignmentRows.length > 0) {
    const userIds = assignmentRows.map((a) => a.user_id);
    const { data: profiles, error: profilesError } = await readInBatches(userIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email, avatar_path')
        .in('id', [...batch]),
    );
    if (profilesError) {
      logReadFailure(`${operation}: assignee profiles failed`, profilesError);
      return null;
    }

    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    for (const row of assignmentRows) {
      const profile = profileMap.get(row.user_id);
      assignments.push({
        ...toJobAssignment(row),
        firstName: profile?.first_name ?? null,
        lastName: profile?.last_name ?? null,
        email: profile?.email ?? null,
        avatarPath: profile?.avatar_path ?? null,
      });
    }
  }
  return assignments;
}

function countScheduledVisits(admin: AdminClient, orgId: string, jobId: string) {
  return admin
    .from('planning_occurrences')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('job_id', jobId)
    .eq('status', 'scheduled');
}

/**
 * The job's scheduled visits for the job form: their number, and the first
 * upcoming ones with their people. A timed visit starts at an instant, an
 * all-day visit on a date, so each kind is read in start order and the two
 * are merged. Null when a read failed.
 */
export async function readJobVisitPlan(
  admin: AdminClient,
  orgId: string,
  jobId: string,
): Promise<JobVisitPlan | null> {
  const scheduledVisits = () =>
    admin
      .from('planning_occurrences')
      .select(VISIT_SELECT, { count: 'exact' })
      .eq('organization_id', orgId)
      .eq('job_id', jobId)
      .eq('status', 'scheduled');
  const [totalResult, timedResult, allDayResult] = await Promise.all([
    countScheduledVisits(admin, orgId, jobId),
    scheduledVisits()
      .gte('start_at', new Date().toISOString())
      .order('start_at')
      .order('id')
      .limit(JOB_FORM_VISIT_LIMIT),
    scheduledVisits()
      .gte('start_date', getBusinessTodayIso())
      .order('start_date')
      .order('id')
      .limit(JOB_FORM_VISIT_LIMIT),
  ]);
  const error = totalResult.error ?? timedResult.error ?? allDayResult.error;
  if (error || !timedResult.data || !allDayResult.data) {
    logReadFailure('readJobVisitPlan: visits failed', { code: error?.code ?? 'no_rows' });
    return null;
  }
  const upcoming = [...timedResult.data, ...allDayResult.data]
    .flatMap((row): JobVisit[] => {
      const date = row.start_at ? formatBerlinLocalDate(row.start_at) : row.start_date;
      if (!date) return [];
      const people = row.people.map(({ employee_records: record }) =>
        formatEmployeeRecordName({ firstName: record.first_name, lastName: record.last_name }),
      );
      return [{ id: row.id, date, startAt: row.start_at, endAt: row.end_at, people }];
    })
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) || (left.startAt ?? '').localeCompare(right.startAt ?? ''),
    )
    .slice(0, JOB_FORM_VISIT_LIMIT);
  return {
    total: totalResult.count ?? 0,
    upcomingTotal: (timedResult.count ?? 0) + (allDayResult.count ?? 0),
    upcoming,
  };
}

/**
 * Refuses a schedule edit of a job with several scheduled visits: the job's
 * schedule columns move only its legacy visit, so such a job is planned on
 * the Plantafel. Null when the edit may go ahead.
 */
export async function refuseScheduleOfSeveralVisits(input: {
  admin: AdminClient;
  orgId: string;
  jobId: string;
  changes: Parameters<typeof namesJobSchedule>[0];
}): Promise<ActionFailure<'job_has_several_visits' | 'load_failed'> | null> {
  if (!namesJobSchedule(input.changes)) return null;
  const { count, error } = await countScheduledVisits(input.admin, input.orgId, input.jobId);
  if (error) {
    logReadFailure('refuseScheduleOfSeveralVisits: visit count failed', { code: error.code });
    return { success: false, error: 'load_failed' };
  }
  return jobFormEditsSchedule(count ?? 0) ? null : { success: false, error: 'job_has_several_visits' };
}

/** The job's customer, null without one; undefined when the read failed. */
async function readJobClient(
  admin: AdminClient,
  orgId: string,
  clientId: string | null,
  operation: string,
): Promise<Client | null | undefined> {
  if (!clientId) return null;
  const { data, error } = await admin
    .from('clients')
    .select('*')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  if (error) {
    logReadFailure(`${operation}: client failed`, error);
    return undefined;
  }
  return data ? toClient(data) : null;
}

/**
 * The shared tail of the job detail readers: an employee reads only a job they
 * are assigned to; the job comes back with its assignees, customer, project,
 * site and contact, for an employee in the field projection.
 */
export async function readJobDetails(input: {
  admin: AdminClient;
  context: { userId: string; orgId: string; isManagerOrAbove: boolean };
  jobData: JobRow;
  /** The versions the job read embedded; undefined when it embedded none. */
  billingParties?: unknown;
  operation: string;
}): Promise<ActionResult<{ job: JobWithDetails; billingParties?: WorkBillingParties | undefined }>> {
  const { admin, jobData } = input;
  const { userId, orgId, isManagerOrAbove } = input.context;

  const [assignmentRowsResult, projectResult] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('job_assignments')
          .select('*')
          .eq('organization_id', orgId)
          .eq('job_id', jobData.id)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    jobData.project_id
      ? admin
          .from('projects')
          .select('id, name, project_number, client_id')
          .eq('organization_id', orgId)
          .eq('id', jobData.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  // A missing assignee list or missing names would show the job as unassigned or
  // every assignee as "Mitarbeiter", so either read failure fails the detail read.
  if (assignmentRowsResult.error) {
    logReadFailure(`${input.operation}: job_assignments failed`, { code: assignmentRowsResult.error.code });
    return { success: false, error: 'fetch_failed' };
  }
  // The team read alone decides an employee's access, so an assignment removed
  // between two reads can never let the job through.
  if (!isManagerOrAbove && !assignmentRowsResult.data.some((row) => row.user_id === userId)) {
    return { success: false, error: 'not_authorized' };
  }
  if (projectResult.error) {
    logReadFailure(`${input.operation}: project failed`, projectResult.error);
    return { success: false, error: 'fetch_failed' };
  }
  const assignments = await readJobAssigneeProfiles(admin, assignmentRowsResult.data, input.operation);
  if (!assignments) return { success: false, error: 'fetch_failed' };

  const { data: projectData } = projectResult;
  const effectiveClientId = projectData ? projectData.client_id : jobData.client_id;
  const client = await readJobClient(admin, orgId, effectiveClientId, input.operation);
  if (client === undefined) return { success: false, error: 'fetch_failed' };
  const project = projectData
    ? {
        id: projectData.id,
        name: projectData.name,
        projectNumber: projectData.project_number,
      }
    : null;

  const loadedRelations = await loadJobDetailRelations(admin, orgId, jobData);
  if (!loadedRelations) return { success: false, error: 'fetch_failed' };
  const { siteContacts, ...relations } = loadedRelations;

  const job: JobWithDetails = {
    ...toJob({ ...jobData, client_id: effectiveClientId }),
    assignments,
    client,
    project,
    ...relations,
  };

  if (!isManagerOrAbove) return { success: true, job: projectFieldJobDetails(job) };
  // The office's billing parties ride on the reads above; a field worker never receives them.
  return {
    success: true,
    job,
    billingParties: officeBillingParties(input.billingParties, jobData.client_id, client, siteContacts),
  };
}

/**
 * The job read's embedded billing parties for the office, without the site the
 * job already carries; undefined when it embedded none or a malformed set. The
 * parties belong to the job's own customer (jobs.client_id), which the
 * defaults follow; a party is left out only where the read's customer is that
 * same customer, so a project read with another customer never stands in.
 */
function officeBillingParties(
  embedded: unknown,
  jobClientId: string | null,
  client: Client | null,
  siteContacts: unknown,
): WorkBillingParties | undefined {
  if (embedded === undefined) return undefined;
  const workClient =
    client && client.id === jobClientId
      ? { id: client.id, name: client.name, address: client.address }
      : null;
  return (
    jobBillingPartiesFrom({
      hasClient: jobClientId !== null,
      workClient,
      versions: embedded,
      siteContacts,
    }) ?? undefined
  );
}

/** A job read by its number: the office's read carries its billing parties and lead holdings. */
export type JobByNumber = {
  job: JobWithDetails;
  billingParties?: WorkBillingParties | undefined;
  /** The office's alone: the job's own lead holdings, newest first. */
  workLeads?: WorkLeadHoldingRow[];
};

/**
 * The job detail page's reader (`/auftraege/[jobNumber]`), and WerkFlow KI's
 * `auftrag_lesen`: the job of the caller's organization with this number, as
 * `readJobDetails` gives it to the caller's role.
 */
export async function readJobByNumber(
  context: Pick<ActionContext, 'userId' | 'orgId' | 'isManagerOrAbove'>,
  jobNumber: string,
  operation: string,
): Promise<ActionResult<JobByNumber>> {
  const admin = createSupabaseAdminClient();
  const { data: jobRow, error: jobError } = await admin
    .from('jobs')
    .select(`*, ${JOB_BILLING_PARTIES_EMBED}, ${JOB_WORK_LEADS_EMBED}`)
    .eq('organization_id', context.orgId)
    .eq('job_number', jobNumber)
    // Newest first, so the current version leads whatever cuts the list.
    .order('version', { referencedTable: 'work_billing_parties', ascending: false })
    .order('started_at', { referencedTable: 'work_leads', ascending: false })
    .order('id', { referencedTable: 'work_leads' })
    .maybeSingle();

  // A failed read is a failure the page shows with a retry, never an absent job.
  if (jobError) {
    logReadFailure(`${operation}: read failed`, { code: jobError.code });
    return { success: false, error: 'fetch_failed' };
  }
  if (!jobRow) return { success: false, error: 'job_not_found' };
  const { work_billing_parties: billingParties, work_leads: workLeads, ...jobData } = jobRow;

  const details = await readJobDetails({ admin, context, jobData, billingParties, operation });
  // The lead holdings ride on the job read for the office's page; a field worker never receives them.
  return details.success && context.isManagerOrAbove ? { ...details, workLeads } : details;
}

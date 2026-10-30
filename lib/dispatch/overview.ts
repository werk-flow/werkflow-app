import 'server-only';

// The Einsätze overview of a date window: its scheduled visits with their
// dispatches, commitments, customers and travel notes, and the unscheduled
// job dispatches. An internal server reader: its caller in ./actions
// authorizes first.

import { formatBerlinLocalDateTime } from '@/lib/date-time/berlin';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { isCommitmentMismatch, type CustomerCommitment } from '@/lib/commitments/types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { deriveTravelNotes, type TravelVisitFact } from './derivation';
import {
  dispatchReadFailed,
  loadDispatchViews,
  loadEmployeeNameFacts,
  type DispatchRow,
  type EmployeeNameFacts,
} from './server';
import type {
  DispatchCommitmentSummary,
  DispatchOverview,
  DispatchOverviewOccurrence,
  DispatchOverviewUnscheduledJob,
  DispatchView,
} from './types';

function toCommitmentSummary(commitment: CustomerCommitment): DispatchCommitmentSummary {
  return {
    commitmentId: commitment.id,
    committedDate: commitment.committedDate,
    windowStartTime: commitment.windowStartTime,
    windowEndTime: commitment.windowEndTime,
    source: commitment.source,
    contactName: commitment.contactName,
    recordedAt: commitment.recordedAt,
  };
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type OverviewJobRow = Pick<
  Database['public']['Tables']['jobs']['Row'],
  'id' | 'title' | 'description' | 'job_number' | 'status' | 'location' | 'client_id' | 'site_id'
>;

type OverviewOccurrence = Pick<
  Database['public']['Tables']['planning_occurrences']['Row'],
  | 'id'
  | 'version'
  | 'series_id'
  | 'job_id'
  | 'entry_kind'
  | 'time_kind'
  | 'status'
  | 'location'
  | 'start_at'
  | 'end_at'
  | 'start_date'
  | 'end_date_exclusive'
> & { job: OverviewJobRow };

type OverviewCommitmentRow = Pick<
  Database['public']['Tables']['planning_customer_commitments']['Row'],
  | 'id'
  | 'occurrence_id'
  | 'committed_date'
  | 'window_start_time'
  | 'window_end_time'
  | 'source'
  | 'contact_id'
  | 'recorded_at'
>;

function buildDispatchTravelFacts(
  occurrences: OverviewOccurrence[],
  jobs: Map<string, OverviewJobRow>,
  assignmentsByOccurrence: Map<string, string[]>,
  travelNameFacts: Map<string, EmployeeNameFacts>,
): TravelVisitFact[] {
  return occurrences.flatMap((occurrence) => {
    if (!occurrence.start_at || !occurrence.end_at) return [];
    const job = occurrence.job_id ? jobs.get(occurrence.job_id) : null;
    const startLocal = formatBerlinLocalDateTime(occurrence.start_at);
    const endLocal = formatBerlinLocalDateTime(occurrence.end_at);
    const startMinutes = Number(startLocal.slice(11, 13)) * 60 + Number(startLocal.slice(14, 16));
    const sameDay = endLocal.slice(0, 10) === startLocal.slice(0, 10);
    const endMinutes = sameDay
      ? Number(endLocal.slice(11, 13)) * 60 + Number(endLocal.slice(14, 16))
      : 24 * 60;
    return (assignmentsByOccurrence.get(occurrence.id) ?? []).map((employeeRecordId) => ({
      occurrenceId: occurrence.id,
      title: job?.title.trim() || job?.description?.trim() || 'Auftragsbesuch',
      employeeRecordId,
      employeeName: travelNameFacts.get(employeeRecordId)?.displayName ?? 'Unbenannt',
      localDate: startLocal.slice(0, 10),
      startMinutes,
      endMinutes,
      siteId: job?.site_id ?? null,
    }));
  });
}

function buildDispatchOverviewOccurrences(input: {
  occurrences: OverviewOccurrence[];
  clients: Map<string, { id: string; name: string }>;
  sites: Map<string, { id: string; name: string; access_notes: string | null }>;
  dispatchByOccurrence: Map<string, DispatchRow>;
  dispatchViews: Map<string, DispatchView>;
  commitmentByOccurrence: Map<string, OverviewCommitmentRow>;
  contactNames: Map<string, string>;
  assignmentsByOccurrence: Map<string, string[]>;
}): DispatchOverviewOccurrence[] {
  const { clients, sites, dispatchByOccurrence, dispatchViews, commitmentByOccurrence, contactNames } = input;
  return input.occurrences.map((occurrence) => {
    const job = occurrence.job;
    const client = job.client_id ? clients.get(job.client_id) : null;
    const site = job.site_id ? sites.get(job.site_id) : null;
    const dispatchRow = dispatchByOccurrence.get(occurrence.id) ?? null;
    const dispatch = dispatchRow ? (dispatchViews.get(dispatchRow.id) ?? null) : null;
    const commitmentRow = commitmentByOccurrence.get(occurrence.id) ?? null;
    const startLocal = occurrence.start_at ? formatBerlinLocalDateTime(occurrence.start_at) : null;
    const commitment: DispatchCommitmentSummary | null = commitmentRow
      ? toCommitmentSummary({
          id: commitmentRow.id,
          occurrenceId: commitmentRow.occurrence_id,
          committedDate: commitmentRow.committed_date,
          windowStartTime: commitmentRow.window_start_time,
          windowEndTime: commitmentRow.window_end_time,
          source: commitmentRow.source,
          contactId: commitmentRow.contact_id,
          contactName: commitmentRow.contact_id ? (contactNames.get(commitmentRow.contact_id) ?? null) : null,
          status: 'active',
          withdrawalReason: null,
          recordedAt: commitmentRow.recorded_at,
          recordedByName: null,
        })
      : null;
    return {
      occurrenceId: occurrence.id,
      occurrenceVersion: occurrence.version,
      seriesId: occurrence.series_id,
      jobId: job.id,
      jobNumber: job.job_number,
      title: job.title.trim() || job.description?.trim() || 'Auftragsbesuch',
      clientName: client?.name ?? null,
      timeKind: occurrence.time_kind,
      startAt: occurrence.start_at,
      endAt: occurrence.end_at,
      startDate: occurrence.start_date,
      endDateExclusive: occurrence.end_date_exclusive,
      locationText: occurrence.location ?? job.location ?? null,
      siteName: site?.name ?? null,
      siteAccessNotes: site?.access_notes ?? null,
      assignedEmployeeRecordIds: input.assignmentsByOccurrence.get(occurrence.id) ?? [],
      dispatch,
      commitment,
      commitmentMismatch:
        commitmentRow !== null &&
        isCommitmentMismatch(
          {
            committedDate: commitmentRow.committed_date,
            windowStartTime: commitmentRow.window_start_time,
            windowEndTime: commitmentRow.window_end_time,
          },
          {
            timeKind: occurrence.time_kind,
            localStartDate: startLocal?.slice(0, 10) ?? occurrence.start_date ?? '',
            localStartTime: startLocal?.slice(11, 16) ?? null,
          },
        ),
    };
  });
}

// Unscheduled job-targeted dispatches (backlog work already handed out).
async function loadUnscheduledDispatchJobs(
  admin: AdminClient,
  orgId: string,
  unscheduledDispatches: DispatchRow[],
  dispatchViews: Map<string, DispatchView>,
): Promise<DispatchOverviewUnscheduledJob[] | null> {
  const unscheduledJobIds = unscheduledDispatches.flatMap((row) => (row.job_id ? [row.job_id] : []));
  const unscheduledJobsResult = await readInBatches(unscheduledJobIds, (batch) =>
    admin
      .from('jobs')
      .select('id, title, description, job_number, status, client_id')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  if (unscheduledJobsResult.error) {
    return dispatchReadFailed('loadDispatchOverview', 'unscheduled jobs', unscheduledJobsResult.error);
  }
  const unscheduledClientIds = unscheduledJobsResult.data.flatMap((job) =>
    job.client_id ? [job.client_id] : [],
  );
  const unscheduledClientsResult = await readInBatches(unscheduledClientIds, (batch) =>
    admin
      .from('clients')
      .select('id, name')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  if (unscheduledClientsResult.error) {
    return dispatchReadFailed('loadDispatchOverview', 'unscheduled clients', unscheduledClientsResult.error);
  }
  const unscheduledClients = new Map(unscheduledClientsResult.data.map((client) => [client.id, client]));
  const unscheduledJobById = new Map(unscheduledJobsResult.data.map((job) => [job.id, job]));
  return unscheduledDispatches.flatMap((row) => {
    const job = row.job_id ? unscheduledJobById.get(row.job_id) : undefined;
    const dispatch = dispatchViews.get(row.id);
    if (!job || !dispatch) return [];
    return [
      {
        jobId: job.id,
        jobNumber: job.job_number,
        title: job.title.trim() || job.description?.trim() || 'Auftrag',
        clientName: job.client_id ? (unscheduledClients.get(job.client_id)?.name ?? null) : null,
        jobStatus: job.status,
        dispatch,
      },
    ];
  });
}

async function loadOverviewCommitments(
  admin: AdminClient,
  orgId: string,
  occurrenceIds: string[],
): Promise<{
  contactNames: Map<string, string>;
  commitmentByOccurrence: Map<string, OverviewCommitmentRow>;
} | null> {
  const commitmentsResult = await readInBatches(occurrenceIds, (batch) =>
    admin
      .from('planning_customer_commitments')
      .select(
        'id, occurrence_id, committed_date, window_start_time, window_end_time, source, contact_id, recorded_at',
      )
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .in('occurrence_id', [...batch]),
  );
  if (commitmentsResult.error) {
    return dispatchReadFailed('loadDispatchOverview', 'commitments', commitmentsResult.error);
  }
  const contactIds = commitmentsResult.data.flatMap((row) => (row.contact_id ? [row.contact_id] : []));
  const contactsResult = await readInBatches(contactIds, (batch) =>
    admin
      .from('client_contacts')
      .select('id, name')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  if (contactsResult.error)
    return dispatchReadFailed('loadDispatchOverview', 'contacts', contactsResult.error);
  const contactNames = new Map(contactsResult.data.map((contact) => [contact.id, contact.name]));
  const commitmentByOccurrence = new Map(commitmentsResult.data.map((row) => [row.occurrence_id, row]));
  return { contactNames, commitmentByOccurrence };
}

type OverviewWindow = {
  occurrences: OverviewOccurrence[];
  jobRows: OverviewJobRow[];
  jobs: Map<string, OverviewJobRow>;
};

async function loadOverviewWindow(
  admin: AdminClient,
  input: { orgId: string; from: string; to: string },
): Promise<OverviewWindow | null> {
  // Every visit of the window, in pages: a week of a few hundred employees
  // holds more visits than one PostgREST response returns.
  const { data: occurrenceRows, error: occurrenceError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('planning_occurrences')
        .select(
          'id, version, series_id, job_id, entry_kind, time_kind, status, location, start_at, end_at, start_date, end_date_exclusive',
        )
        .eq('organization_id', input.orgId)
        .eq('status', 'scheduled')
        .eq('entry_kind', 'job_visit')
        .or(
          `and(start_date.gte.${input.from},start_date.lte.${input.to}),and(start_at.gte.${input.from}T00:00:00Z,start_at.lte.${input.to}T23:59:59Z)`,
        )
        .order('start_at', { ascending: true, nullsFirst: false })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (occurrenceError)
    return dispatchReadFailed('loadDispatchOverview', 'window occurrences', occurrenceError);

  const jobIds = occurrenceRows.flatMap((row) => (row.job_id ? [row.job_id] : []));
  const jobsResult = await readInBatches(jobIds, (batch) =>
    admin
      .from('jobs')
      .select('id, title, description, job_number, status, location, client_id, site_id')
      .eq('organization_id', input.orgId)
      .in('id', [...batch]),
  );
  if (jobsResult.error) return dispatchReadFailed('loadDispatchOverview', 'jobs', jobsResult.error);
  const jobs = new Map(jobsResult.data.map((job) => [job.id, job]));

  // Occurrences of parked jobs are hidden from the calendar; hide them here
  // for the same reason (the Parkplatz owns that state).
  const occurrences = occurrenceRows.flatMap((row) => {
    const job = row.job_id ? jobs.get(row.job_id) : null;
    return job && job.status !== 'geparkt' ? [{ ...row, job }] : [];
  });
  return { occurrences, jobRows: jobsResult.data, jobs };
}

type OverviewDispatchFacts = {
  assignmentsByOccurrence: Map<string, string[]>;
  assignedRecordIds: string[];
  occurrenceDispatches: DispatchRow[];
  unscheduledDispatches: DispatchRow[];
};

async function loadOverviewDispatchFacts(
  admin: AdminClient,
  orgId: string,
  occurrenceIds: string[],
): Promise<OverviewDispatchFacts | null> {
  const [assignmentsResult, dispatchResult, unscheduledDispatchResult] = await Promise.all([
    readInBatches(occurrenceIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('planning_occurrence_assignments')
            .select('occurrence_id, employee_record_id')
            .eq('organization_id', orgId)
            .in('occurrence_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(occurrenceIds, (batch) =>
      admin
        .from('planning_dispatches')
        .select('id, organization_id, occurrence_id, job_id, status, current_revision_id')
        .eq('organization_id', orgId)
        .eq('status', 'active')
        .in('occurrence_id', [...batch]),
    ),
    // The complete unscheduled backlog, oldest first: the overview counts
    // open challenges over it, so a shortened list would under-report.
    readCompleteRows(
      (from, to) =>
        admin
          .from('planning_dispatches')
          .select('id, organization_id, occurrence_id, job_id, status, current_revision_id')
          .eq('organization_id', orgId)
          .eq('status', 'active')
          .not('job_id', 'is', null)
          .order('created_at', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);
  const dispatchReadError =
    assignmentsResult.error ?? dispatchResult.error ?? unscheduledDispatchResult.error;
  if (dispatchReadError) {
    return dispatchReadFailed('loadDispatchOverview', 'assignments or dispatches', dispatchReadError);
  }

  const assignmentsByOccurrence = new Map<string, string[]>();
  for (const row of assignmentsResult.data) {
    const list = assignmentsByOccurrence.get(row.occurrence_id) ?? [];
    list.push(row.employee_record_id);
    assignmentsByOccurrence.set(row.occurrence_id, list);
  }
  return {
    assignmentsByOccurrence,
    assignedRecordIds: [...new Set(assignmentsResult.data.map((row) => row.employee_record_id))],
    occurrenceDispatches: dispatchResult.data,
    unscheduledDispatches: unscheduledDispatchResult.data,
  };
}

async function loadOverviewCustomers(
  admin: AdminClient,
  orgId: string,
  jobRows: OverviewJobRow[],
): Promise<{
  clients: Map<string, { id: string; name: string }>;
  sites: Map<string, { id: string; name: string; access_notes: string | null }>;
} | null> {
  const clientIds = jobRows.flatMap((job) => (job.client_id ? [job.client_id] : []));
  const siteIds = jobRows.flatMap((job) => (job.site_id ? [job.site_id] : []));
  const [clientsResult, sitesResult] = await Promise.all([
    readInBatches(clientIds, (batch) =>
      admin
        .from('clients')
        .select('id, name')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(siteIds, (batch) =>
      admin
        .from('client_sites')
        .select('id, name, access_notes')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
  ]);
  const customerError = clientsResult.error ?? sitesResult.error;
  if (customerError) return dispatchReadFailed('loadDispatchOverview', 'clients or sites', customerError);
  return {
    clients: new Map(clientsResult.data.map((client) => [client.id, client])),
    sites: new Map(sitesResult.data.map((site) => [site.id, site])),
  };
}

export async function loadDispatchOverview(input: {
  orgId: string;
  from: string;
  to: string;
}): Promise<DispatchOverview | null> {
  // Defense in depth: these values are interpolated into a PostgREST or()
  // filter, so only plain ISO dates may pass regardless of the caller.
  if (!ISO_DATE_PATTERN.test(input.from) || !ISO_DATE_PATTERN.test(input.to)) {
    return null;
  }
  const admin = createSupabaseAdminClient();
  const overviewWindow = await loadOverviewWindow(admin, input);
  if (!overviewWindow) return null;
  const { occurrences, jobs } = overviewWindow;

  const occurrenceIds = occurrences.map((row) => row.id);
  const dispatchFacts = await loadOverviewDispatchFacts(admin, input.orgId, occurrenceIds);
  if (!dispatchFacts) return null;
  const { assignmentsByOccurrence, occurrenceDispatches, unscheduledDispatches } = dispatchFacts;

  const allDispatches: DispatchRow[] = [...occurrenceDispatches, ...unscheduledDispatches];
  const dispatchViews = await loadDispatchViews(admin, input.orgId, allDispatches);
  if (!dispatchViews) return null;
  const dispatchByOccurrence = new Map(
    occurrenceDispatches.flatMap((row) => (row.occurrence_id ? [[row.occurrence_id, row] as const] : [])),
  );

  // Active commitments for the window occurrences.
  const commitmentFacts = await loadOverviewCommitments(admin, input.orgId, occurrenceIds);
  if (!commitmentFacts) return null;
  const { contactNames, commitmentByOccurrence } = commitmentFacts;

  const customers = await loadOverviewCustomers(admin, input.orgId, overviewWindow.jobRows);
  if (!customers) return null;

  // Travel facts: consecutive timed visits per employee per Berlin day.
  const travelNameFacts = await loadEmployeeNameFacts(admin, input.orgId, dispatchFacts.assignedRecordIds);
  if (!travelNameFacts) return null;
  const travelFacts = buildDispatchTravelFacts(occurrences, jobs, assignmentsByOccurrence, travelNameFacts);

  const overviewOccurrences = buildDispatchOverviewOccurrences({
    occurrences,
    clients: customers.clients,
    sites: customers.sites,
    dispatchByOccurrence,
    dispatchViews,
    commitmentByOccurrence,
    contactNames,
    assignmentsByOccurrence,
  });

  const unscheduledJobs = await loadUnscheduledDispatchJobs(
    admin,
    input.orgId,
    unscheduledDispatches,
    dispatchViews,
  );
  if (!unscheduledJobs) return null;

  const openChallengeCount = [
    ...overviewOccurrences.flatMap((entry) => entry.dispatch?.recipients ?? []),
    ...unscheduledJobs.flatMap((entry) => entry.dispatch.recipients),
  ].filter((recipient) => recipient.state === 'rueckfrage').length;

  return {
    occurrences: overviewOccurrences,
    unscheduledJobs,
    travelNotes: deriveTravelNotes(travelFacts),
    openChallengeCount,
  };
}

import 'server-only';

import { formatBerlinLocalDateTime } from '@/lib/planning/date-time';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  isCommitmentMismatch,
  type CustomerCommitment,
} from '@/lib/commitments/types';
import {
  deriveRecipientState,
  deriveTravelNotes,
  latestAcknowledgementByRecipient,
  type AcknowledgementFact,
  type TravelVisitFact,
} from './derivation';
import type {
  DispatchCommitmentSummary,
  DispatchOverview,
  DispatchOverviewOccurrence,
  DispatchOverviewUnscheduledJob,
  DispatchRecipientView,
  DispatchView,
  EmployeeDispatchCard,
} from './types';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type DispatchRow = {
  id: string;
  organization_id: string;
  occurrence_id: string | null;
  job_id: string | null;
  status: 'active' | 'cancelled';
  current_revision_id: string | null;
};

type EmployeeNameFacts = {
  displayName: string;
  hasLogin: boolean;
};

// Resolves display names and can-acknowledge state for employee records.
// "hasLogin" means the record is linked to a CURRENT active membership — an
// exited or never-linked record cannot acknowledge and shows the labeled
// "nicht möglich" state instead.
export async function loadEmployeeNameFacts(
  admin: AdminClient,
  orgId: string,
  employeeRecordIds: string[]
): Promise<Map<string, EmployeeNameFacts> | null> {
  if (employeeRecordIds.length === 0) return new Map();
  const { data: records, error } = await admin
    .from('employee_records')
    .select('id, user_id, first_name, last_name')
    .eq('organization_id', orgId)
    .in('id', [...new Set(employeeRecordIds)]);
  if (error) return null;
  const userIds = (records ?? []).flatMap((record) =>
    record.user_id ? [record.user_id] : []
  );
  const [profilesResult, membersResult] = await Promise.all([
    userIds.length
      ? admin
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', userIds)
      : { data: [], error: null },
    userIds.length
      ? admin
          .from('organization_members')
          .select('user_id')
          .eq('organization_id', orgId)
          .in('user_id', userIds)
      : { data: [], error: null },
  ]);
  if (profilesResult.error || membersResult.error) return null;
  const profileNames = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ])
  );
  const activeMemberIds = new Set(
    (membersResult.data ?? []).map((member) => member.user_id)
  );
  return new Map(
    (records ?? []).map((record) => [
      record.id,
      {
        displayName:
          (record.user_id ? profileNames.get(record.user_id) : null) ||
          [record.first_name, record.last_name].filter(Boolean).join(' ') ||
          'Unbenannt',
        hasLogin: Boolean(record.user_id && activeMemberIds.has(record.user_id)),
      },
    ])
  );
}

// Builds DispatchViews (current revision + derived recipient states) for a
// set of dispatch rows.
async function loadDispatchViews(
  admin: AdminClient,
  orgId: string,
  dispatches: DispatchRow[]
): Promise<Map<string, DispatchView> | null> {
  const revisionIds = dispatches.flatMap((dispatch) =>
    dispatch.current_revision_id ? [dispatch.current_revision_id] : []
  );
  if (revisionIds.length === 0) return new Map();
  const [revisionsResult, recipientsResult, acksResult] = await Promise.all([
    admin
      .from('planning_dispatch_revisions')
      .select(
        'id, dispatch_id, revision_number, change_kind, occurrence_id, job_id, dispatch_note, created_at'
      )
      .eq('organization_id', orgId)
      .in('id', revisionIds),
    admin
      .from('planning_dispatch_recipients')
      .select('revision_id, employee_record_id')
      .eq('organization_id', orgId)
      .in('revision_id', revisionIds)
      .limit(5001),
    admin
      .from('planning_dispatch_acknowledgements')
      .select(
        'id, revision_id, employee_record_id, state, reason, challenge_resolved_at, created_at'
      )
      .eq('organization_id', orgId)
      .in('revision_id', revisionIds)
      .limit(5001),
  ]);
  if (
    revisionsResult.error ||
    recipientsResult.error ||
    acksResult.error ||
    (recipientsResult.data?.length ?? 0) > 5000 ||
    (acksResult.data?.length ?? 0) > 5000
  ) {
    return null;
  }

  const recipientsByRevision = new Map<string, string[]>();
  for (const row of recipientsResult.data ?? []) {
    const list = recipientsByRevision.get(row.revision_id) ?? [];
    list.push(row.employee_record_id);
    recipientsByRevision.set(row.revision_id, list);
  }
  const acksByRevision = new Map<string, AcknowledgementFact[]>();
  for (const row of acksResult.data ?? []) {
    const list = acksByRevision.get(row.revision_id) ?? [];
    list.push({
      id: row.id,
      employeeRecordId: row.employee_record_id,
      state: row.state,
      reason: row.reason,
      challengeResolvedAt: row.challenge_resolved_at,
      createdAt: row.created_at,
    });
    acksByRevision.set(row.revision_id, list);
  }
  const allRecipientIds = [
    ...new Set((recipientsResult.data ?? []).map((row) => row.employee_record_id)),
  ];
  const nameFacts = await loadEmployeeNameFacts(admin, orgId, allRecipientIds);
  if (!nameFacts) return null;

  const views = new Map<string, DispatchView>();
  for (const dispatch of dispatches) {
    const revision = (revisionsResult.data ?? []).find(
      (row) => row.id === dispatch.current_revision_id
    );
    if (!revision) continue;
    const latestByRecipient = latestAcknowledgementByRecipient(
      acksByRevision.get(revision.id) ?? []
    );
    const recipients: DispatchRecipientView[] = (
      recipientsByRevision.get(revision.id) ?? []
    ).map((employeeRecordId) => {
      const facts = nameFacts.get(employeeRecordId);
      const latest = latestByRecipient.get(employeeRecordId) ?? null;
      const state = deriveRecipientState({
        hasLogin: facts?.hasLogin ?? false,
        latest,
      });
      return {
        employeeRecordId,
        displayName: facts?.displayName ?? 'Unbenannt',
        hasLogin: facts?.hasLogin ?? false,
        state,
        challengeReason: state === 'rueckfrage' ? (latest?.reason ?? null) : null,
        acknowledgementId: latest?.id ?? null,
      };
    });
    views.set(dispatch.id, {
      dispatchId: dispatch.id,
      status: dispatch.status,
      revisionId: revision.id,
      revisionNumber: revision.revision_number,
      changeKind: revision.change_kind,
      targetKind: revision.occurrence_id ? 'occurrence' : 'job',
      note: revision.dispatch_note,
      issuedAt: revision.created_at,
      recipients,
    });
  }
  return views;
}

function toCommitmentSummary(
  commitment: CustomerCommitment
): DispatchCommitmentSummary {
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
  const { data: occurrenceRows, error: occurrenceError } = await admin
    .from('planning_occurrences')
    .select(
      'id, version, series_id, job_id, entry_kind, time_kind, status, location, start_at, end_at, start_date, end_date_exclusive'
    )
    .eq('organization_id', input.orgId)
    .eq('status', 'scheduled')
    .eq('entry_kind', 'job_visit')
    .or(
      `and(start_date.gte.${input.from},start_date.lte.${input.to}),and(start_at.gte.${input.from}T00:00:00Z,start_at.lte.${input.to}T23:59:59Z)`
    )
    .order('start_at', { ascending: true, nullsFirst: false })
    .limit(501);
  if (occurrenceError || (occurrenceRows?.length ?? 0) > 500) return null;

  const jobIds = [
    ...new Set(
      (occurrenceRows ?? []).flatMap((row) => (row.job_id ? [row.job_id] : []))
    ),
  ];
  const jobsResult = jobIds.length
    ? await admin
        .from('jobs')
        .select('id, title, description, job_number, status, location, client_id, site_id')
        .eq('organization_id', input.orgId)
        .in('id', jobIds)
    : { data: [], error: null };
  if (jobsResult.error) return null;
  const jobs = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));

  // Occurrences of parked jobs are hidden from the calendar; hide them here
  // for the same reason (the Parkplatz owns that state).
  const occurrences = (occurrenceRows ?? []).filter((row) => {
    const job = row.job_id ? jobs.get(row.job_id) : null;
    return job && job.status !== 'geparkt';
  });

  const occurrenceIds = occurrences.map((row) => row.id);
  const [assignmentsResult, dispatchResult, unscheduledDispatchResult] =
    await Promise.all([
      occurrenceIds.length
        ? admin
            .from('planning_occurrence_assignments')
            .select('occurrence_id, employee_record_id')
            .eq('organization_id', input.orgId)
            .in('occurrence_id', occurrenceIds)
            .limit(5001)
        : { data: [], error: null },
      occurrenceIds.length
        ? admin
            .from('planning_dispatches')
            .select(
              'id, organization_id, occurrence_id, job_id, status, current_revision_id'
            )
            .eq('organization_id', input.orgId)
            .eq('status', 'active')
            .in('occurrence_id', occurrenceIds)
        : { data: [], error: null },
      // Deterministically ordered and bounded: an oversized unscheduled
      // backlog truncates to the oldest 200 instead of failing the overview.
      admin
        .from('planning_dispatches')
        .select(
          'id, organization_id, occurrence_id, job_id, status, current_revision_id'
        )
        .eq('organization_id', input.orgId)
        .eq('status', 'active')
        .not('job_id', 'is', null)
        .order('created_at', { ascending: true })
        .limit(200),
    ]);
  if (
    assignmentsResult.error ||
    dispatchResult.error ||
    unscheduledDispatchResult.error ||
    (assignmentsResult.data?.length ?? 0) > 5000
  ) {
    return null;
  }

  const assignmentsByOccurrence = new Map<string, string[]>();
  for (const row of assignmentsResult.data ?? []) {
    const list = assignmentsByOccurrence.get(row.occurrence_id) ?? [];
    list.push(row.employee_record_id);
    assignmentsByOccurrence.set(row.occurrence_id, list);
  }

  const allDispatches: DispatchRow[] = [
    ...(dispatchResult.data ?? []),
    ...(unscheduledDispatchResult.data ?? []),
  ];
  const dispatchViews = await loadDispatchViews(
    admin,
    input.orgId,
    allDispatches
  );
  if (!dispatchViews) return null;
  const dispatchByOccurrence = new Map(
    (dispatchResult.data ?? []).flatMap((row) =>
      row.occurrence_id ? [[row.occurrence_id, row] as const] : []
    )
  );

  // Active commitments for the window occurrences.
  const commitmentsResult = occurrenceIds.length
    ? await admin
        .from('planning_customer_commitments')
        .select(
          'id, occurrence_id, committed_date, window_start_time, window_end_time, source, contact_id, recorded_at'
        )
        .eq('organization_id', input.orgId)
        .eq('status', 'active')
        .in('occurrence_id', occurrenceIds)
    : { data: [], error: null };
  if (commitmentsResult.error) return null;
  const contactIds = [
    ...new Set(
      (commitmentsResult.data ?? []).flatMap((row) =>
        row.contact_id ? [row.contact_id] : []
      )
    ),
  ];
  const contactsResult = contactIds.length
    ? await admin
        .from('client_contacts')
        .select('id, name')
        .eq('organization_id', input.orgId)
        .in('id', contactIds)
    : { data: [], error: null };
  if (contactsResult.error) return null;
  const contactNames = new Map(
    (contactsResult.data ?? []).map((contact) => [contact.id, contact.name])
  );
  const commitmentByOccurrence = new Map(
    (commitmentsResult.data ?? []).map((row) => [row.occurrence_id, row])
  );

  const clientIds = [
    ...new Set(
      (jobsResult.data ?? []).flatMap((job) =>
        job.client_id ? [job.client_id] : []
      )
    ),
  ];
  const siteIds = [
    ...new Set(
      (jobsResult.data ?? []).flatMap((job) => (job.site_id ? [job.site_id] : []))
    ),
  ];
  const [clientsResult, sitesResult] = await Promise.all([
    clientIds.length
      ? admin
          .from('clients')
          .select('id, name')
          .eq('organization_id', input.orgId)
          .in('id', clientIds)
      : { data: [], error: null },
    siteIds.length
      ? admin
          .from('client_sites')
          .select('id, name, access_notes')
          .eq('organization_id', input.orgId)
          .in('id', siteIds)
      : { data: [], error: null },
  ]);
  if (clientsResult.error || sitesResult.error) return null;
  const clients = new Map(
    (clientsResult.data ?? []).map((client) => [client.id, client])
  );
  const sites = new Map((sitesResult.data ?? []).map((site) => [site.id, site]));

  // Travel facts: consecutive timed visits per employee per Berlin day.
  const allAssignedRecordIds = [
    ...new Set((assignmentsResult.data ?? []).map((row) => row.employee_record_id)),
  ];
  const travelNameFacts = await loadEmployeeNameFacts(
    admin,
    input.orgId,
    allAssignedRecordIds
  );
  if (!travelNameFacts) return null;
  const travelFacts: TravelVisitFact[] = occurrences.flatMap((occurrence) => {
    if (!occurrence.start_at || !occurrence.end_at) return [];
    const job = occurrence.job_id ? jobs.get(occurrence.job_id) : null;
    const startLocal = formatBerlinLocalDateTime(occurrence.start_at);
    const endLocal = formatBerlinLocalDateTime(occurrence.end_at);
    const startMinutes =
      Number(startLocal.slice(11, 13)) * 60 + Number(startLocal.slice(14, 16));
    const sameDay = endLocal.slice(0, 10) === startLocal.slice(0, 10);
    const endMinutes = sameDay
      ? Number(endLocal.slice(11, 13)) * 60 + Number(endLocal.slice(14, 16))
      : 24 * 60;
    return (assignmentsByOccurrence.get(occurrence.id) ?? []).map(
      (employeeRecordId) => ({
        occurrenceId: occurrence.id,
        title:
          job?.title.trim() || job?.description?.trim() || 'Auftragsbesuch',
        employeeRecordId,
        employeeName:
          travelNameFacts.get(employeeRecordId)?.displayName ?? 'Unbenannt',
        localDate: startLocal.slice(0, 10),
        startMinutes,
        endMinutes,
        siteId: job?.site_id ?? null,
      })
    );
  });

  const overviewOccurrences: DispatchOverviewOccurrence[] = occurrences.map(
    (occurrence) => {
      const job = jobs.get(occurrence.job_id!)!;
      const client = job.client_id ? clients.get(job.client_id) : null;
      const site = job.site_id ? sites.get(job.site_id) : null;
      const dispatchRow = dispatchByOccurrence.get(occurrence.id) ?? null;
      const dispatch = dispatchRow
        ? (dispatchViews.get(dispatchRow.id) ?? null)
        : null;
      const commitmentRow = commitmentByOccurrence.get(occurrence.id) ?? null;
      const startLocal = occurrence.start_at
        ? formatBerlinLocalDateTime(occurrence.start_at)
        : null;
      const commitment: DispatchCommitmentSummary | null = commitmentRow
        ? toCommitmentSummary({
            id: commitmentRow.id,
            occurrenceId: commitmentRow.occurrence_id,
            committedDate: commitmentRow.committed_date,
            windowStartTime: commitmentRow.window_start_time,
            windowEndTime: commitmentRow.window_end_time,
            source: commitmentRow.source,
            contactId: commitmentRow.contact_id,
            contactName: commitmentRow.contact_id
              ? (contactNames.get(commitmentRow.contact_id) ?? null)
              : null,
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
        jobId: occurrence.job_id!,
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
        assignedEmployeeRecordIds:
          assignmentsByOccurrence.get(occurrence.id) ?? [],
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
              localStartDate:
                startLocal?.slice(0, 10) ?? occurrence.start_date ?? '',
              localStartTime: startLocal?.slice(11, 16) ?? null,
            }
          ),
      };
    }
  );

  // Unscheduled job-targeted dispatches (backlog work already handed out).
  const unscheduledJobIds = [
    ...new Set(
      (unscheduledDispatchResult.data ?? []).flatMap((row) =>
        row.job_id ? [row.job_id] : []
      )
    ),
  ];
  const unscheduledJobsResult = unscheduledJobIds.length
    ? await admin
        .from('jobs')
        .select('id, title, description, job_number, status, client_id')
        .eq('organization_id', input.orgId)
        .in('id', unscheduledJobIds)
    : { data: [], error: null };
  if (unscheduledJobsResult.error) return null;
  const unscheduledClientIds = [
    ...new Set(
      (unscheduledJobsResult.data ?? []).flatMap((job) =>
        job.client_id ? [job.client_id] : []
      )
    ),
  ];
  const unscheduledClientsResult = unscheduledClientIds.length
    ? await admin
        .from('clients')
        .select('id, name')
        .eq('organization_id', input.orgId)
        .in('id', unscheduledClientIds)
    : { data: [], error: null };
  if (unscheduledClientsResult.error) return null;
  const unscheduledClients = new Map(
    (unscheduledClientsResult.data ?? []).map((client) => [client.id, client])
  );
  const unscheduledJobs: DispatchOverviewUnscheduledJob[] = (
    unscheduledDispatchResult.data ?? []
  ).flatMap((row) => {
    const job = (unscheduledJobsResult.data ?? []).find(
      (candidate) => candidate.id === row.job_id
    );
    const dispatch = dispatchViews.get(row.id);
    if (!job || !dispatch) return [];
    return [
      {
        jobId: job.id,
        jobNumber: job.job_number,
        title: job.title.trim() || job.description?.trim() || 'Auftrag',
        clientName: job.client_id
          ? (unscheduledClients.get(job.client_id)?.name ?? null)
          : null,
        jobStatus: job.status,
        dispatch,
      },
    ];
  });

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

export async function loadEmployeeDispatchCards(input: {
  orgId: string;
  userId: string;
  jobId: string;
}): Promise<EmployeeDispatchCard[] | null> {
  const admin = createSupabaseAdminClient();
  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', input.orgId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (recordError) return null;
  if (!record) return [];

  const { data: jobOccurrences, error: occurrenceError } = await admin
    .from('planning_occurrences')
    .select('id')
    .eq('organization_id', input.orgId)
    .eq('job_id', input.jobId)
    .limit(501);
  if (occurrenceError || (jobOccurrences?.length ?? 0) > 500) return null;
  const occurrenceIds = (jobOccurrences ?? []).map((row) => row.id);

  let dispatchQuery = admin
    .from('planning_dispatches')
    .select('id, organization_id, occurrence_id, job_id, status, current_revision_id')
    .eq('organization_id', input.orgId)
    .eq('status', 'active');
  dispatchQuery = occurrenceIds.length
    ? dispatchQuery.or(
        `job_id.eq.${input.jobId},occurrence_id.in.(${occurrenceIds.join(',')})`
      )
    : dispatchQuery.eq('job_id', input.jobId);
  const { data: dispatchRows, error: dispatchError } = await dispatchQuery;
  if (dispatchError) return null;
  if (!dispatchRows?.length) return [];

  const revisionIds = dispatchRows.flatMap((row) =>
    row.current_revision_id ? [row.current_revision_id] : []
  );
  const [revisionsResult, myRecipientsResult, acksResult] = await Promise.all([
    admin
      .from('planning_dispatch_revisions')
      .select(
        'id, dispatch_id, revision_number, occurrence_id, job_id, planned_start_at, planned_end_at, planned_start_date, planned_end_date_exclusive, location_text, dispatch_note'
      )
      .eq('organization_id', input.orgId)
      .in('id', revisionIds),
    admin
      .from('planning_dispatch_recipients')
      .select('revision_id, employee_record_id')
      .eq('organization_id', input.orgId)
      .eq('employee_record_id', record.id)
      .in('revision_id', revisionIds),
    admin
      .from('planning_dispatch_acknowledgements')
      .select(
        'id, revision_id, employee_record_id, state, reason, challenge_resolved_at, created_at'
      )
      .eq('organization_id', input.orgId)
      .eq('employee_record_id', record.id)
      .in('revision_id', revisionIds),
  ]);
  if (revisionsResult.error || myRecipientsResult.error || acksResult.error) {
    return null;
  }
  const myRevisionIds = new Set(
    (myRecipientsResult.data ?? []).map((row) => row.revision_id)
  );

  const dispatchOccurrenceIds = (revisionsResult.data ?? []).flatMap((row) =>
    row.occurrence_id ? [row.occurrence_id] : []
  );
  const commitmentsResult = dispatchOccurrenceIds.length
    ? await admin
        .from('planning_customer_commitments')
        .select(
          'occurrence_id, committed_date, window_start_time, window_end_time'
        )
        .eq('organization_id', input.orgId)
        .eq('status', 'active')
        .in('occurrence_id', dispatchOccurrenceIds)
    : { data: [], error: null };
  if (commitmentsResult.error) return null;
  const commitmentByOccurrence = new Map(
    (commitmentsResult.data ?? []).map((row) => [row.occurrence_id, row])
  );

  const cards: EmployeeDispatchCard[] = [];
  for (const dispatchRow of dispatchRows) {
    const revision = (revisionsResult.data ?? []).find(
      (row) => row.id === dispatchRow.current_revision_id
    );
    if (!revision || !myRevisionIds.has(revision.id)) continue;
    const myAcks: AcknowledgementFact[] = (acksResult.data ?? [])
      .filter((row) => row.revision_id === revision.id)
      .map((row) => ({
        id: row.id,
        employeeRecordId: row.employee_record_id,
        state: row.state,
        reason: row.reason,
        challengeResolvedAt: row.challenge_resolved_at,
        createdAt: row.created_at,
      }));
    const latest =
      latestAcknowledgementByRecipient(myAcks).get(record.id) ?? null;
    const myState = deriveRecipientState({ hasLogin: true, latest });
    const commitment = revision.occurrence_id
      ? (commitmentByOccurrence.get(revision.occurrence_id) ?? null)
      : null;
    cards.push({
      dispatchId: dispatchRow.id,
      revisionNumber: revision.revision_number,
      targetKind: revision.occurrence_id ? 'occurrence' : 'job',
      startAt: revision.planned_start_at,
      endAt: revision.planned_end_at,
      startDate: revision.planned_start_date,
      endDateExclusive: revision.planned_end_date_exclusive,
      locationText: revision.location_text,
      note: revision.dispatch_note,
      committedToCustomer: commitment !== null,
      committedWindowText: commitment
        ? commitment.window_start_time && commitment.window_end_time
          ? `${commitment.committed_date}, ${commitment.window_start_time.slice(0, 5)}–${commitment.window_end_time.slice(0, 5)} Uhr`
          : commitment.committed_date
        : null,
      myState,
      myOpenChallengeReason:
        myState === 'rueckfrage' ? (latest?.reason ?? null) : null,
    });
  }
  // Normalized sort key: date-only cards count as start of day so they order
  // correctly against timed cards; unscheduled dispatches sort last.
  const cardSortKey = (card: EmployeeDispatchCard): number => {
    if (card.startAt) return new Date(card.startAt).getTime();
    if (card.startDate) return Date.parse(`${card.startDate}T00:00:00Z`);
    return Number.MAX_SAFE_INTEGER;
  };
  cards.sort((left, right) => cardSortKey(left) - cardSortKey(right));
  return cards;
}

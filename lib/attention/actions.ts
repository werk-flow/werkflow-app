'use server';

// P1-07: the shared attention pattern's server boundary.
//
// Attention items are DERIVED from the owning domains through their own
// loaders — the exact queries and authorization paths that power the existing
// surfaces (Anträge tab, /anfragen). This module never stores or mutates
// domain state: deciding an item happens on the owning surface through the
// owning action. The only writes here are per-user read markers and
// append-only pattern events, keyed by the item identity.

import { cookies } from 'next/headers';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import { getBusinessTodayIso, toBusinessIsoDate } from '@/lib/personnel/types';
import { formatProfileName } from '@/lib/members/profile-name';
import type { OrgRole } from '@/lib/members/actions';
import {
  getPendingChangeRequests,
  getPendingSessions,
} from '@/lib/time-tracking/actions';
import {
  getOwnVacationOverview,
  getPendingVacationRequestsForApprover,
} from '@/lib/vacation/actions';
import type {
  VacationDayPortion,
  VacationRequestStatus,
} from '@/lib/vacation/types';
import type { RequestStatus, RequestUrgency } from '@/lib/requests/types';
import { loadCertificationExpiryNotifications } from '@/lib/qualifications/server';
import {
  deriveRecipientState,
  isAcknowledgementPending,
  latestAcknowledgementByRecipient,
  type AcknowledgementFact as DispatchAcknowledgementFact,
} from '@/lib/dispatch/derivation';
import {
  computeOpenSinceDays,
  dedupeAttentionItems,
  FOLLOW_UP_ATTENTION_CAPACITY,
  isNotificationUnread,
  isWithinNotificationWindow,
  notificationWindowStartIso,
  resolveSicknessReportFacts,
  resolveVacationDecisionFacts,
  sortNotificationsNewestFirst,
  selectFollowUpAttentionRows,
} from './resolution';
import type {
  AttentionCounts,
  AttentionNotification,
  AttentionOverview,
  AttentionTask,
  OwnAttentionRequest,
} from './types';

type ActionContext = {
  userId: string;
  orgId: string;
  role: OrgRole;
};

async function resolveActionContext(): Promise<
  | { success: true; context: ActionContext }
  | { success: false; error: string }
> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };

  const cookieStore = await cookies();
  const orgId = await resolveActiveOrgId(cookieStore, user.id);
  if (!orgId) return { success: false, error: 'no_active_org' };

  const memberships = await getCachedMemberships(user.id);
  const membership = memberships.find((entry) => entry.orgId === orgId);
  if (!membership) return { success: false, error: 'not_a_member' };

  return {
    success: true,
    context: { userId: user.id, orgId, role: membership.role as OrgRole },
  };
}

// ============================================
// Derivation building blocks
// ============================================

async function deriveApprovalTasks(
  context: ActionContext
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  const tasks: AttentionTask[] = [];
  let failed = false;

  // Pending time sessions: getPendingSessions resolves the caller's
  // time_approval responsibility itself and returns [] for non-holders.
  const sessionsResult = await getPendingSessions(context.orgId);
  if (sessionsResult.success) {
    for (const session of sessionsResult.sessions) {
      tasks.push({
        sourceType: 'time_session_approval',
        sourceId: session.id,
        personName:
          [session.firstName, session.lastName].filter(Boolean).join(' ') ||
          'Unbekannt',
        date: session.date,
        jobTitle: session.jobTitle,
      });
    }
  } else {
    failed = true;
  }

  // Pending change requests remain the admin recovery surface (P1-05).
  if (context.role === 'admin') {
    const changeRequestsResult = await getPendingChangeRequests(context.orgId);
    if (changeRequestsResult.success) {
      for (const request of changeRequestsResult.requests) {
        tasks.push({
          sourceType: 'time_change_request_approval',
          sourceId: request.id,
          personName:
            [request.requesterFirstName, request.requesterLastName]
              .filter(Boolean)
              .join(' ') || 'Unbekannt',
          requestType: request.changeType === 'delete' ? 'delete' : 'edit',
        });
      }
    } else {
      failed = true;
    }
  }

  // Pending vacation requests: the approver loader filters per target through
  // leave_approval at derivation time (four eyes included).
  const vacationResult = await getPendingVacationRequestsForApprover();
  if (vacationResult.success) {
    for (const item of vacationResult.requests) {
      tasks.push({
        sourceType: 'vacation_request_approval',
        sourceId: item.request.id,
        personName: item.personName,
        startDate: item.request.startDate,
        endDate: item.request.endDate,
        dayPortion: item.request.dayPortion,
        totalDays: item.totalDays,
      });
    }
  } else {
    failed = true;
  }

  return { tasks, failed };
}

async function deriveOpenRequestTasks(
  context: ActionContext
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  // Open client requests are an office surface; employees never see them.
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { tasks: [], failed: false };
  }

  const admin = createSupabaseAdminClient();
  const { data: rows, error } = await admin
    .from('client_requests')
    .select(
      'id, request_number, summary, status, urgency, assigned_to, received_at'
    )
    .eq('organization_id', context.orgId)
    .in('status', ['offen', 'in_klaerung'])
    .order('received_at', { ascending: true });
  if (error) {
    console.error('Failed to load open client requests:', error);
    return { tasks: [], failed: true };
  }

  const assigneeIds = [
    ...new Set(
      (rows ?? [])
        .map((row) => row.assigned_to)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const profilesResult =
    assigneeIds.length > 0
      ? await admin
          .from('profiles')
          .select('id, first_name, last_name, email')
          .in('id', assigneeIds)
      : { data: [], error: null };
  if (profilesResult.error) {
    console.error(
      'Failed to load request assignee profiles:',
      profilesResult.error
    );
    return { tasks: [], failed: true };
  }
  const profileById = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile])
  );

  const businessToday = getBusinessTodayIso();
  const tasks: AttentionTask[] = (rows ?? []).map((row) => {
    const assignee = row.assigned_to
      ? (profileById.get(row.assigned_to) ?? null)
      : null;
    return {
      sourceType: 'client_request_open',
      sourceId: row.id,
      requestNumber: row.request_number,
      summary: row.summary,
      status: row.status as RequestStatus,
      urgency: row.urgency as RequestUrgency,
      receivedAt: row.received_at,
      openSinceDays: computeOpenSinceDays(
        toBusinessIsoDate(new Date(row.received_at)),
        businessToday
      ),
      assigneeName: assignee ? formatProfileName(assignee) : null,
      assignedToMe: row.assigned_to === context.userId,
    };
  });

  return { tasks, failed: false };
}

async function deriveFollowUpTasks(
  context: ActionContext
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { tasks: [], failed: false };
  }

  const admin = createSupabaseAdminClient();
  const dueWindowEnd = new Date();
  dueWindowEnd.setUTCDate(dueWindowEnd.getUTCDate() + 90);

  const membershipsResult = await admin
    .from('organization_members')
    .select('user_id,role')
    .eq('organization_id', context.orgId)
    .in('role', ['admin', 'buero']);
  if (membershipsResult.error) {
    console.error('Failed to load follow-up attention tasks:', {
      membershipsError: membershipsResult.error,
    });
    return { tasks: [], failed: true };
  }
  const activeManagerIds = new Set(
    (membershipsResult.data ?? []).map((membership) => membership.user_id)
  );
  const activeManagerList = [...activeManagerIds].join(',');
  const visibilityFilter = activeManagerList
    ? `owner_user_id.eq.${context.userId},owner_user_id.not.in.(${activeManagerList})`
    : `owner_user_id.eq.${context.userId}`;
  const followUpsResult = await admin
    .from('client_follow_ups')
    .select('id,client_id,title,due_at,owner_user_id')
    .eq('organization_id', context.orgId)
    .eq('status', 'open')
    .lte('due_at', dueWindowEnd.toISOString())
    .or(visibilityFilter)
    .order('due_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(FOLLOW_UP_ATTENTION_CAPACITY + 1);
  if (followUpsResult.error) {
    console.error('Failed to load follow-up attention tasks:', {
      followUpsError: followUpsResult.error,
    });
    return { tasks: [], failed: true };
  }
  const selection = selectFollowUpAttentionRows(
    context.role,
    context.userId,
    followUpsResult.data ?? [],
    activeManagerIds,
    FOLLOW_UP_ATTENTION_CAPACITY
  );
  if (selection.capacityExceeded) {
    console.error('Follow-up attention window exceeded its bounded capacity.');
    return { tasks: [], failed: true };
  }
  const visibleRows = selection.rows;
  if (visibleRows.length === 0) return { tasks: [], failed: false };

  const clientIds = [...new Set(visibleRows.map((row) => row.client_id))];
  const ownerIds = [...new Set(visibleRows.map((row) => row.owner_user_id))];
  const [clientsResult, profilesResult] = await Promise.all([
    admin
      .from('clients')
      .select('id,name')
      .eq('organization_id', context.orgId)
      .in('id', clientIds),
    admin
      .from('profiles')
      .select('id,first_name,last_name,email')
      .in('id', ownerIds),
  ]);
  if (clientsResult.error || profilesResult.error) {
    console.error('Failed to resolve follow-up attention references:', {
      clientsError: clientsResult.error,
      profilesError: profilesResult.error,
    });
    return { tasks: [], failed: true };
  }

  const clientNameById = new Map(
    (clientsResult.data ?? []).map((client) => [client.id, client.name])
  );
  const profileById = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile])
  );
  const tasks: AttentionTask[] = [];
  for (const row of visibleRows) {
    const clientName = clientNameById.get(row.client_id);
    if (!clientName) {
      console.error('Follow-up attention task has no accessible customer.', row.id);
      return { tasks: [], failed: true };
    }
    const owner = profileById.get(row.owner_user_id) ?? null;
    tasks.push({
      sourceType: 'client_follow_up',
      sourceId: row.id,
      clientId: row.client_id,
      clientName,
      title: row.title,
      dueAt: row.due_at,
      ownerName: owner ? formatProfileName(owner) : 'Nicht verfügbar',
      ownerUnavailable: row.ownerUnavailable,
    });
  }

  return { tasks, failed: false };
}

// P1-12: dispatch attention. Items are projections over the owning dispatch
// rows; deciding happens through the dispatch actions, never here.

async function deriveDispatchAcknowledgementTasks(
  context: ActionContext
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', context.orgId)
    .eq('user_id', context.userId)
    .maybeSingle();
  if (recordError) {
    console.error('Failed to load own record for dispatch tasks:', {
      code: recordError.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  if (!record) return { tasks: [], failed: false };

  // Scope to the viewer from the start: their recipient rows, then only the
  // referenced revisions/dispatches. An unrelated large dispatch volume can
  // never turn this viewer's attention into a failure.
  const { data: myRecipients, error: recipientError } = await admin
    .from('planning_dispatch_recipients')
    .select('revision_id, dispatch_id')
    .eq('organization_id', context.orgId)
    .eq('employee_record_id', record.id)
    .limit(1001);
  if (recipientError || (myRecipients?.length ?? 0) > 1000) {
    console.error('Failed to load dispatch recipients for tasks:', {
      code: recipientError?.code ?? 'overflow',
    });
    return { tasks: [], failed: true };
  }
  if (!myRecipients?.length) return { tasks: [], failed: false };
  const myDispatchIds = [
    ...new Set(myRecipients.map((row) => row.dispatch_id)),
  ];
  const myRevisionIds = new Set(myRecipients.map((row) => row.revision_id));

  const { data: dispatches, error: dispatchError } = await admin
    .from('planning_dispatches')
    .select('id, occurrence_id, job_id, current_revision_id')
    .eq('organization_id', context.orgId)
    .eq('status', 'active')
    .in('id', myDispatchIds);
  if (dispatchError) {
    console.error('Failed to load dispatches for tasks:', {
      code: dispatchError.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  const currentRevisionIds = (dispatches ?? []).flatMap((dispatch) =>
    dispatch.current_revision_id && myRevisionIds.has(dispatch.current_revision_id)
      ? [dispatch.current_revision_id]
      : []
  );
  if (!currentRevisionIds.length) return { tasks: [], failed: false };

  const [acksResult, revisionsResult] = await Promise.all([
    admin
      .from('planning_dispatch_acknowledgements')
      .select('id, revision_id, employee_record_id, state, reason, challenge_resolved_at, created_at')
      .eq('organization_id', context.orgId)
      .eq('employee_record_id', record.id)
      .in('revision_id', currentRevisionIds),
    admin
      .from('planning_dispatch_revisions')
      .select(
        'id, dispatch_id, revision_number, occurrence_id, job_id, planned_start_at, planned_start_date'
      )
      .eq('organization_id', context.orgId)
      .in('id', currentRevisionIds),
  ]);
  if (acksResult.error || revisionsResult.error) {
    console.error('Failed to load dispatch task facts:', {
      code: (acksResult.error ?? revisionsResult.error)?.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  const revisionById = new Map(
    (revisionsResult.data ?? []).map((row) => [row.id, row])
  );

  const occurrenceIds = [...revisionById.values()].flatMap((row) =>
    row.occurrence_id ? [row.occurrence_id] : []
  );
  const occurrencesResult = occurrenceIds.length
    ? await admin
        .from('planning_occurrences')
        .select('id, job_id')
        .eq('organization_id', context.orgId)
        .in('id', occurrenceIds)
    : { data: [], error: null };
  if (occurrencesResult.error) {
    console.error('Failed to load dispatch occurrences:', {
      code: occurrencesResult.error.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  const occurrenceJobIds = new Map(
    (occurrencesResult.data ?? []).map((row) => [row.id, row.job_id])
  );
  const jobIds = [
    ...new Set([
      ...[...revisionById.values()].flatMap((row) =>
        row.job_id ? [row.job_id] : []
      ),
      ...[...occurrenceJobIds.values()].filter((id): id is string => Boolean(id)),
    ]),
  ];
  const jobsResult = jobIds.length
    ? await admin
        .from('jobs')
        .select('id, title, description, job_number')
        .eq('organization_id', context.orgId)
        .in('id', jobIds)
    : { data: [], error: null };
  if (jobsResult.error) {
    console.error('Failed to load dispatch jobs:', {
      code: jobsResult.error.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  const jobs = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));

  // Shared derivation rules (identical to every dispatch surface).
  const ackFactsByRevision = new Map<string, DispatchAcknowledgementFact[]>();
  for (const row of acksResult.data ?? []) {
    const list = ackFactsByRevision.get(row.revision_id) ?? [];
    list.push({
      id: row.id,
      employeeRecordId: row.employee_record_id,
      state: row.state,
      reason: row.reason,
      challengeResolvedAt: row.challenge_resolved_at,
      createdAt: row.created_at,
    });
    ackFactsByRevision.set(row.revision_id, list);
  }

  const tasks: AttentionTask[] = [];
  for (const dispatch of dispatches ?? []) {
    const revision = dispatch.current_revision_id
      ? revisionById.get(dispatch.current_revision_id)
      : undefined;
    if (!revision) continue;
    const latest =
      latestAcknowledgementByRecipient(
        ackFactsByRevision.get(revision.id) ?? []
      ).get(record.id) ?? null;
    const state = deriveRecipientState({ hasLogin: true, latest });
    if (!isAcknowledgementPending(state)) continue;
    const jobId =
      revision.job_id ??
      (revision.occurrence_id
        ? (occurrenceJobIds.get(revision.occurrence_id) ?? null)
        : null);
    if (!jobId) continue;
    const job = jobs.get(jobId);
    tasks.push({
      sourceType: 'dispatch_acknowledgement',
      sourceId: dispatch.id,
      jobId,
      jobNumber: job?.job_number ?? null,
      jobTitle:
        job?.title.trim() || job?.description?.trim() || 'Auftrag',
      revisionNumber: revision.revision_number,
      startAt: revision.planned_start_at,
      startDate: revision.planned_start_date,
      stateVersion: revision.id,
    });
  }
  return { tasks, failed: false };
}

async function deriveDispatchChallengeTasks(
  context: ActionContext
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { tasks: [], failed: false };
  }
  const admin = createSupabaseAdminClient();
  // Open challenges are the scarce signal — load them first, then only their
  // dispatches; the organization's total dispatch volume never matters here.
  const { data: openChallenges, error: challengeError } = await admin
    .from('planning_dispatch_acknowledgements')
    .select('id, dispatch_id, revision_id, employee_record_id, reason, created_at')
    .eq('organization_id', context.orgId)
    .eq('state', 'challenged')
    .is('challenge_resolved_at', null)
    .order('created_at', { ascending: true })
    .limit(501);
  if (challengeError || (openChallenges?.length ?? 0) > 500) {
    console.error('Failed to load open dispatch challenges:', {
      code: challengeError?.code ?? 'overflow',
    });
    return { tasks: [], failed: true };
  }
  if (!openChallenges?.length) return { tasks: [], failed: false };

  const challengeDispatchIds = [
    ...new Set(openChallenges.map((challenge) => challenge.dispatch_id)),
  ];
  const { data: dispatches, error: dispatchError } = await admin
    .from('planning_dispatches')
    .select('id, occurrence_id, job_id, current_revision_id')
    .eq('organization_id', context.orgId)
    .eq('status', 'active')
    .in('id', challengeDispatchIds);
  if (dispatchError) {
    console.error('Failed to load dispatches for challenges:', {
      code: dispatchError.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  const currentRevisionByDispatch = new Map(
    (dispatches ?? []).map((dispatch) => [
      dispatch.id,
      dispatch.current_revision_id,
    ])
  );
  // Only challenges on the CURRENT revision of an active dispatch are open
  // manager work; superseded ones were already resolved transactionally.
  const challenges = openChallenges.filter(
    (challenge) =>
      currentRevisionByDispatch.get(challenge.dispatch_id) ===
      challenge.revision_id
  );
  if (!challenges.length) return { tasks: [], failed: false };

  const recordIds = [
    ...new Set(challenges.map((challenge) => challenge.employee_record_id)),
  ];
  const recordsResult = await admin
    .from('employee_records')
    .select('id, user_id, first_name, last_name')
    .eq('organization_id', context.orgId)
    .in('id', recordIds);
  if (recordsResult.error) {
    console.error('Failed to load challenge records:', {
      code: recordsResult.error.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  const userIds = (recordsResult.data ?? []).flatMap((row) =>
    row.user_id ? [row.user_id] : []
  );
  const profilesResult = userIds.length
    ? await admin
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', userIds)
    : { data: [], error: null };
  if (profilesResult.error) {
    console.error('Failed to load challenge profiles:', {
      code: profilesResult.error.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  const profileById = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile])
  );
  const nameByRecordId = new Map(
    (recordsResult.data ?? []).map((row) => [
      row.id,
      (row.user_id && profileById.get(row.user_id)
        ? formatProfileName(profileById.get(row.user_id)!)
        : null) ||
        [row.first_name, row.last_name].filter(Boolean).join(' ') ||
        'Unbenannt',
    ])
  );

  // Resolve the challenged dispatch's job title for context.
  const dispatchById = new Map(
    (dispatches ?? []).map((dispatch) => [dispatch.id, dispatch])
  );
  const occurrenceIds = [
    ...new Set(
      challenges.flatMap((challenge) => {
        const dispatch = dispatchById.get(challenge.dispatch_id);
        return dispatch?.occurrence_id ? [dispatch.occurrence_id] : [];
      })
    ),
  ];
  const occurrencesResult = occurrenceIds.length
    ? await admin
        .from('planning_occurrences')
        .select('id, job_id')
        .eq('organization_id', context.orgId)
        .in('id', occurrenceIds)
    : { data: [], error: null };
  if (occurrencesResult.error) {
    console.error('Failed to load challenge occurrences:', {
      code: occurrencesResult.error.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  const occurrenceJobIds = new Map(
    (occurrencesResult.data ?? []).map((row) => [row.id, row.job_id])
  );
  const jobIds = [
    ...new Set(
      challenges.flatMap((challenge) => {
        const dispatch = dispatchById.get(challenge.dispatch_id);
        const jobId =
          dispatch?.job_id ??
          (dispatch?.occurrence_id
            ? (occurrenceJobIds.get(dispatch.occurrence_id) ?? null)
            : null);
        return jobId ? [jobId] : [];
      })
    ),
  ];
  const jobsResult = jobIds.length
    ? await admin
        .from('jobs')
        .select('id, title, description')
        .eq('organization_id', context.orgId)
        .in('id', jobIds)
    : { data: [], error: null };
  if (jobsResult.error) {
    console.error('Failed to load challenge jobs:', {
      code: jobsResult.error.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  const jobs = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));

  const tasks: AttentionTask[] = challenges.map((challenge) => {
    const dispatch = dispatchById.get(challenge.dispatch_id);
    const jobId =
      dispatch?.job_id ??
      (dispatch?.occurrence_id
        ? (occurrenceJobIds.get(dispatch.occurrence_id) ?? null)
        : null);
    const job = jobId ? jobs.get(jobId) : null;
    return {
      sourceType: 'dispatch_challenge_open',
      // The challenge row is the item identity: two concurrent challenges on
      // one dispatch must stay two distinct manager tasks after deduplication.
      sourceId: challenge.id,
      personName: nameByRecordId.get(challenge.employee_record_id) ?? 'Unbenannt',
      reason: challenge.reason ?? '',
      jobTitle: job?.title.trim() || job?.description?.trim() || 'Auftrag',
      acknowledgementId: challenge.id,
      stateVersion: challenge.id,
    };
  });
  return { tasks, failed: false };
}

async function deriveParkingReviewTasks(
  context: ActionContext
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { tasks: [], failed: false };
  }
  const admin = createSupabaseAdminClient();
  const businessToday = getBusinessTodayIso();
  // Bounded, deterministically ordered: the 200 most overdue reviews surface;
  // an unusually large backlog truncates instead of failing the whole
  // attention overview (failed stays reserved for real query errors).
  const { data: contexts, error: contextError } = await admin
    .from('job_parking_contexts')
    .select('job_id, next_review_date, responsible_employee_record_id')
    .eq('organization_id', context.orgId)
    .lte('next_review_date', businessToday)
    .order('next_review_date', { ascending: true })
    .order('job_id', { ascending: true })
    .limit(200);
  if (contextError) {
    console.error('Failed to load parking review contexts:', {
      code: contextError.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  if (!contexts?.length) return { tasks: [], failed: false };

  const jobIds = contexts.map((row) => row.job_id);
  const responsibleIds = [
    ...new Set(
      contexts.flatMap((row) =>
        row.responsible_employee_record_id
          ? [row.responsible_employee_record_id]
          : []
      )
    ),
  ];
  const [jobsResult, recordsResult] = await Promise.all([
    admin
      .from('jobs')
      .select('id, title, description, job_number, status')
      .eq('organization_id', context.orgId)
      .in('id', jobIds),
    responsibleIds.length
      ? admin
          .from('employee_records')
          .select('id, user_id, first_name, last_name')
          .eq('organization_id', context.orgId)
          .in('id', responsibleIds)
      : { data: [], error: null },
  ]);
  if (jobsResult.error || recordsResult.error) {
    console.error('Failed to load parking review references:', {
      code: (jobsResult.error ?? recordsResult.error)?.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  const userIds = (recordsResult.data ?? []).flatMap((row) =>
    row.user_id ? [row.user_id] : []
  );
  const profilesResult = userIds.length
    ? await admin
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', userIds)
    : { data: [], error: null };
  if (profilesResult.error) {
    console.error('Failed to load parking responsible profiles:', {
      code: profilesResult.error.code ?? 'unknown',
    });
    return { tasks: [], failed: true };
  }
  const profileById = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile])
  );
  const nameByRecordId = new Map(
    (recordsResult.data ?? []).map((row) => [
      row.id,
      (row.user_id && profileById.get(row.user_id)
        ? formatProfileName(profileById.get(row.user_id)!)
        : null) ||
        [row.first_name, row.last_name].filter(Boolean).join(' ') ||
        'Unbenannt',
    ])
  );
  const jobs = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));

  const tasks: AttentionTask[] = contexts.flatMap((row) => {
    const job = jobs.get(row.job_id);
    // The unpark trigger clears contexts, but guard against a race anyway.
    if (!job || job.status !== 'geparkt' || !row.next_review_date) return [];
    return [
      {
        sourceType: 'job_parking_review',
        sourceId: row.job_id,
        jobNumber: job.job_number,
        jobTitle: job.title.trim() || job.description?.trim() || 'Auftrag',
        nextReviewDate: row.next_review_date,
        responsibleName: row.responsible_employee_record_id
          ? (nameByRecordId.get(row.responsible_employee_record_id) ?? null)
          : null,
        stateVersion: `review:${row.next_review_date}`,
      },
    ];
  });
  return { tasks, failed: false };
}

// The reason belonging to a decision's current status: the cancellation
// reason for cancelled requests, otherwise the decision comment.
function resolveDecisionReason(
  status: string,
  decisionComment: string | null,
  cancellationReason: string | null
): string | null {
  return status === 'cancelled' ? cancellationReason : decisionComment;
}

async function deriveOwnNotifications(
  context: ActionContext
): Promise<{ notifications: AttentionNotification[]; failed: boolean }> {
  const admin = createSupabaseAdminClient();

  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', context.orgId)
    .eq('user_id', context.userId)
    .maybeSingle();
  if (recordError) {
    console.error('Failed to load own employee record:', recordError);
    return { notifications: [], failed: true };
  }
  if (!record) return { notifications: [], failed: false };

  const businessToday = getBusinessTodayIso();
  // Bounded window at the database: only decisions inside the surfaced
  // 60-day window are loaded (the in-memory check stays authoritative).
  const windowStart = notificationWindowStartIso(businessToday);
  const [requestsResult, readStatesResult] = await Promise.all([
    admin
      .from('vacation_requests')
      .select(
        'id, status, start_date, end_date, day_portion, decided_at, cancelled_at, decision_comment, cancellation_reason'
      )
      .eq('organization_id', context.orgId)
      .eq('employee_record_id', record.id)
      .in('status', ['approved', 'rejected', 'cancelled'])
      .or(`decided_at.gte.${windowStart},cancelled_at.gte.${windowStart}`),
    admin
      .from('attention_read_states')
      .select('source_id, state_version')
      .eq('organization_id', context.orgId)
      .eq('user_id', context.userId)
      .eq('source_type', 'vacation_decision'),
  ]);
  if (requestsResult.error || readStatesResult.error) {
    console.error(
      'Failed to load decision notifications:',
      requestsResult.error ?? readStatesResult.error
    );
    return { notifications: [], failed: true };
  }

  const readVersionBySourceId = new Map(
    (readStatesResult.data ?? []).map((row) => [
      row.source_id,
      row.state_version,
    ])
  );

  const notifications: AttentionNotification[] = [];
  for (const row of requestsResult.data ?? []) {
    const facts = resolveVacationDecisionFacts({
      status: row.status as VacationRequestStatus,
      decidedAt: row.decided_at,
      cancelledAt: row.cancelled_at,
    });
    if (!facts) continue;
    if (!isWithinNotificationWindow(facts.occurredAt, businessToday)) continue;
    notifications.push({
      sourceType: 'vacation_decision',
      sourceId: row.id,
      status: facts.status,
      startDate: row.start_date,
      endDate: row.end_date,
      dayPortion: row.day_portion as VacationDayPortion,
      comment: resolveDecisionReason(
        facts.status,
        row.decision_comment,
        row.cancellation_reason
      ),
      stateVersion: facts.stateVersion,
      occurredAt: facts.occurredAt,
      unread: isNotificationUnread(
        facts.stateVersion,
        readVersionBySourceId.get(row.id) ?? null
      ),
    });
  }

  return {
    notifications: sortNotificationsNewestFirst(
      dedupeAttentionItems(notifications)
    ),
    failed: false,
  };
}

// P1-08: sickness notices for both audiences of the privacy matrix — the
// affected person (office-recorded or office-cancelled reports on their own
// record) and admin/büro managers (reports they did not record themselves).
// One item identity per report: when both audiences apply to one viewer, the
// own-flavored item is listed first and deduplication keeps it.
async function deriveSicknessNotifications(context: ActionContext): Promise<{
  notifications: AttentionNotification[];
  failed: boolean;
}> {
  const admin = createSupabaseAdminClient();
  const isManager = context.role === 'admin' || context.role === 'buero';

  const { data: ownRecord, error: ownRecordError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', context.orgId)
    .eq('user_id', context.userId)
    .maybeSingle();
  if (ownRecordError) {
    console.error('Failed to load own record for sickness notices:', ownRecordError);
    return { notifications: [], failed: true };
  }
  const ownRecordId = ownRecord?.id ?? null;
  if (!isManager && !ownRecordId) return { notifications: [], failed: false };

  const businessToday = getBusinessTodayIso();
  // Corrections and cancellations bump updated_at, so one bound covers every
  // material change inside the surfaced window.
  const windowStart = notificationWindowStartIso(businessToday);
  let reportsQuery = admin
    .from('sickness_reports')
    .select(
      'id, employee_record_id, status, start_date, end_date, day_portion, reported_by, cancelled_by, cancelled_at, updated_at'
    )
    .eq('organization_id', context.orgId)
    .gte('updated_at', windowStart)
    // Deterministic order plus a cap keep the manager-side read bounded even
    // in a large organization; 200 recently-touched reports comfortably
    // exceeds anything a 60-day window realistically holds.
    .order('updated_at', { ascending: false })
    .limit(200);
  if (!isManager && ownRecordId) {
    reportsQuery = reportsQuery.eq('employee_record_id', ownRecordId);
  }

  const [reportsResult, readStatesResult] = await Promise.all([
    reportsQuery,
    admin
      .from('attention_read_states')
      .select('source_id, state_version')
      .eq('organization_id', context.orgId)
      .eq('user_id', context.userId)
      .eq('source_type', 'sickness_report'),
  ]);
  if (reportsResult.error || readStatesResult.error) {
    console.error(
      'Failed to load sickness notifications:',
      reportsResult.error ?? readStatesResult.error
    );
    return { notifications: [], failed: true };
  }

  const readVersionBySourceId = new Map(
    (readStatesResult.data ?? []).map((row) => [
      row.source_id,
      row.state_version,
    ])
  );

  type ReportRow = NonNullable<typeof reportsResult.data>[number];
  const rows = reportsResult.data ?? [];

  const isOwnAudience = (row: ReportRow): boolean => {
    if (!ownRecordId || row.employee_record_id !== ownRecordId) return false;
    // Own self-managed reports are no news; office involvement is.
    if (row.reported_by !== context.userId) return true;
    return row.cancelled_by !== null && row.cancelled_by !== context.userId;
  };
  const isManagerAudience = (row: ReportRow): boolean => {
    if (!isManager) return false;
    // The recording (or cancelling) manager already knows their own action.
    if (row.reported_by === context.userId && row.status === 'reported') {
      return false;
    }
    if (row.status === 'cancelled' && row.cancelled_by === context.userId) {
      return false;
    }
    return true;
  };

  const ownRows = rows.filter(isOwnAudience);
  const managerRows = rows.filter(
    (row) => isManagerAudience(row) && !isOwnAudience(row)
  );

  // Names only for manager-audience items (two-step lookup; no FK path from
  // employee_records to profiles for PostgREST embeds).
  const nameRecordIds = [
    ...new Set(managerRows.map((row) => row.employee_record_id)),
  ];
  let nameByRecordId = new Map<string, string>();
  if (nameRecordIds.length > 0) {
    const { data: records, error: recordsError } = await admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .in('id', nameRecordIds);
    if (recordsError) {
      console.error('Failed to load records for sickness notices:', recordsError);
      return { notifications: [], failed: true };
    }
    const userIds = [
      ...new Set(
        (records ?? [])
          .map((row) => row.user_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const profilesResult =
      userIds.length > 0
        ? await admin
            .from('profiles')
            .select('id, first_name, last_name, email')
            .in('id', userIds)
        : { data: [], error: null };
    if (profilesResult.error) {
      console.error(
        'Failed to load profiles for sickness notices:',
        profilesResult.error
      );
      return { notifications: [], failed: true };
    }
    const profileById = new Map(
      (profilesResult.data ?? []).map((profile) => [profile.id, profile])
    );
    nameByRecordId = new Map(
      (records ?? []).map((record) => {
        const profile = record.user_id
          ? profileById.get(record.user_id)
          : undefined;
        const name = profile
          ? formatProfileName(profile)
          : `${record.first_name ?? ''} ${record.last_name ?? ''}`.trim();
        return [record.id, name || 'Unbekannt'];
      })
    );
  }

  const toNotification = (
    row: ReportRow,
    isOwn: boolean
  ): AttentionNotification | null => {
    const facts = resolveSicknessReportFacts({
      status: row.status as 'reported' | 'cancelled',
      startDate: row.start_date,
      endDate: row.end_date,
      dayPortion: row.day_portion as VacationDayPortion,
      updatedAt: row.updated_at,
      cancelledAt: row.cancelled_at,
    });
    if (!isWithinNotificationWindow(facts.occurredAt, businessToday)) {
      return null;
    }
    return {
      sourceType: 'sickness_report',
      sourceId: row.id,
      personName: isOwn
        ? null
        : (nameByRecordId.get(row.employee_record_id) ?? 'Unbekannt'),
      isOwn,
      status: facts.status,
      startDate: row.start_date,
      endDate: row.end_date,
      dayPortion: row.day_portion as VacationDayPortion,
      stateVersion: facts.stateVersion,
      occurredAt: facts.occurredAt,
      unread: isNotificationUnread(
        facts.stateVersion,
        readVersionBySourceId.get(row.id) ?? null
      ),
    };
  };

  const notifications: AttentionNotification[] = [];
  for (const row of ownRows) {
    const notification = toNotification(row, true);
    if (notification) notifications.push(notification);
  }
  for (const row of managerRows) {
    const notification = toNotification(row, false);
    if (notification) notifications.push(notification);
  }

  return { notifications, failed: false };
}

async function deriveCertificationExpiryNotifications(
  context: ActionContext
): Promise<{ notifications: AttentionNotification[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { notifications: [], failed: false };
  }
  const admin = createSupabaseAdminClient();
  const noticesResult = await loadCertificationExpiryNotifications({
    admin,
    orgId: context.orgId,
  });
  if (noticesResult.failed || noticesResult.notices.length === 0) {
    return { notifications: [], failed: noticesResult.failed };
  }
  const readStatesResult = await admin
    .from('attention_read_states')
    .select('source_id, state_version')
    .eq('organization_id', context.orgId)
    .eq('user_id', context.userId)
    .eq('source_type', 'employee_certification_expiry')
    .in('source_id', noticesResult.notices.map((notice) => notice.sourceId));
  if (noticesResult.failed || readStatesResult.error) {
    console.error(
      'Failed to load certification attention read states:',
      readStatesResult.error
    );
    return { notifications: [], failed: true };
  }
  const readVersionBySourceId = new Map(
    (readStatesResult.data ?? []).map((row) => [
      row.source_id,
      row.state_version,
    ])
  );
  return {
    notifications: noticesResult.notices.map((notice) => ({
      sourceType: 'employee_certification_expiry',
      sourceId: notice.sourceId,
      employeeRecordId: notice.employeeRecordId,
      personName: notice.employeeName,
      capabilityName: notice.capabilityName,
      validUntil: notice.validUntil,
      phase: notice.phase,
      stateVersion: notice.stateVersion,
      occurredAt: notice.occurredAt,
      unread: isNotificationUnread(
        notice.stateVersion,
        readVersionBySourceId.get(notice.sourceId) ?? null
      ),
    })),
    failed: false,
  };
}

// ============================================
// Overview and counts
// ============================================

export type AttentionOverviewResult =
  | { success: true; overview: AttentionOverview }
  | { success: false; error: string };

export async function getAttentionOverview(): Promise<AttentionOverviewResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { context } = auth;

    const [
      approvals,
      openRequests,
      followUps,
      dispatchAcknowledgements,
      dispatchChallenges,
      parkingReviews,
      notifications,
      sicknessNotifications,
      certificationNotifications,
      ownOverviewResult,
    ] = await Promise.all([
      deriveApprovalTasks(context),
      deriveOpenRequestTasks(context),
      deriveFollowUpTasks(context),
      deriveDispatchAcknowledgementTasks(context),
      deriveDispatchChallengeTasks(context),
      deriveParkingReviewTasks(context),
      deriveOwnNotifications(context),
      deriveSicknessNotifications(context),
      deriveCertificationExpiryNotifications(context),
      getOwnVacationOverview(),
    ]);

    // A partially failed derivation must be visible, never a silently
    // shortened list that reads as "nothing to do".
    if (
      approvals.failed ||
      openRequests.failed ||
      followUps.failed ||
      dispatchAcknowledgements.failed ||
      dispatchChallenges.failed ||
      parkingReviews.failed ||
      notifications.failed ||
      sicknessNotifications.failed ||
      certificationNotifications.failed ||
      !ownOverviewResult.success
    ) {
      return { success: false, error: 'load_failed' };
    }

    const ownRequests: OwnAttentionRequest[] =
      ownOverviewResult.overview.requests.map((request) => ({
        sourceId: request.id,
        startDate: request.startDate,
        endDate: request.endDate,
        dayPortion: request.dayPortion,
        status: request.status,
        totalDays: request.totalDays,
        decisionReason: resolveDecisionReason(
          request.status,
          request.decisionComment,
          request.cancellationReason
        ),
      }));

    return {
      success: true,
      overview: {
        businessDate: getBusinessTodayIso(),
        tasks: dedupeAttentionItems([
          ...approvals.tasks,
          ...openRequests.tasks,
          ...followUps.tasks,
          ...dispatchAcknowledgements.tasks,
          ...dispatchChallenges.tasks,
          ...parkingReviews.tasks,
        ]),
        notifications: sortNotificationsNewestFirst(
          dedupeAttentionItems([
            ...notifications.notifications,
            ...sicknessNotifications.notifications,
            ...certificationNotifications.notifications,
          ])
        ),
        ownRequests,
      },
    };
  } catch (error) {
    console.error('Unexpected error in getAttentionOverview:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type AttentionCountsResult =
  | { success: true; counts: AttentionCounts }
  | { success: false; error: string };

/**
 * Unified badge counts. Uses the same derivation as the overview so the badge
 * can never count an item its viewer cannot act on. The expensive loaders all
 * early-return when their pending sets are empty, which is the steady state.
 */
export async function getAttentionCounts(): Promise<AttentionCountsResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { context } = auth;

    const [
      approvals,
      openRequests,
      followUps,
      dispatchAcknowledgements,
      dispatchChallenges,
      parkingReviews,
      notifications,
      sicknessNotifications,
      certificationNotifications,
    ] =
      await Promise.all([
        deriveApprovalTasks(context),
        deriveOpenRequestTasks(context),
        deriveFollowUpTasks(context),
        deriveDispatchAcknowledgementTasks(context),
        deriveDispatchChallengeTasks(context),
        deriveParkingReviewTasks(context),
        deriveOwnNotifications(context),
        deriveSicknessNotifications(context),
        deriveCertificationExpiryNotifications(context),
      ]);
    if (
      approvals.failed ||
      openRequests.failed ||
      followUps.failed ||
      dispatchAcknowledgements.failed ||
      dispatchChallenges.failed ||
      parkingReviews.failed ||
      notifications.failed ||
      sicknessNotifications.failed
      || certificationNotifications.failed
    ) {
      return { success: false, error: 'load_failed' };
    }

    const approvalTasks = dedupeAttentionItems(approvals.tasks);
    const requestTasks = dedupeAttentionItems(openRequests.tasks);
    const followUpTasks = dedupeAttentionItems(followUps.tasks);
    const dispatchTasks = dedupeAttentionItems([
      ...dispatchAcknowledgements.tasks,
      ...dispatchChallenges.tasks,
      ...parkingReviews.tasks,
    ]);
    const allNotifications = dedupeAttentionItems([
      ...notifications.notifications,
      ...sicknessNotifications.notifications,
      ...certificationNotifications.notifications,
    ]);
    return {
      success: true,
      counts: {
        approvalsCount: approvalTasks.length,
        actionableCount:
          approvalTasks.length +
          requestTasks.length +
          followUpTasks.length +
          dispatchTasks.length,
        unreadNotificationCount: allNotifications.filter(
          (notification) => notification.unread
        ).length,
      },
    };
  } catch (error) {
    console.error('Unexpected error in getAttentionCounts:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Read markers (the only pattern-level writes)
// ============================================

export type MarkNotificationReadResult =
  | { success: true }
  | { success: false; error: string };

type ReadableNotificationSourceType =
  | 'vacation_decision'
  | 'sickness_report'
  | 'employee_certification_expiry';

async function persistNotificationReadMarker(
  context: ActionContext,
  input: {
    sourceType: ReadableNotificationSourceType;
    sourceId: string;
    stateVersion: string;
  }
): Promise<MarkNotificationReadResult> {
  const admin = createSupabaseAdminClient();

  if (input.sourceType === 'vacation_decision') {
    // Self-only: the notification's request must belong to the caller's own
    // employee record in the active organization.
    const { data: request, error: requestError } = await admin
      .from('vacation_requests')
      .select('id, employee_record_id, organization_id')
      .eq('organization_id', context.orgId)
      .eq('id', input.sourceId)
      .maybeSingle();
    if (requestError) {
      console.error('Failed to load request for read marker:', requestError);
      return { success: false, error: 'update_failed' };
    }
    if (!request) return { success: false, error: 'request_not_found' };

    const { data: record, error: recordError } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', context.orgId)
      .eq('user_id', context.userId)
      .maybeSingle();
    if (recordError) {
      console.error('Failed to load own record for read marker:', recordError);
      return { success: false, error: 'update_failed' };
    }
    if (!record || record.id !== request.employee_record_id) {
      return { success: false, error: 'not_authorized' };
    }
  } else if (input.sourceType === 'sickness_report') {
    // Sickness notices have two audiences (privacy matrix): the affected
    // person and admin/büro managers. Either may mark their own copy read.
    const { data: report, error: reportError } = await admin
      .from('sickness_reports')
      .select('id, employee_record_id, organization_id')
      .eq('organization_id', context.orgId)
      .eq('id', input.sourceId)
      .maybeSingle();
    if (reportError) {
      console.error('Failed to load report for read marker:', reportError);
      return { success: false, error: 'update_failed' };
    }
    if (!report) return { success: false, error: 'request_not_found' };

    const isManager = context.role === 'admin' || context.role === 'buero';
    if (!isManager) {
      const { data: record, error: recordError } = await admin
        .from('employee_records')
        .select('id')
        .eq('organization_id', context.orgId)
        .eq('user_id', context.userId)
        .maybeSingle();
      if (recordError) {
        console.error('Failed to load own record for read marker:', recordError);
        return { success: false, error: 'update_failed' };
      }
      if (!record || record.id !== report.employee_record_id) {
        return { success: false, error: 'not_authorized' };
      }
    }
  } else {
    const isManager = context.role === 'admin' || context.role === 'buero';
    if (!isManager) return { success: false, error: 'not_authorized' };
    const { data: certification, error: certificationError } = await admin
      .from('employee_capabilities')
      .select('id')
      .eq('organization_id', context.orgId)
      .eq('id', input.sourceId)
      .eq('capability_kind', 'certification')
      .maybeSingle();
    if (certificationError) {
      console.error(
        'Failed to load certification for read marker:',
        certificationError
      );
      return { success: false, error: 'update_failed' };
    }
    if (!certification) return { success: false, error: 'request_not_found' };
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await admin
    .from('attention_read_states')
    .upsert(
      {
        organization_id: context.orgId,
        user_id: context.userId,
        source_type: input.sourceType,
        source_id: input.sourceId,
        state_version: input.stateVersion,
        read_at: now,
        updated_at: now,
      },
      { onConflict: 'organization_id,user_id,source_type,source_id' }
    );
  if (upsertError) {
    console.error('Failed to upsert attention read state:', upsertError);
    return { success: false, error: 'update_failed' };
  }

  const { error: eventError } = await admin.from('attention_events').insert({
    organization_id: context.orgId,
    user_id: context.userId,
    source_type: input.sourceType,
    source_id: input.sourceId,
    event_type: 'marked_read',
    event_payload: { state_version: input.stateVersion },
  });
  if (eventError) {
    // The marker itself persisted; the missing audit row must not present as
    // a failed user action, but it must be visible in the logs.
    console.error('Failed to record attention event:', eventError);
  }

  return { success: true };
}

export async function markAttentionNotificationRead(input: {
  sourceType: ReadableNotificationSourceType;
  sourceId: string;
  stateVersion: string;
}): Promise<MarkNotificationReadResult> {
  try {
    if (
      typeof input.sourceId !== 'string' ||
      typeof input.stateVersion !== 'string' ||
      input.stateVersion.length === 0 ||
      input.stateVersion.length > 200 ||
      (input.sourceType !== 'vacation_decision' &&
        input.sourceType !== 'sickness_report' &&
        input.sourceType !== 'employee_certification_expiry')
    ) {
      return { success: false, error: 'invalid_input' };
    }

    const auth = await resolveActionContext();
    if (!auth.success) return auth;

    // The stored version is exactly what the user saw. If the domain state
    // moved on in the meantime, the item legitimately stays unread for the
    // newer version — read markers never overwrite unseen state.
    return await persistNotificationReadMarker(auth.context, input);
  } catch (error) {
    console.error('Unexpected error in markAttentionNotificationRead:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function markAllAttentionNotificationsRead(): Promise<MarkNotificationReadResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { context } = auth;

    // Ownership is established once by derivation: the derivations only ever
    // return notifications this viewer may see (own decisions; sickness
    // notices per the privacy-matrix audiences), so the per-item validation
    // of the single-item path is redundant here and the writes can be two
    // batched statements instead of a sequential per-item loop that could
    // stop halfway.
    const [derived, derivedSickness, derivedCertification] = await Promise.all([
      deriveOwnNotifications(context),
      deriveSicknessNotifications(context),
      deriveCertificationExpiryNotifications(context),
    ]);
    if (
      derived.failed ||
      derivedSickness.failed ||
      derivedCertification.failed
    ) {
      return { success: false, error: 'load_failed' };
    }

    const unread = dedupeAttentionItems([
      ...derived.notifications,
      ...derivedSickness.notifications,
      ...derivedCertification.notifications,
    ]).filter((notification) => notification.unread);
    if (unread.length === 0) return { success: true };

    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const { error: upsertError } = await admin
      .from('attention_read_states')
      .upsert(
        unread.map((notification) => ({
          organization_id: context.orgId,
          user_id: context.userId,
          source_type: notification.sourceType,
          source_id: notification.sourceId,
          state_version: notification.stateVersion,
          read_at: now,
          updated_at: now,
        })),
        { onConflict: 'organization_id,user_id,source_type,source_id' }
      );
    if (upsertError) {
      console.error('Failed to upsert attention read states:', upsertError);
      return { success: false, error: 'update_failed' };
    }

    const { error: eventError } = await admin.from('attention_events').insert(
      unread.map((notification) => ({
        organization_id: context.orgId,
        user_id: context.userId,
        source_type: notification.sourceType,
        source_id: notification.sourceId,
        event_type: 'marked_read',
        event_payload: {
          state_version: notification.stateVersion,
          via: 'mark_all',
        },
      }))
    );
    if (eventError) {
      // The markers themselves persisted; the missing audit rows must not
      // present as a failed user action, but must be visible in the logs.
      console.error('Failed to record attention events:', eventError);
    }

    return { success: true };
  } catch (error) {
    console.error(
      'Unexpected error in markAllAttentionNotificationsRead:',
      error
    );
    return { success: false, error: 'unexpected_error' };
  }
}

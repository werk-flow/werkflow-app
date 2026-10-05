'use server';

// P1-07: the shared attention pattern's server boundary.
//
// Attention items are DERIVED from the owning domains through their own
// loaders — the exact queries and authorization paths that power the existing
// surfaces (Anträge tab, /anfragen). This module never stores or mutates
// domain state: deciding an item happens on the owning surface through the
// owning action. The only writes here are per-user read markers and
// append-only pattern events, keyed by the item identity.

import type { ActionResult } from '@/lib/action-result';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { resolveActionContext, type ActionContext } from '@/lib/org/action-context';
import { getBusinessTodayIso, toBusinessIsoDate } from '@/lib/personnel/types';
import { formatProfileName } from '@/lib/members/profile-name';
import { getPendingChangeRequests, getPendingSessions } from '@/lib/time-tracking/actions';
import { getTimeCorrectionRequests } from '@/lib/time-corrections/actions';
import { TIME_CORRECTION_KIND_LABELS } from '@/lib/time-corrections/types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { getOwnVacationOverview, getPendingVacationRequestsForApprover } from '@/lib/vacation/actions';
import type { VacationDayPortion, VacationRequestStatus } from '@/lib/vacation/types';
import type { RequestStatus, RequestUrgency } from '@/lib/requests/types';
import { loadCertificationExpiryNotifications } from '@/lib/qualifications/server';
import { readPendingJoinRequests } from '@/lib/org/join-requests';
import { deriveWorkArtifactTasks, deriveWorkHandoverTasks } from './work-tasks';
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

// ============================================
// Derivation building blocks
// ============================================

async function deriveApprovalTasks(
  context: ActionContext,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  const tasks: AttentionTask[] = [];
  let failed = false;
  // Independent authorized readers share no intermediate result. Run them
  // together so badges do not queue four database round trips before counting.
  const [sessionsResult, changeRequestsResult, correctionsResult, vacationResult] = await Promise.all([
    getPendingSessions(context.orgId),
    context.role === 'admin'
      ? getPendingChangeRequests(context.orgId)
      : Promise.resolve({ success: true as const, requests: [] }),
    getTimeCorrectionRequests(context.orgId, 'approvals'),
    getPendingVacationRequestsForApprover(),
  ]);

  // Pending time sessions: getPendingSessions resolves the caller's
  // time_approval responsibility itself and returns [] for non-holders.
  if (sessionsResult.success) {
    for (const session of sessionsResult.sessions) {
      tasks.push({
        sourceType: 'time_session_approval',
        sourceId: session.id,
        personName: [session.firstName, session.lastName].filter(Boolean).join(' ') || 'Unbekannt',
        date: session.date,
        jobTitle: session.jobTitle,
      });
    }
  } else {
    failed = true;
  }

  // Pending change requests remain the admin recovery surface (P1-05).
  if (context.role === 'admin') {
    if (changeRequestsResult.success) {
      for (const request of changeRequestsResult.requests) {
        tasks.push({
          sourceType: 'time_change_request_approval',
          sourceId: request.id,
          personName:
            [request.requesterFirstName, request.requesterLastName].filter(Boolean).join(' ') || 'Unbekannt',
          requestType: request.changeType === 'delete' ? 'delete' : 'edit',
        });
      }
    } else {
      failed = true;
    }
  }

  if (correctionsResult.success) {
    for (const request of correctionsResult.requests) {
      if (!request.canReview || request.status !== 'submitted') continue;
      tasks.push({
        sourceType: 'time_correction_approval',
        sourceId: request.id,
        personName: request.subjectName,
        correctionLabel: TIME_CORRECTION_KIND_LABELS[request.kind],
        stateVersion: String(request.currentRevision),
      });
    }
  } else {
    failed = true;
  }

  // Pending vacation requests: the approver loader filters per target through
  // leave_approval at derivation time (four eyes included).
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
  context: ActionContext,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  // Open client requests are an office surface; employees never see them.
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { tasks: [], failed: false };
  }

  const admin = createSupabaseAdminClient();
  const { data: rows, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('client_requests')
        .select('id, request_number, summary, status, urgency, assigned_to, received_at')
        .eq('organization_id', context.orgId)
        .in('status', ['offen', 'in_klaerung'])
        .order('received_at', { ascending: true })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logError('Failed to load open client requests', error);
    return { tasks: [], failed: true };
  }

  const assigneeIds = [
    ...new Set((rows ?? []).map((row) => row.assigned_to).filter((id): id is string => Boolean(id))),
  ];
  const profilesResult = await readInBatches(assigneeIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logError('Failed to load request assignee profiles', profilesResult.error);
    return { tasks: [], failed: true };
  }
  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));

  const businessToday = getBusinessTodayIso();
  const tasks: AttentionTask[] = (rows ?? []).map((row) => {
    const assignee = row.assigned_to ? (profileById.get(row.assigned_to) ?? null) : null;
    return {
      sourceType: 'client_request_open',
      sourceId: row.id,
      requestNumber: row.request_number,
      summary: row.summary,
      status: row.status as RequestStatus,
      urgency: row.urgency as RequestUrgency,
      receivedAt: row.received_at,
      openSinceDays: computeOpenSinceDays(toBusinessIsoDate(new Date(row.received_at)), businessToday),
      assigneeName: assignee ? formatProfileName(assignee) : null,
      assignedToMe: row.assigned_to === context.userId,
    };
  });

  return { tasks, failed: false };
}

async function deriveFollowUpTasks(
  context: ActionContext,
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
    logError('Failed to load follow-up attention tasks', membershipsResult.error);
    return { tasks: [], failed: true };
  }
  const activeManagerIds = new Set((membershipsResult.data ?? []).map((membership) => membership.user_id));
  // The visibility rule (own follow-ups plus those of owners who are no longer
  // managers) runs in memory in selectFollowUpAttentionRows: a `not.in` string
  // of every manager id would grow with the organization past the URL limit.
  const followUpsResult = await readCompleteRows(
    (from, to) =>
      admin
        .from('client_follow_ups')
        .select('id,client_id,title,due_at,owner_user_id')
        .eq('organization_id', context.orgId)
        .eq('status', 'open')
        .lte('due_at', dueWindowEnd.toISOString())
        .order('due_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (followUpsResult.error) {
    logError('Failed to load follow-up attention tasks', followUpsResult.error);
    return { tasks: [], failed: true };
  }
  const selection = selectFollowUpAttentionRows(
    context.role,
    context.userId,
    followUpsResult.data,
    activeManagerIds,
    FOLLOW_UP_ATTENTION_CAPACITY,
  );
  if (selection.capacityExceeded) {
    logReadFailure('deriveFollowUpTasks: follow-up window exceeded its capacity', {
      code: 'follow_up_capacity_exceeded',
    });
    return { tasks: [], failed: true };
  }
  const visibleRows = selection.rows;
  if (visibleRows.length === 0) return { tasks: [], failed: false };

  const clientIds = [...new Set(visibleRows.map((row) => row.client_id))];
  const ownerIds = [...new Set(visibleRows.map((row) => row.owner_user_id))];
  const [clientsResult, profilesResult] = await Promise.all([
    readInBatches(clientIds, (batch) =>
      admin
        .from('clients')
        .select('id,name')
        .eq('organization_id', context.orgId)
        .in('id', [...batch]),
    ),
    readInBatches(ownerIds, (batch) =>
      admin
        .from('profiles')
        .select('id,first_name,last_name,email')
        .in('id', [...batch]),
    ),
  ]);
  if (clientsResult.error || profilesResult.error) {
    logError('Failed to resolve follow-up attention references', clientsResult.error ?? profilesResult.error);
    return { tasks: [], failed: true };
  }

  const clientNameById = new Map((clientsResult.data ?? []).map((client) => [client.id, client.name]));
  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const tasks: AttentionTask[] = [];
  for (const row of visibleRows) {
    const clientName = clientNameById.get(row.client_id);
    if (!clientName) {
      logError('Follow-up attention task has no accessible customer');
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

// Open join requests are decided by Admin and Büro in the Mitarbeiter area.
async function deriveJoinRequestTasks(
  context: ActionContext,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { tasks: [], failed: false };
  }
  const result = await readPendingJoinRequests(context.orgId);
  if (!result.success) return { tasks: [], failed: true };
  return {
    tasks: result.requests.map((request) => ({
      sourceType: 'organization_join_request',
      sourceId: request.id,
      personName: request.name,
      email: request.email,
    })),
    failed: false,
  };
}

// P1-12: dispatch attention. Items are projections over the owning dispatch
// rows; deciding happens through the dispatch actions, never here.

async function deriveDispatchAcknowledgementTasks(
  context: ActionContext,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', context.orgId)
    .eq('user_id', context.userId)
    .maybeSingle();
  if (recordError) {
    logError('Failed to load own record for dispatch tasks', recordError);
    return { tasks: [], failed: true };
  }
  if (!record) return { tasks: [], failed: false };

  // Scope to the viewer from the start: their recipient rows, then only the
  // referenced revisions/dispatches. An unrelated large dispatch volume can
  // never turn this viewer's attention into a failure.
  const { data: myRecipients, error: recipientError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('planning_dispatch_recipients')
        .select('revision_id, dispatch_id')
        .eq('organization_id', context.orgId)
        .eq('employee_record_id', record.id)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (recipientError) {
    logError('Failed to load dispatch recipients for tasks', recipientError);
    return { tasks: [], failed: true };
  }
  if (!myRecipients.length) return { tasks: [], failed: false };
  const myDispatchIds = [...new Set(myRecipients.map((row) => row.dispatch_id))];
  const myRevisionIds = new Set(myRecipients.map((row) => row.revision_id));

  const { data: dispatches, error: dispatchError } = await readInBatches(myDispatchIds, (batch) =>
    admin
      .from('planning_dispatches')
      .select('id, occurrence_id, job_id, current_revision_id')
      .eq('organization_id', context.orgId)
      .eq('status', 'active')
      .in('id', [...batch]),
  );
  if (dispatchError) {
    logError('Failed to load dispatches for tasks', dispatchError);
    return { tasks: [], failed: true };
  }
  const currentRevisionIds = (dispatches ?? []).flatMap((dispatch) =>
    dispatch.current_revision_id && myRevisionIds.has(dispatch.current_revision_id)
      ? [dispatch.current_revision_id]
      : [],
  );
  if (!currentRevisionIds.length) return { tasks: [], failed: false };

  const [acksResult, revisionsResult] = await Promise.all([
    readInBatches(currentRevisionIds, (batch) =>
      admin
        .from('planning_dispatch_acknowledgements')
        .select('id, revision_id, employee_record_id, state, reason, challenge_resolved_at, created_at')
        .eq('organization_id', context.orgId)
        .eq('employee_record_id', record.id)
        .in('revision_id', [...batch]),
    ),
    readInBatches(currentRevisionIds, (batch) =>
      admin
        .from('planning_dispatch_revisions')
        .select(
          'id, dispatch_id, revision_number, occurrence_id, job_id, planned_start_at, planned_start_date',
        )
        .eq('organization_id', context.orgId)
        .in('id', [...batch]),
    ),
  ]);
  if (acksResult.error || revisionsResult.error) {
    logError('Failed to load dispatch task facts', acksResult.error ?? revisionsResult.error);
    return { tasks: [], failed: true };
  }
  const revisionById = new Map((revisionsResult.data ?? []).map((row) => [row.id, row]));

  const occurrenceIds = [...revisionById.values()].flatMap((row) =>
    row.occurrence_id ? [row.occurrence_id] : [],
  );
  const occurrencesResult = await readInBatches(occurrenceIds, (batch) =>
    admin
      .from('planning_occurrences')
      .select('id, job_id')
      .eq('organization_id', context.orgId)
      .in('id', [...batch]),
  );
  if (occurrencesResult.error) {
    logError('Failed to load dispatch occurrences', occurrencesResult.error);
    return { tasks: [], failed: true };
  }
  const occurrenceJobIds = new Map((occurrencesResult.data ?? []).map((row) => [row.id, row.job_id]));
  const jobIds = [
    ...new Set([
      ...[...revisionById.values()].flatMap((row) => (row.job_id ? [row.job_id] : [])),
      ...[...occurrenceJobIds.values()].filter((id): id is string => Boolean(id)),
    ]),
  ];
  const jobsResult = await readInBatches(jobIds, (batch) =>
    admin
      .from('jobs')
      .select('id, title, description, job_number')
      .eq('organization_id', context.orgId)
      .in('id', [...batch]),
  );
  if (jobsResult.error) {
    logError('Failed to load dispatch jobs', jobsResult.error);
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
      latestAcknowledgementByRecipient(ackFactsByRevision.get(revision.id) ?? []).get(record.id) ?? null;
    const state = deriveRecipientState({ hasLogin: true, latest });
    if (!isAcknowledgementPending(state)) continue;
    const jobId =
      revision.job_id ??
      (revision.occurrence_id ? (occurrenceJobIds.get(revision.occurrence_id) ?? null) : null);
    if (!jobId) continue;
    const job = jobs.get(jobId);
    tasks.push({
      sourceType: 'dispatch_acknowledgement',
      sourceId: dispatch.id,
      jobId,
      jobNumber: job?.job_number ?? null,
      jobTitle: job?.title.trim() || job?.description?.trim() || 'Auftrag',
      revisionNumber: revision.revision_number,
      startAt: revision.planned_start_at,
      startDate: revision.planned_start_date,
      stateVersion: revision.id,
    });
  }
  return { tasks, failed: false };
}

async function deriveDispatchChallengeTasks(
  context: ActionContext,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { tasks: [], failed: false };
  }
  const admin = createSupabaseAdminClient();
  // Open challenges are the scarce signal — load them first, then only their
  // dispatches; the organization's total dispatch volume never matters here.
  const { data: openChallenges, error: challengeError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('planning_dispatch_acknowledgements')
        .select('id, dispatch_id, revision_id, employee_record_id, reason, created_at')
        .eq('organization_id', context.orgId)
        .eq('state', 'challenged')
        .is('challenge_resolved_at', null)
        .order('created_at', { ascending: true })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (challengeError) {
    logError('Failed to load open dispatch challenges', challengeError);
    return { tasks: [], failed: true };
  }
  if (!openChallenges.length) return { tasks: [], failed: false };

  const challengeDispatchIds = [...new Set(openChallenges.map((challenge) => challenge.dispatch_id))];
  const { data: dispatches, error: dispatchError } = await readInBatches(challengeDispatchIds, (batch) =>
    admin
      .from('planning_dispatches')
      .select('id, occurrence_id, job_id, current_revision_id')
      .eq('organization_id', context.orgId)
      .eq('status', 'active')
      .in('id', [...batch]),
  );
  if (dispatchError) {
    logError('Failed to load dispatches for challenges', dispatchError);
    return { tasks: [], failed: true };
  }
  const currentRevisionByDispatch = new Map(
    (dispatches ?? []).map((dispatch) => [dispatch.id, dispatch.current_revision_id]),
  );
  // Only challenges on the CURRENT revision of an active dispatch are open
  // manager work; superseded ones were already resolved transactionally.
  const challenges = openChallenges.filter(
    (challenge) => currentRevisionByDispatch.get(challenge.dispatch_id) === challenge.revision_id,
  );
  if (!challenges.length) return { tasks: [], failed: false };

  const recordIds = [...new Set(challenges.map((challenge) => challenge.employee_record_id))];
  const recordsResult = await readInBatches(recordIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', context.orgId)
      .in('id', [...batch]),
  );
  if (recordsResult.error) {
    logError('Failed to load challenge records', recordsResult.error);
    return { tasks: [], failed: true };
  }
  const userIds = (recordsResult.data ?? []).flatMap((row) => (row.user_id ? [row.user_id] : []));
  const profilesResult = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logError('Failed to load challenge profiles', profilesResult.error);
    return { tasks: [], failed: true };
  }
  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const nameByRecordId = new Map(
    (recordsResult.data ?? []).map((row) => {
      const profile = row.user_id ? profileById.get(row.user_id) : undefined;
      return [
        row.id,
        (profile ? formatProfileName(profile) : null) ||
          [row.first_name, row.last_name].filter(Boolean).join(' ') ||
          'Unbenannt',
      ];
    }),
  );

  // Resolve the challenged dispatch's job title for context.
  const dispatchById = new Map((dispatches ?? []).map((dispatch) => [dispatch.id, dispatch]));
  const occurrenceIds = [
    ...new Set(
      challenges.flatMap((challenge) => {
        const dispatch = dispatchById.get(challenge.dispatch_id);
        return dispatch?.occurrence_id ? [dispatch.occurrence_id] : [];
      }),
    ),
  ];
  const occurrencesResult = await readInBatches(occurrenceIds, (batch) =>
    admin
      .from('planning_occurrences')
      .select('id, job_id')
      .eq('organization_id', context.orgId)
      .in('id', [...batch]),
  );
  if (occurrencesResult.error) {
    logError('Failed to load challenge occurrences', occurrencesResult.error);
    return { tasks: [], failed: true };
  }
  const occurrenceJobIds = new Map((occurrencesResult.data ?? []).map((row) => [row.id, row.job_id]));
  const jobIds = [
    ...new Set(
      challenges.flatMap((challenge) => {
        const dispatch = dispatchById.get(challenge.dispatch_id);
        const jobId =
          dispatch?.job_id ??
          (dispatch?.occurrence_id ? (occurrenceJobIds.get(dispatch.occurrence_id) ?? null) : null);
        return jobId ? [jobId] : [];
      }),
    ),
  ];
  const jobsResult = await readInBatches(jobIds, (batch) =>
    admin
      .from('jobs')
      .select('id, title, description')
      .eq('organization_id', context.orgId)
      .in('id', [...batch]),
  );
  if (jobsResult.error) {
    logError('Failed to load challenge jobs', jobsResult.error);
    return { tasks: [], failed: true };
  }
  const jobs = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));

  const tasks: AttentionTask[] = challenges.map((challenge) => {
    const dispatch = dispatchById.get(challenge.dispatch_id);
    const jobId =
      dispatch?.job_id ??
      (dispatch?.occurrence_id ? (occurrenceJobIds.get(dispatch.occurrence_id) ?? null) : null);
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
  context: ActionContext,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { tasks: [], failed: false };
  }
  const admin = createSupabaseAdminClient();
  const businessToday = getBusinessTodayIso();
  // Complete and deterministically ordered: every due review surfaces.
  const { data: contexts, error: contextError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('work_blockers')
        .select(
          'id, job_id, project_id, instruction_item_id, kind, next_review_date, responsible_employee_record_id, version',
        )
        .eq('organization_id', context.orgId)
        .eq('state', 'open')
        .lte('next_review_date', businessToday)
        .order('next_review_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (contextError) {
    logError('Failed to load parking review contexts', contextError);
    return { tasks: [], failed: true };
  }
  if (!contexts.length) return { tasks: [], failed: false };

  const instructionIds = contexts.flatMap((row) =>
    row.instruction_item_id ? [row.instruction_item_id] : [],
  );
  const instructionsResult = await readInBatches(instructionIds, (batch) =>
    admin
      .from('job_instruction_items')
      .select('id, content, job_id, project_id')
      .eq('organization_id', context.orgId)
      .in('id', [...batch]),
  );
  if (instructionsResult.error) {
    logError('Failed to load blocker review instruction items', instructionsResult.error);
    return { tasks: [], failed: true };
  }
  const instructions = new Map((instructionsResult.data ?? []).map((row) => [row.id, row]));
  const jobIds = [
    ...new Set(
      contexts.flatMap((row) => {
        const instruction = row.instruction_item_id ? instructions.get(row.instruction_item_id) : null;
        return row.job_id ? [row.job_id] : instruction?.job_id ? [instruction.job_id] : [];
      }),
    ),
  ];
  const projectIds = [
    ...new Set(
      contexts.flatMap((row) => {
        const instruction = row.instruction_item_id ? instructions.get(row.instruction_item_id) : null;
        return row.project_id ? [row.project_id] : instruction?.project_id ? [instruction.project_id] : [];
      }),
    ),
  ];
  const responsibleIds = [
    ...new Set(
      contexts.flatMap((row) =>
        row.responsible_employee_record_id ? [row.responsible_employee_record_id] : [],
      ),
    ),
  ];
  const [jobsResult, projectsResult, recordsResult] = await Promise.all([
    readInBatches(jobIds, (batch) =>
      admin
        .from('jobs')
        .select('id, title, description, job_number')
        .eq('organization_id', context.orgId)
        .in('id', [...batch]),
    ),
    readInBatches(projectIds, (batch) =>
      admin
        .from('projects')
        .select('id, name, description, project_number')
        .eq('organization_id', context.orgId)
        .in('id', [...batch]),
    ),
    readInBatches(responsibleIds, (batch) =>
      admin
        .from('employee_records')
        .select('id, user_id, first_name, last_name')
        .eq('organization_id', context.orgId)
        .in('id', [...batch]),
    ),
  ]);
  if (jobsResult.error || projectsResult.error || recordsResult.error) {
    logError(
      'Failed to load parking review references',
      jobsResult.error ?? projectsResult.error ?? recordsResult.error,
    );
    return { tasks: [], failed: true };
  }
  const userIds = (recordsResult.data ?? []).flatMap((row) => (row.user_id ? [row.user_id] : []));
  const profilesResult = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logError('Failed to load parking responsible profiles', profilesResult.error);
    return { tasks: [], failed: true };
  }
  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const nameByRecordId = new Map(
    (recordsResult.data ?? []).map((row) => {
      const profile = row.user_id ? profileById.get(row.user_id) : undefined;
      return [
        row.id,
        (profile ? formatProfileName(profile) : null) ||
          [row.first_name, row.last_name].filter(Boolean).join(' ') ||
          'Unbenannt',
      ];
    }),
  );
  const jobs = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));
  const projects = new Map((projectsResult.data ?? []).map((project) => [project.id, project]));

  const tasks: AttentionTask[] = [];
  for (const row of contexts) {
    const instruction = row.instruction_item_id ? instructions.get(row.instruction_item_id) : null;
    const jobId = row.job_id ?? instruction?.job_id ?? null;
    const projectId = row.project_id ?? instruction?.project_id ?? null;
    const job = jobId ? jobs.get(jobId) : undefined;
    const project = projectId ? projects.get(projectId) : undefined;
    if (!row.next_review_date || (!job && !project)) {
      logError('Work blocker review has no accessible target');
      return { tasks: [], failed: true };
    }
    const targetLabel = instruction
      ? instruction.content
      : job?.title.trim() ||
        job?.description?.trim() ||
        project?.name.trim() ||
        project?.description?.trim() ||
        'Arbeit';
    const targetHref = job?.job_number
      ? `/auftraege/${encodeURIComponent(job.job_number)}`
      : project?.project_number
        ? `/auftraege/projekt/${encodeURIComponent(project.project_number)}`
        : '/auftraege';
    tasks.push({
      sourceType: 'work_blocker_review',
      sourceId: row.id,
      targetLabel,
      targetHref,
      blockerKind: row.kind,
      nextReviewDate: row.next_review_date,
      responsibleName: row.responsible_employee_record_id
        ? (nameByRecordId.get(row.responsible_employee_record_id) ?? null)
        : null,
      stateVersion: `review:${row.version}:${row.next_review_date}`,
    });
  }
  return { tasks, failed: false };
}

// The reason belonging to a decision's current status: the cancellation
// reason for cancelled requests, otherwise the decision comment.
function resolveDecisionReason(
  status: string,
  decisionComment: string | null,
  cancellationReason: string | null,
): string | null {
  return status === 'cancelled' ? cancellationReason : decisionComment;
}

async function deriveOwnNotifications(
  context: ActionContext,
): Promise<{ notifications: AttentionNotification[]; failed: boolean }> {
  const admin = createSupabaseAdminClient();

  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', context.orgId)
    .eq('user_id', context.userId)
    .maybeSingle();
  if (recordError) {
    logError('Failed to load own employee record', recordError);
    return { notifications: [], failed: true };
  }
  if (!record) return { notifications: [], failed: false };

  const businessToday = getBusinessTodayIso();
  // Bounded window at the database: only decisions inside the surfaced
  // 60-day window are loaded (the in-memory check stays authoritative).
  const windowStart = notificationWindowStartIso(businessToday);
  const requestsResult = await admin
    .from('vacation_requests')
    .select(
      'id, status, start_date, end_date, day_portion, decided_at, cancelled_at, decision_comment, cancellation_reason',
    )
    .eq('organization_id', context.orgId)
    .eq('employee_record_id', record.id)
    .in('status', ['approved', 'rejected', 'cancelled'])
    .or(`decided_at.gte.${windowStart},cancelled_at.gte.${windowStart}`);
  if (requestsResult.error) {
    logError('Failed to load decision notifications', requestsResult.error);
    return { notifications: [], failed: true };
  }
  // Read markers accumulate forever; only the markers of the windowed decisions are read.
  const readStatesResult = await readInBatches(
    (requestsResult.data ?? []).map((row) => row.id),
    (batch) =>
      admin
        .from('attention_read_states')
        .select('source_id, state_version')
        .eq('organization_id', context.orgId)
        .eq('user_id', context.userId)
        .eq('source_type', 'vacation_decision')
        .in('source_id', [...batch]),
  );
  if (readStatesResult.error) {
    logError('Failed to load decision notifications', readStatesResult.error);
    return { notifications: [], failed: true };
  }

  const readVersionBySourceId = new Map(
    (readStatesResult.data ?? []).map((row) => [row.source_id, row.state_version]),
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
      comment: resolveDecisionReason(facts.status, row.decision_comment, row.cancellation_reason),
      stateVersion: facts.stateVersion,
      occurredAt: facts.occurredAt,
      unread: isNotificationUnread(facts.stateVersion, readVersionBySourceId.get(row.id) ?? null),
    });
  }

  return {
    notifications: sortNotificationsNewestFirst(dedupeAttentionItems(notifications)),
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
    logError('Failed to load own record for sickness notices', ownRecordError);
    return { notifications: [], failed: true };
  }
  const ownRecordId = ownRecord?.id ?? null;
  if (!isManager && !ownRecordId) return { notifications: [], failed: false };

  const businessToday = getBusinessTodayIso();
  // Corrections and cancellations bump updated_at, so one bound covers every
  // material change inside the surfaced window.
  const windowStart = notificationWindowStartIso(businessToday);
  // The 60-day window bounds the read; it is paged so a large organization is never truncated.
  const readReports = (from: number, to: number) => {
    const query = admin
      .from('sickness_reports')
      .select(
        'id, employee_record_id, status, start_date, end_date, day_portion, reported_by, cancelled_by, cancelled_at, updated_at',
      )
      .eq('organization_id', context.orgId)
      .gte('updated_at', windowStart);
    return (!isManager && ownRecordId ? query.eq('employee_record_id', ownRecordId) : query)
      .order('updated_at', { ascending: false })
      .order('id')
      .range(from, to);
  };

  const reportsResult = await readCompleteRows(readReports, LIST_ROW_CAP);
  if (reportsResult.error) {
    logError('Failed to load sickness notifications', reportsResult.error);
    return { notifications: [], failed: true };
  }
  // Read markers accumulate forever; only the markers of the windowed reports are read.
  const readStatesResult = await readInBatches(
    (reportsResult.data ?? []).map((row) => row.id),
    (batch) =>
      admin
        .from('attention_read_states')
        .select('source_id, state_version')
        .eq('organization_id', context.orgId)
        .eq('user_id', context.userId)
        .eq('source_type', 'sickness_report')
        .in('source_id', [...batch]),
  );
  if (readStatesResult.error) {
    logError('Failed to load sickness notifications', readStatesResult.error);
    return { notifications: [], failed: true };
  }

  const readVersionBySourceId = new Map(
    (readStatesResult.data ?? []).map((row) => [row.source_id, row.state_version]),
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
  const managerRows = rows.filter((row) => isManagerAudience(row) && !isOwnAudience(row));

  // Names only for manager-audience items (two-step lookup; no FK path from
  // employee_records to profiles for PostgREST embeds).
  const nameRecordIds = [...new Set(managerRows.map((row) => row.employee_record_id))];
  let nameByRecordId = new Map<string, string>();
  if (nameRecordIds.length > 0) {
    const { data: records, error: recordsError } = await readInBatches(nameRecordIds, (batch) =>
      admin
        .from('employee_records')
        .select('id, user_id, first_name, last_name')
        .eq('organization_id', context.orgId)
        .in('id', [...batch]),
    );
    if (recordsError) {
      logError('Failed to load records for sickness notices', recordsError);
      return { notifications: [], failed: true };
    }
    const userIds = [
      ...new Set((records ?? []).map((row) => row.user_id).filter((id): id is string => Boolean(id))),
    ];
    const profilesResult = await readInBatches(userIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', [...batch]),
    );
    if (profilesResult.error) {
      logError('Failed to load profiles for sickness notices', profilesResult.error);
      return { notifications: [], failed: true };
    }
    const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
    nameByRecordId = new Map(
      (records ?? []).map((record) => {
        const profile = record.user_id ? profileById.get(record.user_id) : undefined;
        const name = profile
          ? formatProfileName(profile)
          : `${record.first_name ?? ''} ${record.last_name ?? ''}`.trim();
        return [record.id, name || 'Unbekannt'];
      }),
    );
  }

  const toNotification = (row: ReportRow, isOwn: boolean): AttentionNotification | null => {
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
      personName: isOwn ? null : (nameByRecordId.get(row.employee_record_id) ?? 'Unbekannt'),
      isOwn,
      status: facts.status,
      startDate: row.start_date,
      endDate: row.end_date,
      dayPortion: row.day_portion as VacationDayPortion,
      stateVersion: facts.stateVersion,
      occurredAt: facts.occurredAt,
      unread: isNotificationUnread(facts.stateVersion, readVersionBySourceId.get(row.id) ?? null),
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
  context: ActionContext,
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
  const noticeSourceIds = noticesResult.notices.map((notice) => notice.sourceId);
  const readStatesResult = await readInBatches(noticeSourceIds, (batch) =>
    admin
      .from('attention_read_states')
      .select('source_id, state_version')
      .eq('organization_id', context.orgId)
      .eq('user_id', context.userId)
      .eq('source_type', 'employee_certification_expiry')
      .in('source_id', [...batch]),
  );
  if (noticesResult.failed || readStatesResult.error) {
    logError('Failed to load certification attention read states', readStatesResult.error);
    return { notifications: [], failed: true };
  }
  const readVersionBySourceId = new Map(
    (readStatesResult.data ?? []).map((row) => [row.source_id, row.state_version]),
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
      unread: isNotificationUnread(notice.stateVersion, readVersionBySourceId.get(notice.sourceId) ?? null),
    })),
    failed: false,
  };
}

// ============================================
// Overview and counts
// ============================================

export type AttentionOverviewResult = ActionResult<{ overview: AttentionOverview }>;

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
      workArtifacts,
      workHandovers,
      joinRequests,
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
      deriveWorkArtifactTasks(context),
      deriveWorkHandoverTasks(context),
      deriveJoinRequestTasks(context),
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
      workArtifacts.failed ||
      workHandovers.failed ||
      joinRequests.failed ||
      notifications.failed ||
      sicknessNotifications.failed ||
      certificationNotifications.failed ||
      !ownOverviewResult.success
    ) {
      return { success: false, error: 'load_failed' };
    }

    const ownRequests: OwnAttentionRequest[] = ownOverviewResult.overview.requests.map((request) => ({
      sourceId: request.id,
      startDate: request.startDate,
      endDate: request.endDate,
      dayPortion: request.dayPortion,
      status: request.status,
      totalDays: request.totalDays,
      decisionReason: resolveDecisionReason(
        request.status,
        request.decisionComment,
        request.cancellationReason,
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
          ...workArtifacts.tasks,
          ...workHandovers.tasks,
          ...joinRequests.tasks,
        ]),
        notifications: sortNotificationsNewestFirst(
          dedupeAttentionItems([
            ...notifications.notifications,
            ...sicknessNotifications.notifications,
            ...certificationNotifications.notifications,
          ]),
        ),
        ownRequests,
      },
    };
  } catch (error) {
    logError('Unexpected error in getAttentionOverview', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type AttentionCountsResult = ActionResult<{ counts: AttentionCounts }>;

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
      workArtifacts,
      workHandovers,
      joinRequests,
      notifications,
      sicknessNotifications,
      certificationNotifications,
    ] = await Promise.all([
      deriveApprovalTasks(context),
      deriveOpenRequestTasks(context),
      deriveFollowUpTasks(context),
      deriveDispatchAcknowledgementTasks(context),
      deriveDispatchChallengeTasks(context),
      deriveParkingReviewTasks(context),
      deriveWorkArtifactTasks(context),
      deriveWorkHandoverTasks(context),
      deriveJoinRequestTasks(context),
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
      workArtifacts.failed ||
      workHandovers.failed ||
      joinRequests.failed ||
      notifications.failed ||
      sicknessNotifications.failed ||
      certificationNotifications.failed
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
      ...workArtifacts.tasks,
      ...workHandovers.tasks,
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
          dispatchTasks.length +
          dedupeAttentionItems(joinRequests.tasks).length,
        unreadNotificationCount: allNotifications.filter((notification) => notification.unread).length,
      },
    };
  } catch (error) {
    logError('Unexpected error in getAttentionCounts', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Read markers (the only pattern-level writes)
// ============================================

export type MarkNotificationReadResult = ActionResult;

type ReadableNotificationSourceType =
  | 'vacation_decision'
  | 'sickness_report'
  | 'employee_certification_expiry';

const notificationReadInputSchema = z.object({
  sourceType: z.enum(['vacation_decision', 'sickness_report', 'employee_certification_expiry']),
  sourceId: uuidSchema,
  stateVersion: z.string().min(1).max(200),
});

// Refusals of mark_attention_notifications_read that keep their code.
const MARK_READ_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_input',
  'not_authorized',
  'request_not_found',
]);

async function persistNotificationReadMarker(
  context: ActionContext,
  input: {
    sourceType: ReadableNotificationSourceType;
    sourceId: string;
    stateVersion: string;
  },
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
      logError('Failed to load request for read marker', requestError);
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
      logError('Failed to load own record for read marker', recordError);
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
      logError('Failed to load report for read marker', reportError);
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
        logError('Failed to load own record for read marker', recordError);
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
      logError('Failed to load certification for read marker', certificationError);
      return { success: false, error: 'update_failed' };
    }
    if (!certification) return { success: false, error: 'request_not_found' };
  }

  // One call repeats the audience check under lock and stores the marker with
  // its 'marked_read' event, or refuses and changes nothing.
  const { error } = await admin.rpc(
    'mark_attention_notifications_read',
    rpcArgs('mark_attention_notifications_read', {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_markers: [
        { source_type: input.sourceType, source_id: input.sourceId, state_version: input.stateVersion },
      ],
      p_via: null,
    }),
  );
  if (error && MARK_READ_REFUSALS.has(error.message)) return { success: false, error: error.message };
  if (error) {
    logError('Failed to mark attention notification read', error);
    return { success: false, error: 'update_failed' };
  }
  return { success: true };
}

export async function markAttentionNotificationRead(input: {
  sourceType: ReadableNotificationSourceType;
  sourceId: string;
  stateVersion: string;
}): Promise<MarkNotificationReadResult> {
  try {
    const parsed = notificationReadInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'invalid_input' };

    const auth = await resolveActionContext();
    if (!auth.success) return auth;

    // The stored version is exactly what the user saw. If the domain state
    // moved on in the meantime, the item legitimately stays unread for the
    // newer version — read markers never overwrite unseen state.
    return await persistNotificationReadMarker(auth.context, parsed.data);
  } catch (error) {
    logError('Unexpected error in markAttentionNotificationRead', error);
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
    // of the single-item path is redundant here; the database function
    // repeats the audience check under lock.
    const [derived, derivedSickness, derivedCertification] = await Promise.all([
      deriveOwnNotifications(context),
      deriveSicknessNotifications(context),
      deriveCertificationExpiryNotifications(context),
    ]);
    if (derived.failed || derivedSickness.failed || derivedCertification.failed) {
      return { success: false, error: 'load_failed' };
    }

    const unread = dedupeAttentionItems([
      ...derived.notifications,
      ...derivedSickness.notifications,
      ...derivedCertification.notifications,
    ]).filter((notification) => notification.unread);
    if (unread.length === 0) return { success: true };

    // One call stores every marker with its 'marked_read' event (via
    // 'mark_all'), or none: a source that left the caller's audience since the
    // derivation refuses the whole call.
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc(
      'mark_attention_notifications_read',
      rpcArgs('mark_attention_notifications_read', {
        p_actor_id: context.userId,
        p_organization_id: context.orgId,
        p_markers: unread.map((notification) => ({
          source_type: notification.sourceType,
          source_id: notification.sourceId,
          state_version: notification.stateVersion,
        })),
        p_via: 'mark_all',
      }),
    );
    if (error) {
      logError('Failed to mark all attention notifications read', error);
      return { success: false, error: 'update_failed' };
    }
    return { success: true };
  } catch (error) {
    logError('Unexpected error in markAllAttentionNotificationsRead', error);
    return { success: false, error: 'unexpected_error' };
  }
}

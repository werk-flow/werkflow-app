import 'server-only';

// The office and approval task derivations behind the attention Server
// Actions in `./actions`. Each reads its owning domain through that domain's
// own loader or the caller's organization, and never mutates state.

import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { ActionContext } from '@/lib/org/action-context';
import { formatBerlinLocalDate, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { formatProfileName } from '@/lib/members/profile-name';
import { getPendingChangeRequests, getPendingSessions } from '@/lib/time-tracking/review-actions';
import { getTimeCorrectionRequests } from '@/lib/time-corrections/read-actions';
import { TIME_CORRECTION_KIND_LABELS } from '@/lib/time-corrections/types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { getPendingVacationRequestsForApprover } from '@/lib/vacation/actions';
import { readPendingJoinRequests } from '@/lib/org/join-requests';
import {
  computeOpenSinceDays,
  FOLLOW_UP_ATTENTION_CAPACITY,
  selectFollowUpAttentionRows,
  type FollowUpAttentionCandidate,
} from './resolution';
import type { AttentionTask } from './types';

export async function deriveApprovalTasks(
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

export async function deriveOpenRequestTasks(
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
      status: row.status,
      urgency: row.urgency,
      receivedAt: row.received_at,
      openSinceDays: computeOpenSinceDays(formatBerlinLocalDate(row.received_at), businessToday),
      assigneeName: assignee ? formatProfileName(assignee) : null,
      assignedToMe: row.assigned_to === context.userId,
    };
  });

  return { tasks, failed: false };
}

export async function deriveFollowUpTasks(
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

  const references = await readFollowUpReferences(admin, context.orgId, visibleRows);
  if (!references) return { tasks: [], failed: true };
  return toFollowUpTasks(visibleRows, references);
}

type FollowUpAttentionRow = FollowUpAttentionCandidate & { ownerUnavailable: boolean };

/** The customer name and owner profile of each visible follow-up; null when a read failed. */
async function readFollowUpReferences(
  admin: AdminClient,
  organizationId: string,
  visibleRows: FollowUpAttentionRow[],
) {
  const clientIds = [...new Set(visibleRows.map((row) => row.client_id))];
  const ownerIds = [...new Set(visibleRows.map((row) => row.owner_user_id))];
  const [clientsResult, profilesResult] = await Promise.all([
    readInBatches(clientIds, (batch) =>
      admin
        .from('clients')
        .select('id,name')
        .eq('organization_id', organizationId)
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
    return null;
  }

  return {
    clientNameById: new Map((clientsResult.data ?? []).map((client) => [client.id, client.name])),
    profileById: new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile])),
  };
}

function toFollowUpTasks(
  visibleRows: FollowUpAttentionRow[],
  { clientNameById, profileById }: NonNullable<Awaited<ReturnType<typeof readFollowUpReferences>>>,
): { tasks: AttentionTask[]; failed: boolean } {
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
export async function deriveJoinRequestTasks(
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

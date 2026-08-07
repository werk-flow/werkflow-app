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
import {
  computeOpenSinceDays,
  dedupeAttentionItems,
  isNotificationUnread,
  isWithinNotificationWindow,
  notificationWindowStartIso,
  resolveVacationDecisionFacts,
  sortNotificationsNewestFirst,
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
      comment:
        facts.status === 'cancelled'
          ? row.cancellation_reason
          : row.decision_comment,
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

    const [approvals, openRequests, notifications, ownOverviewResult] =
      await Promise.all([
        deriveApprovalTasks(context),
        deriveOpenRequestTasks(context),
        deriveOwnNotifications(context),
        getOwnVacationOverview(),
      ]);

    // A partially failed derivation must be visible, never a silently
    // shortened list that reads as "nothing to do".
    if (
      approvals.failed ||
      openRequests.failed ||
      notifications.failed ||
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
      }));

    return {
      success: true,
      overview: {
        businessDate: getBusinessTodayIso(),
        tasks: dedupeAttentionItems([
          ...approvals.tasks,
          ...openRequests.tasks,
        ]),
        notifications: notifications.notifications,
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

    const [approvals, openRequests, notifications] = await Promise.all([
      deriveApprovalTasks(context),
      deriveOpenRequestTasks(context),
      deriveOwnNotifications(context),
    ]);
    if (approvals.failed || openRequests.failed || notifications.failed) {
      return { success: false, error: 'load_failed' };
    }

    const approvalTasks = dedupeAttentionItems(approvals.tasks);
    const requestTasks = dedupeAttentionItems(openRequests.tasks);
    return {
      success: true,
      counts: {
        approvalsCount: approvalTasks.length,
        actionableCount: approvalTasks.length + requestTasks.length,
        unreadNotificationCount: notifications.notifications.filter(
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

async function persistNotificationReadMarker(
  context: ActionContext,
  input: { sourceId: string; stateVersion: string }
): Promise<MarkNotificationReadResult> {
  const admin = createSupabaseAdminClient();

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

  const now = new Date().toISOString();
  const { error: upsertError } = await admin
    .from('attention_read_states')
    .upsert(
      {
        organization_id: context.orgId,
        user_id: context.userId,
        source_type: 'vacation_decision',
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
    source_type: 'vacation_decision',
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
  sourceId: string;
  stateVersion: string;
}): Promise<MarkNotificationReadResult> {
  try {
    if (
      typeof input.sourceId !== 'string' ||
      typeof input.stateVersion !== 'string' ||
      input.stateVersion.length === 0 ||
      input.stateVersion.length > 200
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

    // Ownership is established once by derivation: deriveOwnNotifications
    // only ever returns the caller's own decision notifications, so the
    // per-item request/record validation of the single-item path is
    // redundant here and the writes can be two batched statements instead
    // of a sequential per-item loop that could stop halfway.
    const derived = await deriveOwnNotifications(context);
    if (derived.failed) return { success: false, error: 'load_failed' };

    const unread = derived.notifications.filter(
      (notification) => notification.unread
    );
    if (unread.length === 0) return { success: true };

    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const { error: upsertError } = await admin
      .from('attention_read_states')
      .upsert(
        unread.map((notification) => ({
          organization_id: context.orgId,
          user_id: context.userId,
          source_type: 'vacation_decision',
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
        source_type: 'vacation_decision',
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

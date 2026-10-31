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
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { getOwnVacationOverview } from '@/lib/vacation/actions';
import { toVacationDayPortion, toVacationRequestStatus } from '@/lib/vacation/types';
import { deriveWorkArtifactTasks, deriveWorkHandoverTasks } from './work-tasks';
import {
  deriveApprovalTasks,
  deriveFollowUpTasks,
  deriveJoinRequestTasks,
  deriveOpenRequestTasks,
} from './office-tasks';
import { deriveDispatchAcknowledgementTasks, deriveDispatchChallengeTasks } from './dispatch-tasks';
import { deriveParkingReviewTasks } from './parking-tasks';
import {
  deriveCertificationExpiryNotifications,
  readNotificationReadVersions,
  readSicknessNoticeNames,
  refuseCertificationMarker,
  refuseSicknessReportMarker,
  refuseVacationDecisionMarker,
  splitSicknessAudiences,
  type SicknessNoticeRow,
} from './notifications';
import { readOwnEmployeeRecord, type OwnEmployeeRecordRead } from './own-record';
import {
  countAttentionItems,
  dedupeAttentionItems,
  isNotificationUnread,
  isWithinNotificationWindow,
  notificationWindowStartIso,
  resolveSicknessReportFacts,
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

// ============================================
// Derivation building blocks
// ============================================

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
  ownRecord: OwnEmployeeRecordRead,
): Promise<{ notifications: AttentionNotification[]; failed: boolean }> {
  const admin = createSupabaseAdminClient();

  const { data: record, error: recordError } = await ownRecord;
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
  const readStatesResult = await readNotificationReadVersions(
    admin,
    context,
    'vacation_decision',
    (requestsResult.data ?? []).map((row) => row.id),
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
      status: toVacationRequestStatus(row.status),
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
      dayPortion: toVacationDayPortion(row.day_portion),
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
async function deriveSicknessNotifications(
  context: ActionContext,
  ownRecordRead: OwnEmployeeRecordRead,
): Promise<{
  notifications: AttentionNotification[];
  failed: boolean;
}> {
  const admin = createSupabaseAdminClient();
  const isManager = context.role === 'admin' || context.role === 'buero';

  const { data: ownRecord, error: ownRecordError } = await ownRecordRead;
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
  const readStatesResult = await readNotificationReadVersions(
    admin,
    context,
    'sickness_report',
    (reportsResult.data ?? []).map((row) => row.id),
  );
  if (readStatesResult.error) {
    logError('Failed to load sickness notifications', readStatesResult.error);
    return { notifications: [], failed: true };
  }

  const readVersionBySourceId = new Map(
    (readStatesResult.data ?? []).map((row) => [row.source_id, row.state_version]),
  );
  const { ownRows, managerRows } = splitSicknessAudiences(
    reportsResult.data ?? [],
    context.userId,
    isManager,
    ownRecordId,
  );
  const nameByRecordId = await readSicknessNoticeNames(admin, context.orgId, managerRows);
  if (!nameByRecordId) return { notifications: [], failed: true };

  const notifications: AttentionNotification[] = [];
  for (const row of ownRows) {
    const notification = toSicknessNotification(
      row,
      true,
      nameByRecordId,
      readVersionBySourceId,
      businessToday,
    );
    if (notification) notifications.push(notification);
  }
  for (const row of managerRows) {
    const notification = toSicknessNotification(
      row,
      false,
      nameByRecordId,
      readVersionBySourceId,
      businessToday,
    );
    if (notification) notifications.push(notification);
  }

  return { notifications, failed: false };
}

/** The notice of one report, or null when its latest change lies outside the notification window. */
function toSicknessNotification(
  row: SicknessNoticeRow,
  isOwn: boolean,
  nameByRecordId: ReadonlyMap<string, string>,
  readVersionBySourceId: ReadonlyMap<string, string>,
  businessToday: string,
): AttentionNotification | null {
  const facts = resolveSicknessReportFacts({
    status: row.status as 'reported' | 'cancelled',
    startDate: row.start_date,
    endDate: row.end_date,
    dayPortion: toVacationDayPortion(row.day_portion),
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
    dayPortion: toVacationDayPortion(row.day_portion),
    stateVersion: facts.stateVersion,
    occurredAt: facts.occurredAt,
    unread: isNotificationUnread(facts.stateVersion, readVersionBySourceId.get(row.id) ?? null),
  };
}

// ============================================
// Overview and counts
// ============================================

type DerivedAttention = { tasks: AttentionTask[]; notifications: AttentionNotification[] };

/**
 * Every task and notification the viewer may see, or null when any part
 * failed: a partially failed derivation must be visible, never a silently
 * shortened list that reads as "nothing to do". The overview and the badge
 * counts share this one derivation.
 */
async function deriveAttention(context: ActionContext): Promise<DerivedAttention | null> {
  const ownRecord = readOwnEmployeeRecord(context);
  const [taskParts, notificationParts] = await Promise.all([
    Promise.all([
      deriveApprovalTasks(context),
      deriveOpenRequestTasks(context),
      deriveFollowUpTasks(context),
      deriveDispatchAcknowledgementTasks(context, ownRecord),
      deriveDispatchChallengeTasks(context),
      deriveParkingReviewTasks(context),
      deriveWorkArtifactTasks(context),
      deriveWorkHandoverTasks(context),
      deriveJoinRequestTasks(context),
    ]),
    Promise.all([
      deriveOwnNotifications(context, ownRecord),
      deriveSicknessNotifications(context, ownRecord),
      deriveCertificationExpiryNotifications(context),
    ]),
  ]);
  if (taskParts.some((part) => part.failed) || notificationParts.some((part) => part.failed)) return null;
  return {
    tasks: dedupeAttentionItems(taskParts.flatMap((part) => part.tasks)),
    notifications: sortNotificationsNewestFirst(
      dedupeAttentionItems(notificationParts.flatMap((part) => part.notifications)),
    ),
  };
}

export type AttentionOverviewResult = ActionResult<{ overview: AttentionOverview }>;

export async function getAttentionOverview(): Promise<AttentionOverviewResult> {
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { context } = auth;

    const [derived, ownOverviewResult] = await Promise.all([
      deriveAttention(context),
      getOwnVacationOverview(),
    ]);
    if (!derived || !ownOverviewResult.success) return { success: false, error: 'load_failed' };

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
        tasks: derived.tasks,
        notifications: derived.notifications,
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

    const derived = await deriveAttention(context);
    if (!derived) return { success: false, error: 'load_failed' };
    return {
      success: true,
      counts: countAttentionItems(derived),
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
  const refusal =
    input.sourceType === 'vacation_decision'
      ? await refuseVacationDecisionMarker(admin, context, input.sourceId)
      : input.sourceType === 'sickness_report'
        ? await refuseSicknessReportMarker(admin, context, input.sourceId)
        : await refuseCertificationMarker(admin, context, input.sourceId);
  if (refusal) return refusal;

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
    const ownRecord = readOwnEmployeeRecord(context);
    const [derived, derivedSickness, derivedCertification] = await Promise.all([
      deriveOwnNotifications(context, ownRecord),
      deriveSicknessNotifications(context, ownRecord),
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

'use server';
import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { logReadFailure, loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { revalidatePath } from 'next/cache';
import { logError } from '@/lib/logging';
import { cookies } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { readOrganizationSettings } from './organization-settings-read';
import {
  addManualEntryInputSchema,
  calendarEntryIdListSchema,
  deleteEntryInputSchema,
  entryIdListSchema,
  getTimeEntriesInputSchema,
  optionalOrganizationIdSchema,
  reviewChangeRequestInputSchema,
  reviewEntriesInputSchema,
  updateEntryInputSchema,
} from './action-schemas';
import {
  type TimeEntry,
  type TimeEntryRow,
  type TimeEntryType,
  type JobTimeParticipant,
  type OrgRole,
  type LiveClockState,
  type TimeActivitySelection,
  type AddManualEntryParams,
  type AddManualEntryResult,
  type ReviewEntryResult,
  type UpdateEntryResult,
  type DeleteEntryResult,
  type GetTimeEntriesParams,
  type GetTimeEntriesResult,
  type GetPendingSessionsResult,
  type ChangeRequest,
  type RequestChangeResult,
  type ReviewChangeRequestResult,
  type GetChangeRequestsResult,
  toTimeEntry,
  toTimeEntries,
  toChangeRequest,
  type ClockJobInfo,
} from './types';
import {
  buildClockTimelineSegments,
  calculateBreakMinutes,
  hasOpenSession,
  deriveCurrentClockState,
  calculateTotalMinutes,
  calculateBreakSessions,
  calculateWorkSessions,
  determineApprovalStatus,
  canManageEntries,
  canViewEntries,
  canAddEntriesFor,
} from './helpers';
import { canViewChangeRequest } from './change-request-visibility';
import { readPendingChangeRequestData } from './change-request-reader';
import { readPendingChangeRequestQueue, readPendingSessionQueue } from './approval-queue';
import {
  entriesTouchClosedTimePeriod,
  timeEntryBatchFailure,
  timeWriteFailure,
  touchesClosedTimePeriod,
} from './closed-periods';
import { isUuid, uuidSchema } from '@/lib/validation/uuid';
import { getLocalDayEnd, getLocalDayKey, getLocalDayStart, isSameLocalDay } from './day-utils';
import {
  validateManualEntries,
  validateManualEntryJobOwnership,
  validateTimestampUpdate,
  validateDayEntrySequence,
} from './validation';
import { computeBreakdownForSettings } from './settings';
import { getJobDisplayTitle } from '@/lib/jobs/types';
import {
  authorizeResponsibilityForTarget,
  getEffectiveResponsibilityHolderForActor,
  loadResponsibilityRuntimeState,
} from '@/lib/responsibilities/server';
import { getCanonicalTimeEntries } from './canonical-entries';
import { getCanonicalClockState } from './segment-actions';
import { hashTimeTransitionRequest } from './transition-hash';
import { createActivitySelection } from './segments';
import { getProvisionalTimeCorrectionProjection } from '@/lib/time-corrections/actions';
import { loadApprovedCorrectionProjection } from '@/lib/time-corrections/approved-projection';
import { applyApprovedTimeCorrections } from '@/lib/time-corrections/projection';
import { collectActiveJobIds } from './active-jobs';
import { getOpenSessionOrgsForUserOnDay } from './open-session-orgs';

/**
 * Get the current organization ID from cookies (with membership fallback).
 */
async function getCurrentOrgId(userId: string): Promise<string | null> {
  const cookieStore = await cookies();
  return resolveActiveOrgId(cookieStore, userId);
}

/** The user's complete entries on the timestamps' local days; null when a read fails or overflows. */
async function getUserEntriesOnDays(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  orgId: string,
  timestamps: readonly Date[],
): Promise<TimeEntryRow[] | null> {
  const days = [...new Map(timestamps.map((timestamp) => [getLocalDayKey(timestamp), timestamp])).values()];
  const results = await Promise.all(
    days.map((day) => {
      const { start, end } = getDayBounds(day);
      return readCompleteRows(
        (from, to) =>
          admin
            .from('time_entries')
            .select('*')
            .eq('user_id', userId)
            .eq('organization_id', orgId)
            .gte('timestamp', start.toISOString())
            .lte('timestamp', end.toISOString())
            .order('timestamp', { ascending: false })
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      );
    }),
  );
  const failed = results.find((result) => result.error)?.error;
  if (failed) logReadFailure('Error fetching user entries:', { code: failed.code });
  return failed ? null : results.flatMap((result) => result.data);
}

/**
 * Get entries for a specific local day for the user in an org; null when the
 * read fails, so a caller never validates against or reports a missing day.
 */
async function getUserEntriesForDay(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  orgId: string,
  date: Date,
): Promise<TimeEntryRow[] | null> {
  const { start, end } = getDayBounds(date);

  const { data, error } = await admin
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .gte('timestamp', start.toISOString())
    .lte('timestamp', end.toISOString())
    .neq('status', 'rejected')
    .neq('status', 'pending_delete')
    .order('timestamp', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    logReadFailure('Error fetching user day entries:', error);
    return null;
  }

  return data;
}

/**
 * Get only today's entries for the user in an org.
 * Much faster than getUserEntries for clock status checks.
 */
async function getUserTodayEntries(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  orgId: string,
): Promise<TimeEntryRow[] | null> {
  return getUserEntriesForDay(admin, userId, orgId, new Date());
}

/**
 * Resolve the caller's current operational role in the organization from the
 * per-request membership read (never a cross-request cache); null when the
 * caller is not a current operational member.
 */
async function verifyCurrentMembership(orgId: string): Promise<OrgRole | null> {
  const caller = await resolveActionContextFor(orgId);
  return caller.success ? caller.context.role : null;
}

async function getClockJobInfo(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  jobId: string,
): Promise<ActionResult<{ info: ClockJobInfo | null }>> {
  const { data: job, error: jobError } = await loggedRead(
    'getClockJobInfo: jobs read failed',
    admin
      .from('jobs')
      .select('id, title, description, job_number, status, project_id, client_id')
      .eq('id', jobId)
      .eq('organization_id', organizationId)
      .maybeSingle(),
  );
  if (jobError) return { success: false, error: 'fetch_failed' };
  if (!job) return { success: true, info: null };

  const [projectData, clientData] = await Promise.all([
    job.project_id
      ? admin
          .from('projects')
          .select('name')
          .eq('id', job.project_id)
          .eq('organization_id', organizationId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    job.client_id
      ? admin
          .from('clients')
          .select('name')
          .eq('id', job.client_id)
          .eq('organization_id', organizationId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    success: true,
    info: {
      id: job.id,
      title: getJobDisplayTitle({
        title: job.title,
        description: job.description,
      }),
      jobNumber: job.job_number,
      status: job.status === 'nicht_bearbeitet' ? 'in_bearbeitung' : job.status,
      projectName: (projectData.data as { name: string } | null)?.name ?? null,
      clientName: (clientData.data as { name: string } | null)?.name ?? null,
    },
  };
}

type TodayBounds = {
  start: Date;
  end: Date;
};

function getDayBounds(date: Date): TodayBounds {
  return {
    start: getLocalDayStart(date),
    end: getLocalDayEnd(date),
  };
}

function getTodayBounds(): TodayBounds {
  return getDayBounds(new Date());
}

function getManualEntryJobId(entryType: TimeEntry['entryType'], jobId?: string | null): string | null {
  if (entryType !== 'clock_in') {
    return null;
  }

  return jobId ?? null;
}

// ============================================
// Real-Time Clock In/Out Actions
// ============================================

function getTransitionOutcome(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('outcome' in value)) return null;
  return typeof value.outcome === 'string' ? value.outcome : null;
}

function getTransitionVersion(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('version' in value)) return null;
  return typeof value.version === 'number' ? value.version : null;
}

/**
 * Best-effort: clock out the current user in any org where they are currently working today.
 * Used before sign-out so users don't get "stuck clocked in".
 */
export async function clockOutBeforeSignOut(): Promise<
  { success: true; clockedOutOrgIds: string[] } | (ActionFailure & { failedOrgIds?: string[] })
> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: true, clockedOutOrgIds: [] };
    }

    const admin = createSupabaseAdminClient();
    const openOrgs = await getOpenSessionOrgsForUserOnDay(admin, user.id, new Date());
    if (!openOrgs) return { success: false, error: 'fetch_failed' };
    // tenant-scope: cross-organization-by-design — sign-out ends the signed-in user's own open sessions in every organization they belong to.
    const { data: canonicalSessions, error: canonicalSessionsError } = await admin
      .from('time_sessions')
      .select('id, organization_id, version, status')
      .eq('user_id', user.id)
      .is('ended_at', null);

    if (canonicalSessionsError) {
      logError('Error fetching canonical sessions before sign-out:', canonicalSessionsError);
      return { success: false, error: 'fetch_failed' };
    }

    if (openOrgs.length === 0 && !canonicalSessions?.length) {
      return { success: true, clockedOutOrgIds: [] };
    }

    const nowIso = new Date().toISOString();
    const canonicalClosedOrgIds = new Set<string>();
    const legacyClosedOrgIds = new Set<string>();
    const failedOrgIds = new Set<string>();

    for (const session of canonicalSessions ?? []) {
      const operationId = crypto.randomUUID();
      const action = session.status === 'recovery_required' ? 'recover_end' : 'end';
      const requestHash = hashTimeTransitionRequest({
        organizationId: session.organization_id,
        action,
        expectedSessionId: session.id,
        expectedVersion: session.version,
        selection: null,
        acknowledgeLong: action === 'recover_end',
      });
      const transitionArgs = rpcArgs('transition_time_activity', {
        p_organization_id: session.organization_id,
        p_actor_id: user.id,
        p_operation_id: operationId,
        p_request_hash: requestHash,
        p_action: action,
        p_expected_session_id: session.id,
        p_expected_version: session.version,
        p_acknowledge_long: action === 'recover_end',
      });
      let { data: transitionResult, error } = await admin.rpc('transition_time_activity', transitionArgs);
      if (error) {
        logError('Error ending canonical session before sign-out:', error);
        failedOrgIds.add(session.organization_id);
        continue;
      }
      if (getTransitionOutcome(transitionResult) === 'recovery_required') {
        const recoveryOperationId = crypto.randomUUID();
        const recoveryExpectedVersion = getTransitionVersion(transitionResult) ?? session.version;
        const recoveryRequestHash = hashTimeTransitionRequest({
          organizationId: session.organization_id,
          action: 'recover_end',
          expectedSessionId: session.id,
          expectedVersion: recoveryExpectedVersion,
          selection: null,
          acknowledgeLong: true,
        });
        const recoveryResult = await admin.rpc('transition_time_activity', {
          ...transitionArgs,
          p_operation_id: recoveryOperationId,
          p_request_hash: recoveryRequestHash,
          p_action: 'recover_end',
          p_expected_version: recoveryExpectedVersion,
          p_acknowledge_long: true,
        });
        transitionResult = recoveryResult.data;
        error = recoveryResult.error;
      }
      if (error || getTransitionOutcome(transitionResult) !== 'ended') {
        logError(
          'Canonical session remained open before sign-out:',
          error ?? getTransitionOutcome(transitionResult),
        );
        failedOrgIds.add(session.organization_id);
        continue;
      }
      canonicalClosedOrgIds.add(session.organization_id);
    }

    for (const org of openOrgs) {
      const { error: insertError } = await admin.from('time_entries').insert({
        user_id: user.id,
        organization_id: org.organizationId,
        entry_type: 'clock_out',
        timestamp: nowIso,
        is_manual: false,
        status: 'approved',
      });

      if (insertError) {
        logError('Error inserting clock_out before sign-out:', insertError);
        failedOrgIds.add(org.organizationId);
        continue;
      }

      legacyClosedOrgIds.add(org.organizationId);
    }

    if (failedOrgIds.size > 0) {
      return {
        success: false,
        error: 'clock_out_incomplete',
        failedOrgIds: [...failedOrgIds],
      };
    }

    return {
      success: true,
      clockedOutOrgIds: [...new Set([...canonicalClosedOrgIds, ...legacyClosedOrgIds])],
    };
  } catch (error) {
    logError('Unexpected error in clockOutBeforeSignOut:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Manual Entry Actions
// ============================================

/**
 * Add manual time entries
 */
export async function addManualEntry(rawParams: AddManualEntryParams): Promise<AddManualEntryResult> {
  try {
    const parsed = addManualEntryInputSchema.safeParse(rawParams);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const params = parsed.data;
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const { organizationId, targetUserId, entries } = params;

    const [firstEntry] = entries;
    if (!firstEntry) return { success: false, error: 'validation_failed' };

    const [callerRole, organizationSettings] = await Promise.all([
      verifyCurrentMembership(organizationId),
      readOrganizationSettings(organizationId),
    ]);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }
    if (!organizationSettings) return { success: false, error: 'fetch_failed' };

    const containsManualBreakEntries = entries.some(
      (entry) => entry.entryType === 'break_start' || entry.entryType === 'break_end',
    );

    if (organizationSettings.breakMode === 'automatic' && containsManualBreakEntries) {
      return { success: false, error: 'break_mode_automatic' };
    }

    const admin = createSupabaseAdminClient();

    // Get target user's role
    const { data: targetMember, error: targetMemberError } = await loggedRead(
      'addManualEntry: organization_members read failed',
      admin
        .from('organization_members')
        .select('role')
        .eq('user_id', targetUserId)
        .eq('organization_id', organizationId)
        .maybeSingle(),
    );
    if (targetMemberError) return { success: false, error: 'load_failed' };
    if (!targetMember) return { success: false, error: 'target_not_a_member' };

    const targetRole = targetMember.role as OrgRole;

    // Check if caller can add entries for target
    if (!canAddEntriesFor(callerRole, targetRole, user.id, targetUserId)) {
      return { success: false, error: 'not_authorized' };
    }
    // A closed month gains no entries; the database refuses them as well.
    if (
      await touchesClosedTimePeriod(
        admin,
        organizationId,
        entries.map((entry) => entry.timestamp),
      )
    ) {
      return { success: false, error: 'period_closed' };
    }

    const targetDay = new Date(firstEntry.timestamp);
    const existingEntries = await getUserEntriesForDay(admin, targetUserId, organizationId, targetDay);
    if (!existingEntries) return { success: false, error: 'fetch_failed' };
    const timeEntries = toTimeEntries(existingEntries);

    // Validate the new entries
    const validationResult = validateManualEntries(timeEntries, entries, {
      allowFutureTimestamps: callerRole === 'admin',
    });
    if (!validationResult.valid) {
      return {
        success: false,
        error: validationResult.error || 'validation_failed',
      };
    }

    const normalizedEntries = entries.map((entry) => ({
      ...entry,
      jobId: getManualEntryJobId(entry.entryType, params.jobId),
    }));
    const jobOwnershipResult = validateManualEntryJobOwnership(normalizedEntries);
    if (!jobOwnershipResult.valid) {
      return {
        success: false,
        error: jobOwnershipResult.error || 'validation_failed',
      };
    }

    // Determine approval status
    const status = determineApprovalStatus(callerRole, targetUserId, user.id);

    // Cross-org guard: only run if these entries would result in an "open session" today
    const simulatedEntries: TimeEntry[] = normalizedEntries.map((e, idx) => ({
      id: `simulated-${idx}`,
      userId: targetUserId,
      organizationId,
      entryType: e.entryType,
      timestamp: e.timestamp,
      isManual: true,
      jobId: e.jobId ?? null,
      status,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: e.timestamp,
      updatedAt: e.timestamp,
    }));

    const wouldBeClockedIn = hasOpenSession([...timeEntries, ...simulatedEntries], getLocalDayEnd(targetDay));
    if (wouldBeClockedIn) {
      const openOrgs = await getOpenSessionOrgsForUserOnDay(admin, targetUserId, targetDay);
      if (!openOrgs) return { success: false, error: 'fetch_failed' };
      const openOther = openOrgs.find((o) => o.organizationId !== organizationId);
      if (openOther) {
        return {
          success: false,
          error: 'working_in_other_org',
          otherOrgId: openOther.organizationId,
          otherOrgName: openOther.organizationName,
        };
      }
    }

    const insertData = normalizedEntries.map((entry) => ({
      user_id: targetUserId,
      organization_id: organizationId,
      entry_type: entry.entryType,
      timestamp: entry.timestamp,
      is_manual: true,
      status,
      reviewed_by: status === 'approved' ? user.id : null,
      reviewed_at: status === 'approved' ? new Date().toISOString() : null,
      job_id: entry.jobId ?? null,
    }));

    const { data: newEntries, error: insertError } = await admin
      .from('time_entries')
      .insert(insertData)
      .select();

    if (insertError || !newEntries) {
      return {
        success: false,
        error: timeWriteFailure('Error inserting manual entries:', insertError, 'insert_failed'),
      };
    }

    revalidatePath('/zeiterfassung');

    return { success: true, entries: toTimeEntries(newEntries) };
  } catch (error) {
    logError('Unexpected error in addManualEntry:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Review Actions
// ============================================

const REVIEW_BATCH_LIMIT = 1000;

/**
 * Approve or reject pending entries in one round trip: one session, one
 * calendar day or the whole approval backlog. Every entry must be pending and
 * belong to one organization the caller is a member of; the time_approval
 * responsibility is resolved once per target person at action time, so a
 * stale view never preserves authority. The database function applies the
 * decision to every entry or to none. Rejected entries stay in history with
 * status 'rejected'.
 */
export async function reviewEntries(
  entryIds: string[],
  decision: 'approved' | 'rejected',
): Promise<ReviewEntryResult> {
  try {
    const parsed = reviewEntriesInputSchema.safeParse({ entryIds, decision });
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }
    const ids = [...new Set(parsed.data.entryIds)];
    if (ids.length === 0 || ids.length > REVIEW_BATCH_LIMIT) {
      return { success: false, error: 'invalid_input' };
    }

    const admin = createSupabaseAdminClient();
    const { data: entries, error: entriesError } = await readInBatches(ids, (batch) =>
      // tenant-scope: by-id-then-verified — every entry must share one organization, whose membership and time_approval responsibility are verified before the write.
      admin
        .from('time_entries')
        .select('id, organization_id, user_id, status, timestamp')
        .in('id', [...batch]),
    );
    if (entriesError) {
      logReadFailure('reviewEntries: entries failed', entriesError);
      return { success: false, error: 'fetch_failed' };
    }
    if (entries.length !== ids.length) return { success: false, error: 'entry_not_found' };
    if (entries.some((entry) => entry.status !== 'pending')) {
      return { success: false, error: 'entry_not_pending' };
    }
    const organizationId = entries[0]?.organization_id;
    if (!organizationId || entries.some((entry) => entry.organization_id !== organizationId)) {
      return { success: false, error: 'invalid_input' };
    }

    const callerRole = await verifyCurrentMembership(organizationId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    const targetUserIds = [...new Set(entries.map((entry) => entry.user_id))];
    const { data: targetMembers, error: targetMembersError } = await readInBatches(targetUserIds, (batch) =>
      admin
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', organizationId)
        .in('user_id', [...batch]),
    );
    if (targetMembersError) {
      logReadFailure('reviewEntries: target memberships failed', targetMembersError);
      return { success: false, error: 'fetch_failed' };
    }
    const roleByUser = new Map(targetMembers.map((member) => [member.user_id, member.role as OrgRole]));
    // Resolve current stored responsibility at action time. A stale UI can
    // never preserve authority after a delegation expires.
    const authorizations = await Promise.all(
      targetUserIds.map(async (targetUserId) => {
        const targetRole = roleByUser.get(targetUserId);
        if (!targetRole) return { success: false as const, error: 'target_not_found' };
        return authorizeResponsibilityForTarget({
          organizationId,
          responsibility: 'time_approval',
          actorUserId: user.id,
          targetUserId,
          targetRole,
        });
      }),
    );
    const refusal = authorizations.find((authorization) => !authorization.success);
    if (refusal && !refusal.success) {
      return { success: false, error: refusal.error };
    }
    // An entry of a closed month keeps its review state until a reopen.
    if (
      await touchesClosedTimePeriod(
        admin,
        organizationId,
        entries.map((entry) => entry.timestamp),
      )
    ) {
      return { success: false, error: 'period_closed' };
    }

    // One transaction: the function re-checks every entry under lock and reviews all or none.
    const { data: reviewed, error: reviewError } = await admin.rpc(
      'review_time_entries',
      rpcArgs('review_time_entries', {
        p_actor_id: user.id,
        p_organization_id: organizationId,
        p_entry_ids: ids,
        p_decision: parsed.data.decision,
        p_authorized_user_ids: targetUserIds,
      }),
    );
    if (reviewError) return timeEntryBatchFailure('Error reviewing entries:', reviewError, 'update_failed');
    return { success: true, reviewed };
  } catch (error) {
    logError('Unexpected error in reviewEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Update/Delete Actions
// ============================================

/**
 * Update a time entry (admin/manager only)
 * For managers editing their own entries, creates a change request for admin approval
 */
export async function updateEntry(
  rawEntryId: string,
  rawFields: { timestamp?: string; entryType?: TimeEntryType; jobId?: string | null },
): Promise<UpdateEntryResult | RequestChangeResult> {
  try {
    const parsed = updateEntryInputSchema.safeParse({ entryId: rawEntryId, fields: rawFields });
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const { entryId, fields } = parsed.data;
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    // tenant-scope: by-id-then-verified — the caller's membership in the entry's organization is verified next, and every write filters by that organization.
    const { data: entry, error: entryError } = await admin
      .from('time_entries')
      .select('*')
      .eq('id', entryId)
      .maybeSingle();

    if (entryError) return { success: false, error: 'load_failed' };
    if (!entry) return { success: false, error: 'entry_not_found' };

    const callerRole = await verifyCurrentMembership(entry.organization_id);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    // Get target user's role
    const { data: targetMember, error: targetMemberError } = await loggedRead(
      'updateEntry: organization_members read failed',
      admin
        .from('organization_members')
        .select('role')
        .eq('user_id', entry.user_id)
        .eq('organization_id', entry.organization_id)
        .maybeSingle(),
    );
    if (targetMemberError) return { success: false, error: 'load_failed' };
    if (!targetMember) return { success: false, error: 'target_not_found' };

    const targetRole = targetMember.role as OrgRole;
    const isOwnEntry = entry.user_id === user.id;

    // Check if caller can manage this entry
    if (!canManageEntries(callerRole, targetRole, isOwnEntry)) {
      return { success: false, error: 'not_authorized' };
    }

    const targetTimestamp = new Date(fields.timestamp ?? entry.timestamp);
    // A closed month changes only after a reasoned reopen (P1-23). The
    // recorded day and the new day both count.
    if (
      await touchesClosedTimePeriod(admin, entry.organization_id, [
        entry.timestamp,
        targetTimestamp.toISOString(),
      ])
    ) {
      return { success: false, error: 'period_closed' };
    }

    // Validate timestamp update if provided
    const changesSequence = fields.entryType !== undefined || Object.hasOwn(fields, 'jobId');
    const dayRows =
      fields.timestamp || changesSequence
        ? await getUserEntriesOnDays(admin, entry.user_id, entry.organization_id, [
            new Date(entry.timestamp),
            targetTimestamp,
          ])
        : [];
    if (!dayRows) return { success: false, error: 'fetch_failed' };
    if (fields.timestamp) {
      const timeEntries = toTimeEntries(dayRows);

      const validationResult = validateTimestampUpdate(timeEntries, entryId, new Date(fields.timestamp));

      if (!validationResult.valid) {
        return {
          success: false,
          error: validationResult.error || 'validation_failed',
        };
      }
    }

    if (changesSequence) {
      const timeEntries = toTimeEntries(dayRows);

      const simulatedEntries = timeEntries.map((existingEntry) =>
        existingEntry.id === entryId
          ? {
              ...existingEntry,
              entryType: fields.entryType ?? existingEntry.entryType,
              jobId: fields.jobId !== undefined ? fields.jobId : existingEntry.jobId,
              timestamp: fields.timestamp ?? existingEntry.timestamp,
            }
          : existingEntry,
      );

      const dayReference = new Date(targetTimestamp);
      const dayEntries = simulatedEntries.filter((timeEntry) =>
        isSameLocalDay(new Date(timeEntry.timestamp), dayReference),
      );
      const sequenceResult = validateDayEntrySequence(dayEntries);

      if (!sequenceResult.valid) {
        return {
          success: false,
          error: sequenceResult.error || 'validation_failed',
        };
      }
    }

    // A caller-supplied job must belong to the entry's organization before it is written.
    if (fields.jobId) {
      const { data: job, error: jobError } = await loggedRead(
        'updateEntry: jobs read failed',
        admin
          .from('jobs')
          .select('id')
          .eq('id', fields.jobId)
          .eq('organization_id', entry.organization_id)
          .maybeSingle(),
      );
      if (jobError) return { success: false, error: 'load_failed' };
      if (!job) {
        return { success: false, error: 'job_not_found' };
      }
    }

    // Direct update (admin or manager editing managed role's entry)
    const updateData: Record<string, unknown> = {};
    if (fields.timestamp) updateData.timestamp = fields.timestamp;
    if (fields.entryType !== undefined) updateData.entry_type = fields.entryType;
    if (fields.jobId !== undefined) {
      updateData.job_id = fields.jobId;
    }

    const { data: updatedEntry, error: updateError } = await admin
      .from('time_entries')
      .update(updateData)
      .eq('id', entryId)
      .eq('organization_id', entry.organization_id)
      .select()
      .single();

    if (updateError || !updatedEntry) {
      return {
        success: false,
        error: timeWriteFailure('Error updating entry:', updateError, 'update_failed'),
      };
    }

    return { success: true, entry: toTimeEntry(updatedEntry) };
  } catch (error) {
    logError('Unexpected error in updateEntry:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Delete a time entry (admin/manager only)
 * For managers deleting their own entries, creates a change request for admin approval
 * @param entryId - The ID of the entry to delete (typically clock_in for pairs)
 * @param pairedEntryId - Optional ID of paired entry (clock_out) for paired delete requests
 */
export async function deleteEntry(
  rawEntryId: string,
  rawPairedEntryId?: string,
): Promise<DeleteEntryResult | RequestChangeResult> {
  try {
    const parsed = deleteEntryInputSchema.safeParse({ entryId: rawEntryId, pairedEntryId: rawPairedEntryId });
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const { entryId, pairedEntryId } = parsed.data;
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    // tenant-scope: by-id-then-verified — the caller's membership in the entry's organization is verified next, and every delete filters by that organization.
    const { data: entry, error: entryError } = await admin
      .from('time_entries')
      .select('*')
      .eq('id', entryId)
      .maybeSingle();

    if (entryError) return { success: false, error: 'load_failed' };
    if (!entry) return { success: false, error: 'entry_not_found' };

    const callerRole = await verifyCurrentMembership(entry.organization_id);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    // Get target user's role
    const { data: targetMember, error: targetMemberError } = await loggedRead(
      'deleteEntry: organization_members read failed',
      admin
        .from('organization_members')
        .select('role')
        .eq('user_id', entry.user_id)
        .eq('organization_id', entry.organization_id)
        .maybeSingle(),
    );
    if (targetMemberError) return { success: false, error: 'load_failed' };
    if (!targetMember) return { success: false, error: 'target_not_found' };

    const targetRole = targetMember.role as OrgRole;
    const isOwnEntry = entry.user_id === user.id;

    // Check if caller can manage this entry
    if (!canManageEntries(callerRole, targetRole, isOwnEntry)) {
      return { success: false, error: 'not_authorized' };
    }

    if (await entriesTouchClosedTimePeriod(admin, entry.organization_id, [entryId, pairedEntryId])) {
      return { success: false, error: 'period_closed' };
    }

    // The paired entry is caller-supplied: it must be a row of the same
    // person in the same organization as the authorized entry.
    if (pairedEntryId) {
      const { data: pairedEntry, error: pairedEntryError } = await loggedRead(
        'deleteEntry: time_entries read failed',
        admin
          .from('time_entries')
          .select('id')
          .eq('id', pairedEntryId)
          .eq('organization_id', entry.organization_id)
          .eq('user_id', entry.user_id)
          .maybeSingle(),
      );
      if (pairedEntryError) return { success: false, error: 'load_failed' };
      if (!pairedEntry) {
        return { success: false, error: 'entry_not_found' };
      }
    }

    // One statement deletes the entry and its verified pair together, so a
    // refused delete (an entry a work artifact or correction still references)
    // never leaves half of the pair behind.
    const { error: deleteError } = await admin
      .from('time_entries')
      .delete()
      .in('id', [entryId, pairedEntryId ?? entryId])
      .eq('organization_id', entry.organization_id);

    if (deleteError) {
      return {
        success: false,
        error: timeWriteFailure('Error deleting entry:', deleteError, 'delete_failed'),
      };
    }

    return { success: true };
  } catch (error) {
    logError('Unexpected error in deleteEntry:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Deletes entries of one organization that the caller may manage: all of them or none. */
export async function deleteEntriesBatch(rawEntryIds: string[]): Promise<DeleteEntryResult> {
  const parsed = entryIdListSchema.safeParse(rawEntryIds);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  if (parsed.data.length === 0) {
    return { success: true };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    const uniqueEntryIds = [...new Set(parsed.data)];
    const { data: entries, error: entriesError } = await readInBatches(uniqueEntryIds, (batch) =>
      // tenant-scope: by-id-then-verified — every entry must share one organization, whose membership and per-person rights are verified before the delete.
      admin
        .from('time_entries')
        .select('*')
        .in('id', [...batch]),
    );

    if (entriesError || !entries) return { success: false, error: 'load_failed' };
    if (entries.length !== uniqueEntryIds.length) {
      return { success: false, error: 'entry_not_found' };
    }

    const organizationId = entries[0]?.organization_id;
    if (!organizationId || entries.some((entry) => entry.organization_id !== organizationId)) {
      return { success: false, error: 'not_authorized' };
    }

    const callerRole = await verifyCurrentMembership(organizationId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    const uniqueUserIds = [...new Set(entries.map((entry) => entry.user_id))];
    const { data: memberRows, error: memberError } = await readInBatches(uniqueUserIds, (batch) =>
      admin
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', organizationId)
        .in('user_id', [...batch]),
    );

    if (memberError) {
      return { success: false, error: 'target_not_found' };
    }

    const roleMap = new Map(memberRows.map((member) => [member.user_id, member.role as OrgRole]));

    for (const entry of entries) {
      const targetRole = roleMap.get(entry.user_id);
      if (!targetRole) {
        return { success: false, error: 'target_not_found' };
      }

      const isOwnEntry = entry.user_id === user.id;
      if (!canManageEntries(callerRole, targetRole, isOwnEntry)) {
        return { success: false, error: 'not_authorized' };
      }
    }
    if (
      await touchesClosedTimePeriod(
        admin,
        organizationId,
        entries.map((entry) => entry.timestamp),
      )
    ) {
      return { success: false, error: 'period_closed' };
    }

    // One transaction: the function re-checks every entry under lock and deletes all or none.
    const { error: deleteError } = await admin.rpc(
      'delete_time_entries',
      rpcArgs('delete_time_entries', {
        p_actor_id: user.id,
        p_organization_id: organizationId,
        p_entry_ids: uniqueEntryIds,
        p_authorized_user_ids: uniqueUserIds,
      }),
    );
    if (deleteError) return timeEntryBatchFailure('Error deleting entries:', deleteError, 'delete_failed');

    return { success: true };
  } catch (error) {
    logError('Unexpected error in deleteEntriesBatch:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Query Actions
// ============================================

export async function getTimeEntries(rawParams: GetTimeEntriesParams): Promise<GetTimeEntriesResult> {
  try {
    const parsed = getTimeEntriesInputSchema.safeParse(rawParams);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const { organizationId, from, to, userId, status } = parsed.data;
    const fromTimestamp = Date.parse(from);
    const toTimestamp = Date.parse(to);
    if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp) || fromTimestamp > toTimestamp) {
      return { success: false, error: 'invalid_input' };
    }
    const normalizedFrom = new Date(fromTimestamp).toISOString();
    const normalizedTo = new Date(toTimestamp).toISOString();

    const callerRole = await verifyCurrentMembership(organizationId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    const admin = createSupabaseAdminClient();

    if (userId && !canViewEntries(callerRole, userId, user.id)) {
      return { success: false, error: 'not_authorized' };
    }

    let query = admin
      .from('time_entries')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('timestamp', normalizedFrom)
      .lte('timestamp', normalizedTo)
      .order('timestamp', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id');

    const effectiveUserId = callerRole === 'employee' ? user.id : userId;
    if (effectiveUserId) query = query.eq('user_id', effectiveUserId);

    if (status) {
      query = query.eq('status', status);
    }

    // Every read below depends only on the authorized scope and date window.
    // Start legacy rows alongside projections, not one database roundtrip earlier.
    const [legacyResult, canonicalResult, applications, provisionalProjection] = await Promise.all([
      readCompleteRows((from, to) => query.range(from, to), LIST_ROW_CAP),
      status && status !== 'approved'
        ? Promise.resolve({ success: true as const, entries: [] })
        : getCanonicalTimeEntries({
            organizationId,
            from: normalizedFrom,
            to: normalizedTo,
            userId: userId ?? (callerRole === 'employee' ? user.id : undefined),
          }),
      status && status !== 'approved'
        ? Promise.resolve([])
        : loadApprovedCorrectionProjection(admin, {
            organizationId,
            from: normalizedFrom,
            to: normalizedTo,
            ...(effectiveUserId ? { userIds: [effectiveUserId] } : {}),
          }),
      status
        ? Promise.resolve({ entries: [], sources: [] })
        : getProvisionalTimeCorrectionProjection({
            organizationId,
            from: normalizedFrom,
            to: normalizedTo,
            userId: userId ?? (callerRole === 'employee' ? user.id : undefined),
          }),
    ]);
    if (legacyResult.error) {
      logError('Error fetching time entries:', legacyResult.error);
      return { success: false, error: 'fetch_failed' };
    }
    const visibleEntries = (legacyResult.data ?? []).filter((entry) =>
      canViewEntries(callerRole, entry.user_id, user.id),
    );
    if (!canonicalResult.success) {
      return { success: false, error: 'fetch_failed' };
    }
    const canonicalEntries = canonicalResult.entries;
    const visibleCanonicalEntries = canonicalEntries.filter((entry) =>
      canViewEntries(callerRole, entry.userId, user.id),
    );
    const projectedEntries = applyApprovedTimeCorrections(
      [...toTimeEntries(visibleEntries), ...visibleCanonicalEntries],
      applications,
      organizationId,
    ).filter((entry) => {
      const timestamp = Date.parse(entry.timestamp);
      return (
        canViewEntries(callerRole, entry.userId, user.id) &&
        timestamp >= fromTimestamp &&
        timestamp <= toTimestamp &&
        (!userId || entry.userId === userId) &&
        (!status || entry.status === status)
      );
    });
    const pendingByLegacyId = new Map(
      provisionalProjection.sources
        .filter((source) => source.sourceKind === 'legacy_entry')
        .map((source) => [source.sourceId, source]),
    );
    const pendingBySegmentId = new Map(
      provisionalProjection.sources
        .filter((source) => source.sourceKind === 'canonical_segment')
        .map((source) => [source.sourceId, source]),
    );
    const pendingByApplicationId = new Map(
      provisionalProjection.sources
        .filter((source) => source.sourceKind === 'correction_application')
        .map((source) => [source.sourceId, source]),
    );
    const officialEntries = projectedEntries.map((entry) => {
      const pending =
        pendingByLegacyId.get(entry.id) ??
        (entry.canonicalSegmentId ? pendingBySegmentId.get(entry.canonicalSegmentId) : undefined) ??
        (entry.correctionApplicationId
          ? pendingByApplicationId.get(entry.correctionApplicationId)
          : undefined);
      return pending
        ? {
            ...entry,
            pendingCorrectionRequestId: pending.requestId,
            pendingCorrectionKind: pending.kind,
          }
        : entry;
    });
    return {
      success: true,
      entries: officialEntries.sort(
        (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
      ),
      provisionalEntries: provisionalProjection.entries,
    };
  } catch (error) {
    logReadFailure('Unexpected error in getTimeEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// The attention counts (lib/attention/actions.ts) are the one counting pipeline behind
// every badge; they derive the time share from getPendingSessions/getPendingChangeRequests.

/**
 * Get pending sessions (entries grouped as pairs with user profile info)
 */
export async function getPendingSessions(organizationId?: string): Promise<GetPendingSessionsResult> {
  try {
    const parsed = optionalOrganizationIdSchema.safeParse(organizationId);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = parsed.data ?? (await getCurrentOrgId(user.id));
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const callerRole = await verifyCurrentMembership(orgId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    // The holder lookup answers null for "not responsible" and for a failed
    // read alike; a failed read must not look like an empty queue.
    if (!(await loadResponsibilityRuntimeState(orgId))) {
      return { success: false, error: 'responsibility_load_failed' };
    }
    const responsibilityHolder = await getEffectiveResponsibilityHolderForActor({
      organizationId: orgId,
      responsibility: 'time_approval',
      actorUserId: user.id,
    });
    if (!responsibilityHolder) {
      return { success: true, sessions: [] };
    }

    return await readPendingSessionQueue({
      admin: createSupabaseAdminClient(),
      organizationId: orgId,
      callerRole,
      holder: responsibilityHolder,
    });
  } catch (error) {
    logError('Unexpected error in getPendingSessions:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Change Request Actions
// ============================================

/**
 * Get pending change requests for the organization (admin only)
 */
export async function getPendingChangeRequests(organizationId?: string): Promise<GetChangeRequestsResult> {
  try {
    const parsed = optionalOrganizationIdSchema.safeParse(organizationId);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = parsed.data ?? (await getCurrentOrgId(user.id));
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const callerRole = await verifyCurrentMembership(orgId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    if (callerRole !== 'admin') {
      return { success: false, error: 'not_authorized' };
    }

    return await readPendingChangeRequestQueue({ admin: createSupabaseAdminClient(), organizationId: orgId });
  } catch (error) {
    logError('Unexpected error in getPendingChangeRequests:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** The refusals of decide_entry_change_request (migration 20261004180400): each message is an action failure code. */
const CHANGE_REQUEST_DECISION_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_input',
  'request_not_found',
  'not_a_member',
  'not_authorized',
  'request_already_reviewed',
]);

/**
 * Review a change request (edit or delete) from a manager.
 *
 * IMMEDIATE EFFECT MODEL:
 * - Edits are applied immediately when requested, original_timestamp stores the pre-edit value
 * - Deletes mark entries as 'pending_delete' immediately
 *
 * On approval:
 * - Edit: Nothing to do, the edit is already applied
 * - Delete: Actually delete the entries (they're currently marked pending_delete)
 *
 * On rejection:
 * - Edit: Revert timestamp to original_timestamp
 * - Delete: Restore entries to 'approved' status
 */
export async function reviewChangeRequest(
  rawRequestId: string,
  rawAction: 'approve' | 'reject',
): Promise<ReviewChangeRequestResult> {
  try {
    const parsed = reviewChangeRequestInputSchema.safeParse({ requestId: rawRequestId, action: rawAction });
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const { requestId, action } = parsed.data;
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    // tenant-scope: by-id-then-verified — the caller must be an admin of the request's organization, and the decision function is scoped to that organization.
    const { data: request, error: requestError } = await admin
      .from('entry_change_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();

    if (requestError) {
      logReadFailure('reviewChangeRequest: request read failed', requestError);
      return { success: false, error: 'fetch_failed' };
    }
    if (!request) {
      return { success: false, error: 'request_not_found' };
    }

    const callerRole = await verifyCurrentMembership(request.organization_id);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    if (callerRole !== 'admin') {
      return { success: false, error: 'not_authorized' };
    }

    // Check request is still pending
    if (request.status !== 'pending') {
      return { success: false, error: 'request_already_reviewed' };
    }

    // Every decision except approving an already applied edit writes the entries.
    const writesEntries = action === 'reject' || request.change_type === 'delete';
    if (
      writesEntries &&
      (await entriesTouchClosedTimePeriod(
        admin,
        request.organization_id,
        [request.entry_id, request.paired_entry_id],
        [request.original_timestamp],
      ))
    ) {
      return { success: false, error: 'period_closed' };
    }

    // One transaction: the function re-checks the request and the caller's
    // role under lock, records the decision and applies it to the entries, or
    // changes nothing.
    const { data: updatedRequest, error: decisionError } = await admin.rpc(
      'decide_entry_change_request',
      rpcArgs('decide_entry_change_request', {
        p_actor_id: user.id,
        p_organization_id: request.organization_id,
        p_request_id: requestId,
        p_decision: action,
      }),
    );
    if (decisionError) {
      if (CHANGE_REQUEST_DECISION_REFUSALS.has(decisionError.message)) {
        return { success: false, error: decisionError.message };
      }
      return {
        success: false,
        error: timeWriteFailure(
          'reviewChangeRequest: decide_entry_change_request failed',
          decisionError,
          'update_failed',
        ),
      };
    }

    return { success: true, request: toChangeRequest(updatedRequest) };
  } catch (error) {
    logError('Unexpected error in reviewChangeRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Calendar Visualization Helpers
// ============================================

/**
 * Get pending change requests for a list of entry IDs
 * Used for calendar visualization to show edit/delete diffs
 */
export async function getChangeRequestsForEntries(
  entryIds: string[],
): Promise<{ success: true; requests: ChangeRequest[] } | ActionFailure> {
  const parsed = calendarEntryIdListSchema.safeParse(entryIds);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const persistedEntryIds = [...new Set(parsed.data)].filter(isUuid);
  if (persistedEntryIds.length === 0) {
    return { success: true, requests: [] };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    // Caller-supplied entry IDs are a filter, not an authorization: only
    // organizations the caller belongs to are queried, and employees see only
    // requests they raised or that concern their own entries (SI-002).
    const memberships = await getCachedMemberships(user.id);
    if (memberships.length === 0) {
      return { success: true, requests: [] };
    }
    const roleByOrganization = new Map(
      memberships.map((membership) => [membership.orgId, membership.role as OrgRole]),
    );

    const admin = createSupabaseAdminClient();

    const { requests, entryOwnerById, error } = await readPendingChangeRequestData(admin, persistedEntryIds, [
      ...roleByOrganization.keys(),
    ]);
    if (error) {
      logError('Error fetching change requests for entries');
      return { success: false, error: 'fetch_failed' };
    }

    const visible = requests.filter((request) =>
      canViewChangeRequest(
        {
          organizationId: request.organization_id,
          requestedBy: request.requested_by,
          entryUserId: entryOwnerById.get(request.entry_id) ?? null,
        },
        { userId: user.id, roleByOrganization },
      ),
    );

    return {
      success: true,
      requests: visible.map(toChangeRequest),
    };
  } catch (error) {
    logError('Unexpected error in getChangeRequestsForEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get all time entries linked to a specific job.
 */
export async function getTimeEntriesForJob(rawJobId: string): Promise<GetTimeEntriesResult> {
  try {
    const parsed = uuidSchema.safeParse(rawJobId);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const jobId = parsed.data;
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    // tenant-scope: by-id-then-verified — the caller's membership in the job's organization is verified next, and every later read filters by it.
    const { data: job, error: jobError } = await admin
      .from('jobs')
      .select('id, organization_id')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      logReadErrors('getTimeEntriesForJob: read failed', jobError);
      return { success: false, error: 'fetch_failed' };
    }

    const callerRole = await verifyCurrentMembership(job.organization_id);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    if (callerRole !== 'admin' && callerRole !== 'buero') {
      const { data: assignment, error: assignmentError } = await loggedRead(
        'getTimeEntriesForJob: job_assignments read failed',
        admin
          .from('job_assignments')
          .select('id')
          .eq('organization_id', job.organization_id)
          .eq('job_id', jobId)
          .eq('user_id', user.id)
          .maybeSingle(),
      );
      if (assignmentError) return { success: false, error: 'fetch_failed' };

      if (!assignment) {
        return { success: false, error: 'not_authorized' };
      }
    }

    const isManager = callerRole === 'admin' || callerRole === 'buero';
    const projectionTime = new Date().toISOString();
    const canonicalResult = await getCanonicalTimeEntries({
      organizationId: job.organization_id,
      from: '1970-01-01T00:00:00.000Z',
      to: projectionTime,
      userId: isManager ? undefined : user.id,
      jobId,
      referenceTime: projectionTime,
    });
    if (!canonicalResult.success) {
      return { success: false, error: 'fetch_failed' };
    }
    const canonicalEntries = canonicalResult.entries;
    const correctionApplications = await loadApprovedCorrectionProjection(admin, {
      organizationId: job.organization_id,
      from: '1970-01-01T00:00:00.000Z',
      to: projectionTime,
      ...(!isManager ? { userIds: [user.id] } : {}),
    });
    const projectJobEntries = (entries: readonly TimeEntry[]): TimeEntry[] =>
      applyApprovedTimeCorrections(entries, correctionApplications, job.organization_id).filter(
        (entry) => entry.jobId === jobId && (isManager || entry.userId === user.id),
      );
    // Null when the names could not be read: the read fails instead of listing nobody.
    async function loadParticipants(entries: readonly TimeEntry[]): Promise<JobTimeParticipant[] | null> {
      if (!isManager) return [];
      const participantUserIds = [...new Set(entries.map((entry) => entry.userId))];
      if (participantUserIds.length === 0) return [];

      const { data: participantProfiles, error: participantProfilesError } = await readInBatches(
        participantUserIds,
        (batch) =>
          admin
            .from('profiles')
            .select('id, first_name, last_name, email, avatar_path')
            .in('id', [...batch]),
      );

      if (participantProfilesError) {
        logError('Error fetching participant profiles for job time entries:', participantProfilesError);
        return null;
      }

      return participantProfiles.map((profile) => ({
        userId: profile.id,
        firstName: profile.first_name ?? null,
        lastName: profile.last_name ?? null,
        email: profile.email ?? null,
        avatarPath: profile.avatar_path ?? null,
      }));
    }
    let jobClockInsQuery = admin
      .from('time_entries')
      .select('*')
      .eq('organization_id', job.organization_id)
      .eq('entry_type', 'clock_in')
      .eq('job_id', jobId)
      .neq('status', 'rejected');

    if (!isManager) {
      jobClockInsQuery = jobClockInsQuery.eq('user_id', user.id);
    }

    const orderedJobClockIns = jobClockInsQuery.order('timestamp', { ascending: true }).order('id');
    const { data: jobClockIns, error: jobClockInsError } = await readCompleteRows(
      (from, to) => orderedJobClockIns.range(from, to),
      LIST_ROW_CAP,
    );

    if (jobClockInsError) {
      logError('Error fetching clock-ins for job:', jobClockInsError);
      return { success: false, error: 'fetch_failed' };
    }

    const targetClockIns = toTimeEntries(jobClockIns || []);
    if (targetClockIns.length === 0) {
      const correctedCanonicalEntries = projectJobEntries(canonicalEntries);
      const canonicalParticipants = await loadParticipants(correctedCanonicalEntries);
      if (!canonicalParticipants) return { success: false, error: 'fetch_failed' };
      return { success: true, entries: correctedCanonicalEntries, participants: canonicalParticipants };
    }

    const userIds = [...new Set(targetClockIns.map((entry) => entry.userId))];
    const targetDayKeys = new Set(
      targetClockIns.map(
        (entry) => `${entry.userId}:${entry.organizationId}:${getLocalDayKey(new Date(entry.timestamp))}`,
      ),
    );
    const timestamps = targetClockIns.map((entry) => new Date(entry.timestamp).getTime());
    const rangeStart = getLocalDayStart(new Date(Math.min(...timestamps))).toISOString();
    const rangeEnd = getLocalDayEnd(new Date(Math.max(...timestamps))).toISOString();

    // Every clock-in above belongs to the job's organization. One user sits in
    // one batch, so each user's days keep their timestamp order.
    const { data, error } = await readInBatches(userIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_entries')
            .select('*')
            .in('user_id', [...batch])
            .eq('organization_id', job.organization_id)
            .gte('timestamp', rangeStart)
            .lte('timestamp', rangeEnd)
            .neq('status', 'rejected')
            .order('timestamp', { ascending: true })
            .order('created_at', { ascending: true })
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    );

    if (error) {
      logError('Error fetching session-aware time entries for job:', error);
      return { success: false, error: 'fetch_failed' };
    }

    const relevantEntries = toTimeEntries(data || []).filter((entry) =>
      targetDayKeys.has(
        `${entry.userId}:${entry.organizationId}:${getLocalDayKey(new Date(entry.timestamp))}`,
      ),
    );
    const entriesByUserDay = new Map<string, TimeEntry[]>();

    for (const entry of relevantEntries) {
      const key = `${entry.userId}:${entry.organizationId}:${getLocalDayKey(new Date(entry.timestamp))}`;
      const existing = entriesByUserDay.get(key);
      if (existing) {
        existing.push(entry);
      } else {
        entriesByUserDay.set(key, [entry]);
      }
    }

    const dedupedEntries = new Map<string, TimeEntry>();

    for (const entry of canonicalEntries) {
      dedupedEntries.set(entry.id, entry);
    }

    for (const entriesForDay of entriesByUserDay.values()) {
      const sessions = calculateWorkSessions(entriesForDay).filter(
        (session) => session.clockIn?.jobId === jobId,
      );

      for (const session of sessions) {
        if (session.clockIn) {
          dedupedEntries.set(session.clockIn.id, session.clockIn);
        }
        if (session.clockOut) {
          dedupedEntries.set(session.clockOut.id, session.clockOut);
        }
      }
    }

    const correctedEntries = projectJobEntries([...dedupedEntries.values()]);
    const participants = await loadParticipants(correctedEntries);
    if (!participants) return { success: false, error: 'fetch_failed' };

    return {
      success: true,
      entries: correctedEntries.sort((a, b) => {
        const timestampDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        if (timestampDiff !== 0) return timestampDiff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }),
      participants,
    };
  } catch (error) {
    logError('Unexpected error in getTimeEntriesForJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getTimeEntriesForProjectJobs(
  rawProjectId: string,
): Promise<{ success: true; jobs: Array<{ jobId: string; entries: TimeEntry[] }> } | ActionFailure> {
  try {
    const parsed = uuidSchema.safeParse(rawProjectId);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: 'not_authenticated' };

    const admin = createSupabaseAdminClient();
    // tenant-scope: by-id-then-verified — the caller's membership in the project's organization is verified next, and every later read filters by it.
    const { data: project, error: projectError } = await admin
      .from('projects')
      .select('id, organization_id')
      .eq('id', parsed.data)
      .maybeSingle();
    if (projectError || !project) {
      logReadErrors('getTimeEntriesForProjectJobs: read failed', projectError);
      return { success: false, error: 'fetch_failed' };
    }

    const callerRole = await verifyCurrentMembership(project.organization_id);
    if (!callerRole) return { success: false, error: 'not_a_member' };

    const { data: projectJobs, error: jobsError } = await admin
      .from('jobs')
      .select('id')
      .eq('organization_id', project.organization_id)
      .eq('project_id', project.id);
    if (jobsError) {
      logReadErrors('getTimeEntriesForProjectJobs: read failed', jobsError);
      return { success: false, error: 'fetch_failed' };
    }

    let visibleJobIds = (projectJobs ?? []).map((job) => job.id);
    if (callerRole === 'employee' && visibleJobIds.length > 0) {
      const { data: assignments, error: assignmentsError } = await readInBatches(visibleJobIds, (batch) =>
        admin
          .from('job_assignments')
          .select('job_id')
          .eq('organization_id', project.organization_id)
          .eq('user_id', user.id)
          .in('job_id', [...batch]),
      );
      if (assignmentsError) {
        logReadErrors('getTimeEntriesForProjectJobs: read failed', assignmentsError);
        return { success: false, error: 'fetch_failed' };
      }
      visibleJobIds = assignments.map((assignment) => assignment.job_id);
    }

    const results: Array<{
      jobId: string;
      result: Awaited<ReturnType<typeof getTimeEntriesForJob>>;
    }> = [];
    const jobReadConcurrency = 4;
    for (let offset = 0; offset < visibleJobIds.length; offset += jobReadConcurrency) {
      const batch = visibleJobIds.slice(offset, offset + jobReadConcurrency);
      results.push(
        ...(await Promise.all(
          batch.map(async (jobId) => ({
            jobId,
            result: await getTimeEntriesForJob(jobId),
          })),
        )),
      );
    }
    const failedResult = results.find(({ result }) => !result.success);
    if (failedResult && !failedResult.result.success) {
      return { success: false, error: failedResult.result.error };
    }
    return {
      success: true,
      jobs: results.map(({ jobId, result }) => ({
        jobId,
        entries: result.success ? result.entries : [],
      })),
    };
  } catch (error) {
    logError('Unexpected error in getTimeEntriesForProjectJobs:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get the caller's current clock state together with active job info.
 * Used by the shared client clock state and Zeiterfassung overview prefetch.
 */
export async function getCurrentClockState(
  rawOrganizationId: string,
): Promise<{ success: true; state: LiveClockState } | ActionFailure> {
  try {
    const parsed = uuidSchema.safeParse(rawOrganizationId);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const organizationId = parsed.data;
    const canonical = await getCanonicalClockState(organizationId);
    if (!canonical.success) return canonical;
    if (canonical.state) return { success: true, state: canonical.state };

    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    const [userRole, todayRows, organizationSettings] = await Promise.all([
      verifyCurrentMembership(organizationId),
      getUserTodayEntries(admin, user.id, organizationId),
      readOrganizationSettings(organizationId),
    ]);

    if (!userRole) {
      return { success: false, error: 'not_a_member' };
    }
    if (!organizationSettings || !todayRows) return { success: false, error: 'fetch_failed' };

    const timeEntries = toTimeEntries(todayRows);
    const currentState = deriveCurrentClockState(timeEntries);
    const workSessions = calculateWorkSessions(timeEntries);
    const breakSessions = calculateBreakSessions(timeEntries);
    const timelineSegments = buildClockTimelineSegments(timeEntries, new Date(), {
      sameLocalDayOnly: true,
      includeOpenSegment: false,
    });
    const trackedWorkMinutes = calculateTotalMinutes(workSessions);
    const trackedBreakMinutes = calculateBreakMinutes(breakSessions);
    const todayMinutes = trackedWorkMinutes + trackedBreakMinutes;
    const breakdown = computeBreakdownForSettings(todayMinutes, trackedBreakMinutes, organizationSettings);
    const noJob = { success: true as const, info: null };
    const activeJob = currentState.activeJobId
      ? await getClockJobInfo(admin, organizationId, currentState.activeJobId)
      : noJob;
    if (!activeJob.success) return activeJob;
    // Legacy events know only work and breaks, so the resumable activity is
    // work on the job the break interrupted (or unallocated work).
    const resumeActivity: TimeActivitySelection | null = currentState.isClockedIn
      ? createActivitySelection('work', currentState.resumeJobId)
      : null;
    const resumeJob = !currentState.resumeJobId
      ? noJob
      : currentState.resumeJobId === currentState.activeJobId
        ? activeJob
        : await getClockJobInfo(admin, organizationId, currentState.resumeJobId);
    if (!resumeJob.success) return resumeJob;

    return {
      success: true,
      state: {
        organizationId,
        breakMode: organizationSettings.breakMode,
        autoBreakThresholdMinutes: organizationSettings.autoBreakThresholdMinutes,
        autoBreakDurationMinutes: organizationSettings.autoBreakDurationMinutes,
        status: currentState.status,
        isClockedIn: currentState.isClockedIn,
        isOnBreak: currentState.isOnBreak,
        clockInTime: currentState.clockInTime,
        statusStartedAt: currentState.statusStartedAt,
        breakStartTime: currentState.breakStartTime,
        todayMinutes,
        workMinutes: breakdown.workMinutes,
        breakMinutes: breakdown.breakMinutes,
        timelineSegments,
        activeJobId: currentState.activeJobId,
        activeJobInfo: activeJob.info,
        captureModel: currentState.isClockedIn ? 'legacy' : 'none',
        sessionId: null,
        sessionVersion: null,
        currentSegmentId: null,
        currentActivity: currentState.isClockedIn
          ? currentState.isOnBreak
            ? {
                kind: 'break',
                allocationKind: 'none',
              }
            : currentState.activeJobId
              ? {
                  kind: 'work',
                  allocationKind: 'job',
                  jobId: currentState.activeJobId,
                }
              : {
                  kind: 'work',
                  allocationKind: 'unallocated',
                  jobId: null,
                }
          : null,
        resumeActivity,
        resumeJobInfo: resumeJob.info,
        recoveryReason: null,
        legacyOpen: currentState.isClockedIn,
        standbyMinutes: 0,
        travelMinutes: 0,
        calloutMinutes: 0,
        internalMinutes: 0,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    logError('Unexpected error in getCurrentClockState:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get the set of job IDs that currently have at least one worker clocked in.
 * Used for the "active work" pulsation indicator across all tables.
 */
export async function getActiveJobIdsForOrg(
  rawOrganizationId: string,
): Promise<{ success: true; activeJobIds: string[]; activeProjectIds: string[] } | ActionFailure> {
  try {
    const parsed = uuidSchema.safeParse(rawOrganizationId);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const organizationId = parsed.data;
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const callerRole = await verifyCurrentMembership(organizationId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    const admin = createSupabaseAdminClient();
    const { start } = getTodayBounds();

    const [legacyResult, canonicalResult] = await Promise.all([
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_entries')
            .select('user_id, entry_type, timestamp, job_id')
            .eq('organization_id', organizationId)
            .gte('timestamp', start.toISOString())
            .lte('timestamp', new Date().toISOString())
            .neq('status', 'rejected')
            .neq('status', 'pending_delete')
            .order('timestamp', { ascending: false })
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_segments')
            .select('job_id, time_sessions!inner(status, ended_at)')
            .eq('organization_id', organizationId)
            .is('ended_at', null)
            .is('time_sessions.ended_at', null)
            .in('kind', ['work', 'callout'])
            .not('job_id', 'is', null)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ]);

    if (legacyResult.error || canonicalResult.error) {
      logReadFailure('Error fetching active job ids:', legacyResult.error ?? canonicalResult.error);
      return { success: false, error: 'fetch_failed' };
    }

    const activeJobIds = collectActiveJobIds(legacyResult.data, canonicalResult.data);
    const jobs = await readInBatches(activeJobIds, (ids) =>
      admin
        .from('jobs')
        .select('id,project_id')
        .eq('organization_id', organizationId)
        .in('id', [...ids]),
    );
    if (jobs.error) {
      logReadErrors('getActiveJobIdsForOrg: read failed', jobs.error);
      return { success: false, error: 'fetch_failed' };
    }
    return {
      success: true,
      activeJobIds,
      activeProjectIds: [...new Set(jobs.data.flatMap((job) => (job.project_id ? [job.project_id] : [])))],
    };
  } catch (error) {
    logError('Unexpected error in getActiveJobIdsForOrg:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

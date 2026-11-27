'use server';
import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { logReadFailure, logReadErrors } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { resolveActionContextFor, type ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { getAuthenticatedUser, getOwnEmployeeRecordId } from '@/lib/data/cached';
import { uuidSchema } from '@/lib/validation/uuid';
import { readOrganizationSettings } from './organization-settings-read';
import { type LiveClockState, type TimeActivitySelection, toTimeEntries } from './types';
import { deriveCurrentClockState } from './helpers';
import { loadApprovedCorrectionProjection } from '@/lib/time-corrections/approved-projection';
import { correctedEntriesInWindow } from '@/lib/time-corrections/projection';
import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import {
  buildCanonicalClockState,
  clockTotalsState,
  readCanonicalClockDay,
  readClockJobs,
  type ClockTotalsState,
} from './canonical-clock-state';
import { endSessionBeforeSignOut } from './sign-out-session-end';
import { createActivitySelection } from './segments';
import { collectActiveJobIds } from './active-jobs';
import { getOpenSessionOrgsForUserOnDay } from './open-session-orgs';
import { getDayBounds, getUserEntriesForDay } from './action-access';

// The clock Server Actions: the caller's live clock state, the jobs someone
// works on right now, and the clock-out before sign-out.

// ============================================
// Real-Time Clock In/Out Actions
// ============================================

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
      .select('id, organization_id, version, status, started_at')
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
      if (await endSessionBeforeSignOut(admin, user.id, session)) {
        canonicalClosedOrgIds.add(session.organization_id);
      } else {
        failedOrgIds.add(session.organization_id);
      }
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

type LegacyClockState = ReturnType<typeof deriveCurrentClockState>;

/** The activity a legacy event stream is in: a break, work on its job, or unallocated work. */
function getLegacyCurrentActivity(currentState: LegacyClockState): TimeActivitySelection | null {
  if (!currentState.isClockedIn) return null;
  if (currentState.isOnBreak) return { kind: 'break', allocationKind: 'none' };
  return currentState.activeJobId
    ? { kind: 'work', allocationKind: 'job', jobId: currentState.activeJobId }
    : { kind: 'work', allocationKind: 'unallocated', jobId: null };
}

/**
 * The clock state without an open canonical session: a running legacy event
 * stream, or nothing running. Today's totals keep the minutes of both capture
 * models, so a clock-out never resets the day to zero.
 */
async function buildLegacyClockState(
  admin: AdminClient,
  input: {
    organizationId: string;
    currentState: LegacyClockState;
    totals: ClockTotalsState;
    now: Date;
  },
): Promise<ActionResult<{ state: LiveClockState }>> {
  const { organizationId, currentState } = input;
  // Legacy events know only work and breaks, so the resumable activity is
  // work on the job the break interrupted (or unallocated work).
  const resumeActivity: TimeActivitySelection | null = currentState.isClockedIn
    ? createActivitySelection('work', currentState.resumeJobId)
    : null;
  const jobs = await readClockJobs(admin, organizationId, currentState.activeJobId, currentState.resumeJobId);
  if (!jobs.success) return jobs;
  return {
    success: true,
    state: {
      ...input.totals,
      organizationId,
      status: currentState.status,
      isClockedIn: currentState.isClockedIn,
      isOnBreak: currentState.isOnBreak,
      clockInTime: currentState.clockInTime,
      statusStartedAt: currentState.statusStartedAt,
      breakStartTime: currentState.breakStartTime,
      activeJobId: currentState.activeJobId,
      activeJobInfo: jobs.activeJobInfo,
      captureModel: currentState.isClockedIn ? 'legacy' : 'none',
      sessionId: null,
      sessionVersion: null,
      currentSegmentId: null,
      currentActivity: getLegacyCurrentActivity(currentState),
      resumeActivity,
      resumeJobInfo: jobs.resumeJobInfo,
      recoveryReason: null,
      legacyOpen: currentState.isClockedIn,
      fetchedAt: input.now.toISOString(),
    },
  };
}

/**
 * The approved corrections of the caller's day, as the week reads them; null
 * when a read fails. Each keeps every source it replaces, and only the facts
 * of the caller's effective employee record: a fact that names the caller's
 * user on a record they no longer hold is retained data of a removed
 * employee (docs/technical/security.md, "Calendar correction input boundary").
 */
async function readTodaysCorrections(
  admin: AdminClient,
  input: { organizationId: string; userId: string; dayStart: Date; dayEnd: Date },
): Promise<TimeCorrectionApplicationProjection[] | null> {
  try {
    const [employeeRecordId, applications] = await Promise.all([
      getOwnEmployeeRecordId(input.userId, input.organizationId),
      loadApprovedCorrectionProjection(admin, {
        organizationId: input.organizationId,
        userIds: [input.userId],
        from: input.dayStart.toISOString(),
        to: input.dayEnd.toISOString(),
      }),
    ]);
    return applications.map((application) => ({
      ...application,
      snapshot: {
        ...application.snapshot,
        facts: application.snapshot.facts.filter(
          (fact) => fact.employeeRecordId === employeeRecordId && fact.userId === input.userId,
        ),
      },
    }));
  } catch (error) {
    logReadFailure('getCurrentClockState: approved corrections read failed', error);
    return null;
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
    const caller = await resolveActionContextFor(organizationId);
    if (!caller.success) return caller;
    const userId = caller.context.userId;

    const admin = createSupabaseAdminClient();
    const now = new Date();
    const { start: dayStart, end: dayEnd } = getDayBounds(now);
    const [canonicalDay, todayRows, settings, applications] = await Promise.all([
      readCanonicalClockDay(admin, { organizationId, userId, dayStart, dayEnd, now }),
      getUserEntriesForDay(admin, userId, organizationId, now),
      readOrganizationSettings(organizationId),
      readTodaysCorrections(admin, { organizationId, userId, dayStart, dayEnd }),
    ]);
    if (!canonicalDay || !todayRows || !settings || !applications) {
      return { success: false, error: 'fetch_failed' };
    }

    const legacyEntries = toTimeEntries(todayRows);
    const legacyState = deriveCurrentClockState(legacyEntries);
    // Today's closed minutes from the records the week reads, the caller's
    // own only: a reassignment's facts name the person who now holds the
    // time. The running activity comes from the open session or legacy stream below.
    const dayEntries = correctedEntriesInWindow(
      [...legacyEntries, ...canonicalDay.entries],
      applications,
      organizationId,
      { fromMs: dayStart.getTime(), toMs: dayEnd.getTime() },
    ).filter((entry) => entry.userId === userId);
    const running = canonicalDay.openSession !== null || legacyState.isClockedIn;
    const totals = clockTotalsState(dayEntries, settings, running, now);
    const result = canonicalDay.openSession
      ? await buildCanonicalClockState(admin, {
          organizationId,
          totals,
          session: canonicalDay.openSession,
          day: canonicalDay,
          now,
        })
      : await buildLegacyClockState(admin, { organizationId, currentState: legacyState, totals, now });
    return result.success ? { success: true, state: result.state } : result;
  } catch (error) {
    logError('Unexpected error in getCurrentClockState:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * The active jobs the caller may see, with their projects. An employee learns
 * only which of their own assigned jobs, and the projects of those, someone
 * works on; Admin and Büro see all of them. Null when a read fails.
 */
async function readVisibleActiveWork(
  admin: AdminClient,
  context: ActionContext,
  activeJobIds: string[],
): Promise<{ activeJobIds: string[]; activeProjectIds: string[] } | null> {
  const [jobs, ownAssignments] = await Promise.all([
    readInBatches(activeJobIds, (ids) =>
      admin
        .from('jobs')
        .select('id,project_id')
        .eq('organization_id', context.orgId)
        .in('id', [...ids]),
    ),
    context.isManagerOrAbove
      ? null
      : readInBatches(activeJobIds, (ids) =>
          admin
            .from('job_assignments')
            .select('job_id')
            .eq('organization_id', context.orgId)
            .eq('user_id', context.userId)
            .in('job_id', [...ids]),
        ),
  ]);
  if (jobs.error || ownAssignments?.error) {
    logReadErrors('readVisibleActiveWork: read failed', jobs.error, ownAssignments?.error);
    return null;
  }
  const assignedJobIds = ownAssignments && new Set(ownAssignments.data.map((row) => row.job_id));
  const visible = (jobId: string) => !assignedJobIds || assignedJobIds.has(jobId);
  return {
    activeJobIds: activeJobIds.filter(visible),
    activeProjectIds: [
      ...new Set(jobs.data.flatMap((job) => (job.project_id && visible(job.id) ? [job.project_id] : []))),
    ],
  };
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
    const caller = await resolveActionContextFor(organizationId);
    if (!caller.success) return caller;

    const admin = createSupabaseAdminClient();
    const { start } = getDayBounds(new Date());

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
    const visible = await readVisibleActiveWork(admin, caller.context, activeJobIds);
    return visible ? { success: true, ...visible } : { success: false, error: 'fetch_failed' };
  } catch (error) {
    logError('Unexpected error in getActiveJobIdsForOrg:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

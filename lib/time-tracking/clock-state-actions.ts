'use server';
import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { logReadFailure, logReadErrors } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { uuidSchema } from '@/lib/validation/uuid';
import { readOrganizationSettings } from './organization-settings-read';
import { type LiveClockState, type TimeActivitySelection, type TimeEntry, toTimeEntries } from './types';
import { deriveCurrentClockState } from './helpers';
import {
  buildCanonicalClockState,
  clockTotalsState,
  readCanonicalClockDay,
  readClockJobs,
} from './canonical-clock-state';
import {
  canonicalDayTotals,
  combineClockDayTotals,
  legacyDayTotals,
  type ClockDayTotals,
} from './clock-day-totals';
import { endSessionBeforeSignOut } from './sign-out-session-end';
import { createActivitySelection } from './segments';
import { collectActiveJobIds } from './active-jobs';
import { getOpenSessionOrgsForUserOnDay } from './open-session-orgs';
import { getDayBounds, getUserEntriesForDay, verifyCurrentMembership } from './action-access';

type OrganizationClockSettings = NonNullable<Awaited<ReturnType<typeof readOrganizationSettings>>>;

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
    settings: OrganizationClockSettings;
    entries: TimeEntry[];
    totals: ClockDayTotals;
    now: Date;
  },
): Promise<ActionResult<{ state: LiveClockState }>> {
  const { organizationId } = input;
  const currentState = deriveCurrentClockState(input.entries);
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
      ...clockTotalsState(input.totals, input.settings),
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
    const [canonicalDay, todayRows, settings] = await Promise.all([
      readCanonicalClockDay(admin, { organizationId, userId, dayStart, dayEnd }),
      getUserEntriesForDay(admin, userId, organizationId, now),
      readOrganizationSettings(organizationId),
    ]);
    if (!canonicalDay || !todayRows || !settings) return { success: false, error: 'fetch_failed' };

    const entries = toTimeEntries(todayRows);
    const legacyTotals = legacyDayTotals(entries, now);
    const result = canonicalDay.openSession
      ? await buildCanonicalClockState(admin, {
          organizationId,
          settings,
          session: canonicalDay.openSession,
          day: canonicalDay,
          legacyTotals,
          now,
          dayStart,
          dayEnd,
        })
      : await buildLegacyClockState(admin, {
          organizationId,
          settings,
          entries,
          totals: combineClockDayTotals(
            legacyTotals,
            canonicalDayTotals(canonicalDay.segments, dayStart, dayEnd),
          ),
          now,
        });
    return result.success ? { success: true, state: result.state } : result;
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

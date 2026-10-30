'use server';
import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { logReadFailure, loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { readOrganizationSettings } from './organization-settings-read';
import {
  type TimeEntryRow,
  type LiveClockState,
  type TimeActivitySelection,
  toTimeEntries,
  type ClockJobInfo,
  type ClockTimelineSegment,
} from './types';
import {
  buildClockTimelineSegments,
  calculateBreakMinutes,
  deriveCurrentClockState,
  calculateTotalMinutes,
  calculateBreakSessions,
  calculateWorkSessions,
} from './helpers';
import { uuidSchema } from '@/lib/validation/uuid';
import { computeBreakdownForSettings } from './settings';
import { getJobDisplayTitle } from '@/lib/jobs/types';
import { getCanonicalClockState } from './segment-actions';
import { endSessionBeforeSignOut } from './sign-out-session-end';
import { createActivitySelection } from './segments';
import { collectActiveJobIds } from './active-jobs';
import { getOpenSessionOrgsForUserOnDay } from './open-session-orgs';
import { getDayBounds, getUserEntriesForDay, verifyCurrentMembership } from './action-access';

// The clock Server Actions: the caller's live clock state, the jobs someone
// works on right now, and the clock-out before sign-out.

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
      projectName: projectData.data?.name ?? null,
      clientName: clientData.data?.name ?? null,
    },
  };
}

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
      if (await endSessionBeforeSignOut(admin, user.id, session)) canonicalClosedOrgIds.add(session.organization_id);
      else failedOrgIds.add(session.organization_id);
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
type OrganizationClockSettings = NonNullable<Awaited<ReturnType<typeof readOrganizationSettings>>>;

/** The activity a legacy event stream is in: a break, work on its job, or unallocated work. */
function getLegacyCurrentActivity(currentState: LegacyClockState): TimeActivitySelection | null {
  if (!currentState.isClockedIn) return null;
  if (currentState.isOnBreak) return { kind: 'break', allocationKind: 'none' };
  return currentState.activeJobId
    ? { kind: 'work', allocationKind: 'job', jobId: currentState.activeJobId }
    : { kind: 'work', allocationKind: 'unallocated', jobId: null };
}

/** The live clock state of a legacy event stream, from its already derived parts. */
function legacyLiveClockState(input: {
  organizationId: string;
  organizationSettings: OrganizationClockSettings;
  currentState: LegacyClockState;
  todayMinutes: number;
  breakdown: ReturnType<typeof computeBreakdownForSettings>;
  timelineSegments: ClockTimelineSegment[];
  activeJobInfo: ClockJobInfo | null;
  resumeActivity: TimeActivitySelection | null;
  resumeJobInfo: ClockJobInfo | null;
}): LiveClockState {
  const { organizationSettings, currentState, breakdown } = input;
  return {
    organizationId: input.organizationId,
    breakMode: organizationSettings.breakMode,
    autoBreakThresholdMinutes: organizationSettings.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: organizationSettings.autoBreakDurationMinutes,
    status: currentState.status,
    isClockedIn: currentState.isClockedIn,
    isOnBreak: currentState.isOnBreak,
    clockInTime: currentState.clockInTime,
    statusStartedAt: currentState.statusStartedAt,
    breakStartTime: currentState.breakStartTime,
    todayMinutes: input.todayMinutes,
    workMinutes: breakdown.workMinutes,
    breakMinutes: breakdown.breakMinutes,
    timelineSegments: input.timelineSegments,
    activeJobId: currentState.activeJobId,
    activeJobInfo: input.activeJobInfo,
    captureModel: currentState.isClockedIn ? 'legacy' : 'none',
    sessionId: null,
    sessionVersion: null,
    currentSegmentId: null,
    currentActivity: getLegacyCurrentActivity(currentState),
    resumeActivity: input.resumeActivity,
    resumeJobInfo: input.resumeJobInfo,
    recoveryReason: null,
    legacyOpen: currentState.isClockedIn,
    standbyMinutes: 0,
    travelMinutes: 0,
    calloutMinutes: 0,
    internalMinutes: 0,
    fetchedAt: new Date().toISOString(),
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
      state: legacyLiveClockState({
        organizationId,
        organizationSettings,
        currentState,
        todayMinutes,
        breakdown,
        timelineSegments,
        activeJobInfo: activeJob.info,
        resumeActivity,
        resumeJobInfo: resumeJob.info,
      }),
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

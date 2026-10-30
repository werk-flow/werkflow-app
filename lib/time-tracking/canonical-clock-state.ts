import 'server-only';
import type { ActionResult } from '@/lib/action-result';
import { loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { getJobDisplayTitle } from '@/lib/jobs/types';
import type { AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import type { Tables } from '@/lib/supabase/database.types';
import { combineClockDayTotals, canonicalDayTotals, type ClockDayTotals } from './clock-day-totals';
import { readResumeActivity } from './resume-activity';
import {
  toTimeActivitySelection,
  toTimeSegmentFact,
  UNUSUALLY_LONG_SESSION_MS,
  type TimeSegmentFact,
} from './segments';
import { computeBreakdownForSettings, type OrganizationTimeTrackingSettings } from './settings';
import type { ClockJobInfo, LiveClockState, TimeActivitySelection } from './types';

// The caller's canonical clock day for getCurrentClockState: the segments of
// every session that overlaps today and, while one is open, its live state.
// The caller authorizes the organization and passes its own user id.

type OpenSession = Pick<
  Tables<'time_sessions'>,
  'id' | 'status' | 'started_at' | 'version' | 'recovery_reason'
>;

export type CanonicalClockDay = {
  openSession: OpenSession | null;
  /** Every segment of today's sessions that overlaps the Berlin day, in start order. */
  segments: TimeSegmentFact[];
};

type ClockSettings = Pick<
  OrganizationTimeTrackingSettings,
  'breakMode' | 'autoBreakThresholdMinutes' | 'autoBreakDurationMinutes'
>;

/**
 * Today's canonical capture of one person in one organization, in one read:
 * the sessions open now or overlapping the day, each with its segments of the
 * day. Null when the read fails, so a failed read is never a zero day.
 */
export async function readCanonicalClockDay(
  admin: AdminClient,
  input: { organizationId: string; userId: string; dayStart: Date; dayEnd: Date },
): Promise<CanonicalClockDay | null> {
  const dayStart = input.dayStart.toISOString();
  const dayEnd = input.dayEnd.toISOString();
  const { data, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('time_sessions')
        .select(
          'id, status, started_at, ended_at, version, recovery_reason, time_segments(id, session_id, organization_id, employee_record_id, kind, allocation_kind, job_id, internal_type, travel_route, travel_role, standby_context, started_at, ended_at)',
        )
        .eq('organization_id', input.organizationId)
        .eq('user_id', input.userId)
        .lte('started_at', dayEnd)
        .or(`ended_at.is.null,ended_at.gte.${dayStart}`)
        .lte('time_segments.started_at', dayEnd)
        .or(`ended_at.is.null,ended_at.gte.${dayStart}`, { referencedTable: 'time_segments' })
        .order('started_at', { ascending: true })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logReadErrors('readCanonicalClockDay: read failed', error);
    return null;
  }
  const segments = data
    .flatMap((session) => session.time_segments.map((row) => toTimeSegmentFact(row)))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
  return { openSession: data.find((session) => session.ended_at === null) ?? null, segments };
}

async function readClockJobInfo(
  admin: AdminClient,
  organizationId: string,
  jobId: string,
): Promise<ActionResult<{ info: ClockJobInfo | null }>> {
  const { data: job, error: jobError } = await loggedRead(
    'readClockJobInfo: jobs read failed',
    admin
      .from('jobs')
      .select('id, title, description, job_number, status, projects(name), clients(name)')
      .eq('organization_id', organizationId)
      .eq('id', jobId)
      .maybeSingle(),
  );
  if (jobError) return { success: false, error: 'fetch_failed' };
  if (!job) return { success: true, info: null };
  const project = Array.isArray(job.projects) ? job.projects[0] : job.projects;
  const client = Array.isArray(job.clients) ? job.clients[0] : job.clients;
  return {
    success: true,
    info: {
      id: job.id,
      title: getJobDisplayTitle({ title: job.title, description: job.description }),
      jobNumber: job.job_number,
      status: job.status === 'nicht_bearbeitet' ? 'in_bearbeitung' : job.status,
      projectName: project?.name ?? null,
      clientName: client?.name ?? null,
    },
  };
}

/** The job context of a running activity and of the one to resume, each read once. */
export async function readClockJobs(
  admin: AdminClient,
  organizationId: string,
  activeJobId: string | null,
  resumeJobId: string | null,
): Promise<ActionResult<{ activeJobInfo: ClockJobInfo | null; resumeJobInfo: ClockJobInfo | null }>> {
  const noJob = { success: true as const, info: null };
  const activeJob = activeJobId ? await readClockJobInfo(admin, organizationId, activeJobId) : noJob;
  if (!activeJob.success) return activeJob;
  const resumeJob = !resumeJobId
    ? noJob
    : resumeJobId === activeJobId
      ? activeJob
      : await readClockJobInfo(admin, organizationId, resumeJobId);
  if (!resumeJob.success) return resumeJob;
  return { success: true, activeJobInfo: activeJob.info, resumeJobInfo: resumeJob.info };
}

/**
 * The live state of the open canonical session. Today's totals count every
 * closed segment of the day, of this session and of the ones before it, plus
 * the legacy entries' minutes; the running segment counts from its start on
 * the client.
 */
export async function buildCanonicalClockState(
  admin: AdminClient,
  input: {
    organizationId: string;
    settings: ClockSettings;
    session: OpenSession;
    day: CanonicalClockDay;
    legacyTotals: ClockDayTotals;
    now: Date;
    dayStart: Date;
    dayEnd: Date;
  },
): Promise<ActionResult<{ state: LiveClockState }>> {
  const { organizationId, session } = input;
  const current =
    input.day.segments.findLast((segment) => segment.sessionId === session.id && segment.endedAt === null) ??
    null;
  // The activity a break interrupted is read across the whole session, so a
  // break that crosses the Berlin midnight still resumes the right job.
  let resumeActivity: TimeActivitySelection | null = current ? toTimeActivitySelection(current) : null;
  if (current?.kind === 'break') {
    const resume = await readResumeActivity(admin, organizationId, session.id);
    if (!resume.success) return { success: false, error: 'fetch_failed' };
    resumeActivity = resume.activity;
  }
  const jobs = await readClockJobs(
    admin,
    organizationId,
    current?.jobId ?? null,
    resumeActivity?.jobId ?? null,
  );
  if (!jobs.success) return jobs;
  const totals = combineClockDayTotals(
    input.legacyTotals,
    canonicalDayTotals(input.day.segments, input.dayStart, input.dayEnd),
  );
  return {
    success: true,
    state: {
      ...clockTotalsState(totals, input.settings),
      organizationId,
      status: current?.kind === 'break' ? 'on_break' : 'working',
      isClockedIn: true,
      isOnBreak: current?.kind === 'break',
      clockInTime: session.started_at,
      statusStartedAt: current?.startedAt ?? session.started_at,
      breakStartTime: current?.kind === 'break' ? current.startedAt : null,
      activeJobId: current?.jobId ?? null,
      activeJobInfo: jobs.activeJobInfo,
      captureModel: 'canonical',
      sessionId: session.id,
      sessionVersion: session.version,
      currentSegmentId: current?.id ?? null,
      currentActivity: current ? toTimeActivitySelection(current) : null,
      resumeActivity,
      resumeJobInfo: jobs.resumeJobInfo,
      recoveryReason: sessionRecoveryReason(session, input.now),
      legacyOpen: false,
      fetchedAt: input.now.toISOString(),
    },
  };
}

function sessionRecoveryReason(session: OpenSession, now: Date): string | null {
  if (session.status === 'recovery_required') return session.recovery_reason;
  return now.getTime() - new Date(session.started_at).getTime() > UNUSUALLY_LONG_SESSION_MS
    ? 'unusually_long'
    : null;
}

/** The settings and today's totals of a clock state, after the organization's break mode. */
export function clockTotalsState(
  totals: ClockDayTotals,
  settings: ClockSettings,
): Pick<
  LiveClockState,
  | 'breakMode'
  | 'autoBreakThresholdMinutes'
  | 'autoBreakDurationMinutes'
  | 'todayMinutes'
  | 'workMinutes'
  | 'breakMinutes'
  | 'timelineSegments'
  | 'travelMinutes'
  | 'standbyMinutes'
  | 'calloutMinutes'
  | 'internalMinutes'
> {
  const breakdown = computeBreakdownForSettings(totals.presenceMinutes, totals.breakMinutes, settings);
  return {
    breakMode: settings.breakMode,
    autoBreakThresholdMinutes: settings.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: settings.autoBreakDurationMinutes,
    todayMinutes: totals.presenceMinutes,
    workMinutes: breakdown.workMinutes,
    breakMinutes: breakdown.breakMinutes,
    timelineSegments: totals.timelineSegments,
    travelMinutes: totals.travelMinutes,
    standbyMinutes: totals.standbyMinutes,
    calloutMinutes: totals.calloutMinutes,
    internalMinutes: totals.internalMinutes,
  };
}

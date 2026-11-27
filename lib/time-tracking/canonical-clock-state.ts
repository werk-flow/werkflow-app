import 'server-only';
import type { ActionResult } from '@/lib/action-result';
import { loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { getJobDisplayTitle } from '@/lib/jobs/types';
import type { AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import type { Tables } from '@/lib/supabase/database.types';
import { projectedTransitionEntries } from './canonical-entries';
import { clockDayTotals } from './clock-day-totals';
import { readResumeActivity } from './resume-activity';
import {
  toTimeActivitySelection,
  toTimeSegmentFact,
  UNUSUALLY_LONG_SESSION_MS,
  type TimeSegmentFact,
} from './segments';
import { computeDayBreakdown, type BreakPolicy } from './settings';
import type { ClockJobInfo, LiveClockState, TimeActivitySelection, TimeEntry } from './types';
import { dayBreakPolicy } from './weekly';

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
  /** The segments' transitions inside the day, as the week reads them (`getCanonicalTimeEntries`). */
  entries: TimeEntry[];
};

/**
 * Today's canonical capture of one person in one organization, in one read:
 * the sessions open now or overlapping the day, each with its segments of the
 * day. Null when the read fails, so a failed read is never a zero day.
 */
export async function readCanonicalClockDay(
  admin: AdminClient,
  input: { organizationId: string; userId: string; dayStart: Date; dayEnd: Date; now: Date },
): Promise<CanonicalClockDay | null> {
  const dayStart = input.dayStart.toISOString();
  const dayEnd = input.dayEnd.toISOString();
  const { data, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('time_sessions')
        .select(
          'id, status, started_at, ended_at, version, recovery_reason, time_segments(id, session_id, organization_id, employee_record_id, kind, allocation_kind, job_id, internal_type, travel_route, travel_role, standby_context, started_at, ended_at, created_at, updated_at)',
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
  const rows = data
    .flatMap((session) => session.time_segments.map((row) => ({ row, segment: toTimeSegmentFact(row) })))
    .sort(
      (left, right) =>
        left.segment.startedAt.localeCompare(right.segment.startedAt) ||
        left.segment.id.localeCompare(right.segment.id),
    );
  // Every segment read here is the caller's own.
  const userByEmployee = new Map(rows.map(({ segment }) => [segment.employeeRecordId, input.userId]));
  return {
    openSession: data.find((session) => session.ended_at === null) ?? null,
    segments: rows.map(({ segment }) => segment),
    entries: projectedTransitionEntries(rows, userByEmployee, {
      from: input.dayStart,
      to: input.dayEnd,
      now: input.now,
    }),
  };
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
      .select('id, title, description, job_number, status, project_id, client_id')
      .eq('organization_id', organizationId)
      .eq('id', jobId)
      .maybeSingle(),
  );
  if (jobError) return { success: false, error: 'fetch_failed' };
  if (!job) return { success: true, info: null };
  // Best effort: the job row fails closed, a failed project or customer name only drops its label.
  const [projectData, clientData] = await Promise.all([
    job.project_id
      ? admin
          .from('projects')
          .select('name')
          .eq('id', job.project_id)
          .eq('organization_id', organizationId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    job.client_id
      ? admin
          .from('clients')
          .select('name')
          .eq('id', job.client_id)
          .eq('organization_id', organizationId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  logReadErrors('readClockJobInfo: project label read failed', projectData.error);
  logReadErrors('readClockJobInfo: customer label read failed', clientData.error);
  return {
    success: true,
    info: {
      id: job.id,
      title: getJobDisplayTitle({ title: job.title, description: job.description }),
      jobNumber: job.job_number,
      status: job.status === 'nicht_bearbeitet' ? 'in_bearbeitung' : job.status,
      projectName: projectData.data?.name ?? null,
      clientName: clientData.data?.name ?? null,
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
 * The live state of the open canonical session, with today's totals
 * (`clockTotalsState`); the running segment counts from its start on the client.
 */
export async function buildCanonicalClockState(
  admin: AdminClient,
  input: {
    organizationId: string;
    totals: ClockTotalsState;
    session: OpenSession;
    day: CanonicalClockDay;
    now: Date;
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
  return {
    success: true,
    state: {
      ...input.totals,
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

/**
 * Whether an open session needs the recovery the office reviews: the database
 * flagged it, or it has been open longer than the threshold. The clock and the
 * sign-out both end such a session with `recover_end`, never as a normal end.
 */
export function sessionNeedsRecovery(
  session: Pick<OpenSession, 'status' | 'started_at'>,
  now: Date,
): boolean {
  return (
    session.status === 'recovery_required' ||
    now.getTime() - new Date(session.started_at).getTime() > UNUSUALLY_LONG_SESSION_MS
  );
}

function sessionRecoveryReason(session: OpenSession, now: Date): string | null {
  if (session.status === 'recovery_required') return session.recovery_reason;
  return sessionNeedsRecovery(session, now) ? 'unusually_long' : null;
}

export type ClockTotalsState = Pick<
  LiveClockState,
  | 'breakPolicy'
  | 'todayMinutes'
  | 'workMinutes'
  | 'breakMinutes'
  | 'timelineSegments'
  | 'travelMinutes'
  | 'standbyMinutes'
  | 'calloutMinutes'
  | 'internalMinutes'
>;

/**
 * Today's totals of a clock state and the rule they count by, from the day's
 * entries with the approved corrections applied, as the week reads the day:
 * the rule at the day's last entry once clocked out, the current one while
 * the clock runs (`dayBreakPolicy`).
 */
export function clockTotalsState(
  dayEntries: TimeEntry[],
  settings: BreakPolicy,
  running: boolean,
  now: Date,
): ClockTotalsState {
  const totals = clockDayTotals(dayEntries, now);
  const breakPolicy = dayBreakPolicy(settings, dayEntries, running);
  // The state carries no target: its work minutes owe no overtime.
  const breakdown = computeDayBreakdown(
    {
      presenceMinutes: totals.presenceMinutes,
      standbyMinutes: totals.standbyMinutes,
      trackedBreakMinutes: totals.breakMinutes,
    },
    breakPolicy,
    undefined,
  );
  return {
    breakPolicy,
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

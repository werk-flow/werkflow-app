'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { revalidatePath } from 'next/cache';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { timeActivitySelectionSchema as selectionSchema } from './activity-selection-schema';

import { resolveActionContextFor } from '@/lib/org/action-context';
import { readOrganizationSettings } from './organization-settings-read';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { getJobDisplayTitle } from '@/lib/jobs/types';
import { hasActiveSicknessOn } from '@/lib/sickness/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { hasApprovedFullDayVacationOn } from '@/lib/vacation/server';
import { getLocalDayEnd, getLocalDayStart } from './day-utils';
import { isPeriodClosedError } from './closed-periods';
import { calculateTimeActivityTotals, toTimeActivitySelection, toTimeSegmentFact } from './segments';
import { readResumeActivity } from './resume-activity';
import { computeBreakdownForSettings } from './settings';
import { hashTimeTransitionRequest } from './transition-hash';
import { TIME_TRANSITION_ERROR_CODES } from './types';
import type {
  ClockJobInfo,
  LiveClockState,
  TimeActivitySelection,
  TimeTransitionError,
  TimeTransitionResult,
} from './types';

const transitionSchema = z.object({
  organizationId: uuidSchema,
  operationId: uuidSchema,
  action: z.enum([
    'start',
    'switch',
    'end',
    'continue_legacy',
    'end_legacy',
    'recover_continue',
    'recover_end',
  ]),
  expectedSessionId: uuidSchema.nullable(),
  expectedVersion: z.number().int().positive().nullable(),
  selection: selectionSchema.nullable(),
  acknowledgeLong: z.boolean(),
});

export type TimeTransitionInput = z.infer<typeof transitionSchema>;

type CanonicalSessionRow = {
  id: string;
  employee_record_id: string;
  status: 'open' | 'closed' | 'recovery_required';
  started_at: string;
  version: number;
  recovery_reason: string | null;
};

type TransitionPayload = {
  outcome: 'active' | 'ended' | 'no_change' | 'recovery_required';
  sessionId?: string | null;
  segmentId?: string | null;
  version?: number | null;
  recoveryReason?: string | null;
  replayed?: boolean;
  legacyBridged?: boolean;
};

function mapTransitionError(error: { code?: string; message: string }): TimeTransitionError {
  if (isPeriodClosedError(error)) return 'period_closed';
  const { message } = error;
  if (message.includes('time_sessions_open_user_unique')) {
    return 'time_transition_working_other_org';
  }
  return (
    TIME_TRANSITION_ERROR_CODES.find(
      (code) => code.startsWith('time_transition_') && message.includes(code),
    ) ?? 'time_transition_failed'
  );
}

export async function transitionTimeActivity(rawInput: TimeTransitionInput): Promise<TimeTransitionResult> {
  const parsed = transitionSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const caller = await resolveActionContextFor(input.organizationId);
  if (!caller.success) return caller;
  const userId = caller.context.userId;

  const admin = createSupabaseAdminClient();
  const { data: employee, error: employeeError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (employeeError || !employee) return { success: false, error: 'not_a_member' };

  let sicknessNotice = false;
  if (input.action === 'start' || input.action === 'continue_legacy') {
    const today = getBusinessTodayIso();
    if (await hasApprovedFullDayVacationOn(input.organizationId, userId, today)) {
      return { success: false, error: 'on_approved_vacation' };
    }
    sicknessNotice = await hasActiveSicknessOn(input.organizationId, userId, today);
  }

  const selection = input.selection;
  const { data, error } = await admin.rpc(
    'transition_time_activity',
    rpcArgs('transition_time_activity', {
      p_organization_id: input.organizationId,
      p_actor_id: userId,
      p_operation_id: input.operationId,
      p_request_hash: hashTimeTransitionRequest(input),
      p_action: input.action,
      p_expected_session_id: input.expectedSessionId,
      p_expected_version: input.expectedVersion,
      p_segment_kind: selection?.kind ?? null,
      p_allocation_kind: selection?.allocationKind ?? null,
      p_job_id: selection?.jobId ?? null,
      p_internal_type: selection?.internalType ?? null,
      p_travel_route: selection?.travelRoute ?? null,
      p_travel_role: selection?.travelRole ?? null,
      p_standby_context: selection?.standbyContext ?? null,
      p_acknowledge_long: input.acknowledgeLong,
    }),
  );

  if (error) return { success: false, error: mapTransitionError(error) };
  if (!data || typeof data !== 'object') {
    return { success: false, error: 'time_transition_failed' };
  }
  const payload = data as TransitionPayload;
  revalidatePath('/zeiterfassung');
  revalidatePath('/auftraege');

  return {
    success: true,
    outcome: payload.outcome,
    sessionId: payload.sessionId ?? null,
    segmentId: payload.segmentId ?? null,
    version: payload.version ?? null,
    recoveryReason: payload.recoveryReason ?? null,
    replayed: payload.replayed ?? false,
    legacyBridged: payload.legacyBridged ?? false,
    ...(sicknessNotice ? { notice: 'sickness_reported_today' as const } : {}),
  };
}

async function readClockJobInfo(
  admin: ReturnType<typeof createSupabaseAdminClient>,
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

export async function getCanonicalClockState(
  organizationId: string,
): Promise<{ success: true; state: LiveClockState | null } | ActionFailure> {
  if (!uuidSchema.safeParse(organizationId).success) {
    return { success: false, error: 'invalid_input' };
  }
  const caller = await resolveActionContextFor(organizationId);
  if (!caller.success) return caller;
  const userId = caller.context.userId;
  const admin = createSupabaseAdminClient();
  const [{ data: sessionData, error: sessionError }, settings] = await Promise.all([
    admin
      .from('time_sessions')
      .select('id, employee_record_id, status, started_at, version, recovery_reason')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .is('ended_at', null)
      .maybeSingle(),
    readOrganizationSettings(organizationId),
  ]);
  if (sessionError) {
    logReadErrors('getCanonicalClockState: read failed', sessionError);
    return { success: false, error: 'fetch_failed' };
  }
  if (!settings) return { success: false, error: 'fetch_failed' };
  if (!sessionData) return { success: true, state: null };
  const session = sessionData as CanonicalSessionRow;
  const now = new Date();
  const dayStart = getLocalDayStart(now);
  const dayEnd = getLocalDayEnd(now);
  const { data: segmentData, error: segmentError } = await admin
    .from('time_segments')
    .select(
      'id, session_id, organization_id, employee_record_id, kind, allocation_kind, job_id, internal_type, travel_route, travel_role, standby_context, started_at, ended_at',
    )
    .eq('organization_id', organizationId)
    .eq('session_id', session.id)
    .lte('started_at', dayEnd.toISOString())
    .or(`ended_at.is.null,ended_at.gte.${dayStart.toISOString()}`)
    .order('started_at', { ascending: true });
  if (segmentError) {
    logReadErrors('getCanonicalClockState: read failed', segmentError);
    return { success: false, error: 'fetch_failed' };
  }
  const segments = (segmentData ?? []).map((row) => toTimeSegmentFact(row as never));
  const current = [...segments].reverse().find((segment) => segment.endedAt === null) ?? null;
  // Closed-block totals intentionally exclude the still-running segment.
  const totals = calculateTimeActivityTotals(
    segments,
    dayStart,
    dayEnd,
    current ? new Date(current.startedAt) : now,
  );
  const breakdown = computeBreakdownForSettings(totals.presenceMinutes, totals.breakMinutes, settings);
  // The activity a break interrupted is read across the whole session, so a
  // break that crosses the Berlin midnight still resumes the right job.
  let resumeActivity: TimeActivitySelection | null = current ? toTimeActivitySelection(current) : null;
  if (current?.kind === 'break') {
    const resume = await readResumeActivity(admin, organizationId, session.id);
    if (!resume.success) return { success: false, error: 'fetch_failed' };
    resumeActivity = resume.activity;
  }
  const noJob = { success: true as const, info: null };
  const activeJob = current?.jobId ? await readClockJobInfo(admin, organizationId, current.jobId) : noJob;
  if (!activeJob.success) return activeJob;
  const resumeJob = !resumeActivity?.jobId
    ? noJob
    : resumeActivity.jobId === current?.jobId
      ? activeJob
      : await readClockJobInfo(admin, organizationId, resumeActivity.jobId);
  if (!resumeJob.success) return resumeJob;
  const activeJobInfo = activeJob.info;
  const resumeJobInfo = resumeJob.info;
  const derivedRecovery =
    session.status === 'recovery_required'
      ? session.recovery_reason
      : now.getTime() - new Date(session.started_at).getTime() > 24 * 60 * 60 * 1000
        ? 'unusually_long'
        : null;

  return {
    success: true,
    state: {
      organizationId,
      breakMode: settings.breakMode,
      autoBreakThresholdMinutes: settings.autoBreakThresholdMinutes,
      autoBreakDurationMinutes: settings.autoBreakDurationMinutes,
      status: current?.kind === 'break' ? 'on_break' : 'working',
      isClockedIn: true,
      isOnBreak: current?.kind === 'break',
      clockInTime: session.started_at,
      statusStartedAt: current?.startedAt ?? session.started_at,
      breakStartTime: current?.kind === 'break' ? current.startedAt : null,
      todayMinutes: totals.presenceMinutes,
      workMinutes: breakdown.workMinutes,
      breakMinutes: breakdown.breakMinutes,
      timelineSegments: segments.flatMap((segment) =>
        segment.endedAt === null
          ? []
          : [
              {
                type: segment.kind === 'break' ? ('break' as const) : ('work' as const),
                minutes: Math.max(
                  0,
                  (new Date(segment.endedAt).getTime() - new Date(segment.startedAt).getTime()) / 60_000,
                ),
              },
            ],
      ),
      activeJobId: current?.jobId ?? null,
      activeJobInfo,
      captureModel: 'canonical',
      sessionId: session.id,
      sessionVersion: session.version,
      currentSegmentId: current?.id ?? null,
      currentActivity: current ? toTimeActivitySelection(current) : null,
      resumeActivity,
      resumeJobInfo,
      recoveryReason: derivedRecovery,
      legacyOpen: false,
      standbyMinutes: totals.standbyMinutes,
      travelMinutes: totals.travelMinutes,
      calloutMinutes: totals.calloutMinutes,
      internalMinutes: totals.internalMinutes,
      fetchedAt: now.toISOString(),
    },
  };
}

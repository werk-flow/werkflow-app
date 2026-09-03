'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';

import { getAuthenticatedUser, getCachedOrganizationSettings } from '@/lib/data/cached';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { getJobDisplayTitle } from '@/lib/jobs/types';
import { hasActiveSicknessOn } from '@/lib/sickness/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { hasApprovedFullDayVacationOn } from '@/lib/vacation/server';
import { getLocalDayEnd, getLocalDayStart } from './day-utils';
import {
  calculateTimeActivityTotals,
  toTimeActivitySelection,
  toTimeSegmentFact,
} from './segments';
import { computeBreakdownForSettings } from './settings';
import { hashTimeTransitionRequest } from './transition-hash';
import { TIME_TRANSITION_ERROR_CODES } from './types';
import type {
  LiveClockState,
  TimeActivitySelection,
  TimeTransitionError,
  TimeTransitionResult,
} from './types';

const travelRouteSchema = z.enum([
  'company_to_site',
  'home_to_site',
  'site_to_site',
  'site_to_company',
  'other',
  'unspecified',
]);
const travelRoleSchema = z.enum(['driver', 'passenger', 'unspecified']);
const selectionSchema: z.ZodType<TimeActivitySelection> = z.union([
  z.strictObject({ kind: z.literal('work'), allocationKind: z.literal('job'), jobId: uuidSchema }),
  z.strictObject({ kind: z.literal('work'), allocationKind: z.literal('unallocated'), jobId: z.null() }),
  z.strictObject({ kind: z.literal('callout'), allocationKind: z.literal('job'), jobId: uuidSchema }),
  z.strictObject({ kind: z.literal('callout'), allocationKind: z.literal('unallocated'), jobId: z.null() }),
  z.strictObject({
    kind: z.literal('travel'),
    allocationKind: z.literal('job'),
    jobId: uuidSchema,
    travelRoute: travelRouteSchema,
    travelRole: travelRoleSchema,
  }),
  z.strictObject({
    kind: z.literal('travel'),
    allocationKind: z.literal('unallocated'),
    jobId: z.null(),
    travelRoute: travelRouteSchema,
    travelRole: travelRoleSchema,
  }),
  z.strictObject({ kind: z.literal('break'), allocationKind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('standby'),
    allocationKind: z.literal('none'),
    standbyContext: z.enum(['on_site', 'remote', 'unspecified']),
  }),
  z.strictObject({
    kind: z.literal('internal_activity'),
    allocationKind: z.literal('internal_activity'),
    internalType: z.enum(['internal_work', 'meeting', 'training', 'other']),
  }),
]);

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

function mapTransitionError(message: string): TimeTransitionError {
  if (message.includes('time_sessions_open_user_unique')) {
    return 'time_transition_working_other_org';
  }
  return TIME_TRANSITION_ERROR_CODES.find(
    (code) => code.startsWith('time_transition_') && message.includes(code)
  ) ?? 'time_transition_failed';
}

export async function transitionTimeActivity(
  rawInput: TimeTransitionInput
): Promise<TimeTransitionResult> {
  const parsed = transitionSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };

  const admin = createSupabaseAdminClient();
  const { data: employee, error: employeeError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (employeeError || !employee) return { success: false, error: 'not_a_member' };

  let sicknessNotice = false;
  if (input.action === 'start' || input.action === 'continue_legacy') {
    const today = getBusinessTodayIso();
    if (await hasApprovedFullDayVacationOn(input.organizationId, user.id, today)) {
      return { success: false, error: 'on_approved_vacation' };
    }
    sicknessNotice = await hasActiveSicknessOn(input.organizationId, user.id, today);
  }

  const selection = input.selection;
  const { data, error } = await admin.rpc('transition_time_activity', {
    p_organization_id: input.organizationId,
    p_actor_id: user.id,
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
  });

  if (error) return { success: false, error: mapTransitionError(error.message) };
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

export async function getCanonicalClockState(
  organizationId: string
): Promise<{ success: true; state: LiveClockState | null } | { success: false; error: string }> {
  if (!uuidSchema.safeParse(organizationId).success) {
    return { success: false, error: 'invalid_input' };
  }
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const admin = createSupabaseAdminClient();
  const [{ data: sessionData, error: sessionError }, settings] = await Promise.all([
    admin
      .from('time_sessions')
      .select('id, employee_record_id, status, started_at, version, recovery_reason')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .is('ended_at', null)
      .maybeSingle(),
    getCachedOrganizationSettings(organizationId),
  ]);
  if (sessionError) return { success: false, error: 'fetch_failed' };
  if (!sessionData) return { success: true, state: null };
  const session = sessionData as CanonicalSessionRow;
  const now = new Date();
  const dayStart = getLocalDayStart(now);
  const dayEnd = getLocalDayEnd(now);
  const { data: segmentData, error: segmentError } = await admin
    .from('time_segments')
    .select(
      'id, session_id, organization_id, employee_record_id, kind, allocation_kind, job_id, internal_type, travel_route, travel_role, standby_context, started_at, ended_at'
    )
    .eq('session_id', session.id)
    .lte('started_at', dayEnd.toISOString())
    .or(`ended_at.is.null,ended_at.gte.${dayStart.toISOString()}`)
    .order('started_at', { ascending: true });
  if (segmentError) return { success: false, error: 'fetch_failed' };
  const segments = (segmentData ?? []).map((row) => toTimeSegmentFact(row as never));
  const current = [...segments].reverse().find((segment) => segment.endedAt === null) ?? null;
  // Closed-block totals intentionally exclude the still-running segment.
  const totals = calculateTimeActivityTotals(
    segments,
    dayStart,
    dayEnd,
    current ? new Date(current.startedAt) : now
  );
  const breakdown = computeBreakdownForSettings(
    totals.presenceMinutes,
    totals.breakMinutes,
    settings
  );
  let activeJobInfo = null;
  if (current?.jobId) {
    const { data: job } = await admin
      .from('jobs')
      .select('id, title, description, job_number, status, projects(name), clients(name)')
      .eq('organization_id', organizationId)
      .eq('id', current.jobId)
      .maybeSingle();
    if (job) {
      const project = Array.isArray(job.projects) ? job.projects[0] : job.projects;
      const client = Array.isArray(job.clients) ? job.clients[0] : job.clients;
      activeJobInfo = {
        id: job.id,
        title: getJobDisplayTitle({
          title: job.title,
          description: job.description,
        }),
        jobNumber: job.job_number,
        status: job.status === 'nicht_bearbeitet' ? 'in_bearbeitung' : job.status,
        projectName: project?.name ?? null,
        clientName: client?.name ?? null,
      };
    }
  }
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
      timelineSegments: segments.filter((segment) => segment.endedAt !== null).map((segment) => ({
        type: segment.kind === 'break' ? 'break' as const : 'work' as const,
        minutes: Math.max(
          0,
          (new Date(segment.endedAt!).getTime() -
            new Date(segment.startedAt).getTime()) /
            60_000
        ),
      })),
      activeJobId: current?.jobId ?? null,
      activeJobInfo,
      captureModel: 'canonical',
      sessionId: session.id,
      sessionVersion: session.version,
      currentSegmentId: current?.id ?? null,
      currentActivity: current ? toTimeActivitySelection(current) : null,
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

'use server';

import type { ActionFailure } from '@/lib/action-result';
import { createHash } from 'node:crypto';
import { canonicalize } from '@/lib/format/canonical-json';
import { revalidatePath } from 'next/cache';

import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import { logReadFailure, loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { canHolderApproveTarget } from '@/lib/responsibilities/resolution';
import {
  authorizeResponsibilityForTarget,
  getEffectiveResponsibilityHolderForActor,
  loadResponsibilityRuntimeState,
} from '@/lib/responsibilities/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isJsonRecord } from '@/lib/supabase/json';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { proposeCalendarCorrection } from './calendar-proposal';
import { mergeCorrectionProposal } from './merge-proposal';
import {
  checkCorrectionTimeline,
  checkCorrectionReviewTimeline,
  correctionOperationExists,
  readCorrectionTimelineRevision,
} from './timeline-server';
import { toTimeSegmentFact, type TimeSegmentFact } from '@/lib/time-tracking/segments';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { createSegmentCorrectionSnapshot } from './segment-snapshot';
import type { Json, Tables } from '@/lib/supabase/database.types';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { correctionHistoryVisibility } from './history-visibility';
import type { OrgRole, TimeEntryType } from '@/lib/time-tracking/types';

import {
  isTimeCorrectionSnapshot,
  type TimeCorrectionFact,
  type TimeCorrectionHistoryResult,
  type TimeCorrectionListResult,
  type TimeCorrectionRequest,
  type TimeCorrectionResult,
  type TimeCorrectionSnapshot,
  type TimeCorrectionSource,
} from './types';
import {
  createPendingProjectionPort,
  loadPendingCorrectionProjection,
  PENDING_CORRECTION_STATUSES,
} from './pending-projection';
import {
  reviewTimeCorrectionSchema,
  submitTimeCorrectionSchema,
  validateCorrectionShape,
  type ReviewTimeCorrectionInput,
  type SubmitTimeCorrectionInput,
} from './validation';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

const correctionDateSchema = z.string().max(40);
const withdrawCorrectionSchema = z.object({ requestId: uuidSchema, operationId: uuidSchema });
const resubmitCorrectionSchema = z.object({
  requestId: uuidSchema,
  expectedRevision: z.number().int().min(0),
  reason: z.string().max(4000),
  operationId: uuidSchema,
});
const reviewCorrectionsBatchSchema = z.object({
  requests: z.array(z.object({ requestId: uuidSchema, expectedRevision: z.number().int().min(0) })).max(100),
  decision: z.enum(['approve', 'reject']),
  comment: z.string().max(4000).nullable(),
});
const correctionProjectionSchema = z.object({
  organizationId: uuidSchema,
  from: correctionDateSchema,
  to: correctionDateSchema,
  userId: uuidSchema.optional(),
});
const correctionSummarySchema = z.object({ organizationId: uuidSchema, userId: uuidSchema });
const correctionListSchema = z.object({
  organizationId: uuidSchema,
  scope: z.literal('approvals'),
});
const correctionHistorySchema = z.object({
  organizationId: uuidSchema,
  page: z.number().int().min(1).max(1_000_000),
});
const historySelectionSchema = z.object({
  total: z.number().int().nonnegative(),
  ids: z.array(uuidSchema).max(LIST_PAGE_SIZE),
});

type EmployeeIdentity = {
  id: string;
  userId: string;
  role: OrgRole;
};

type SourceContext = {
  source: TimeCorrectionSource | null;
  snapshot: TimeCorrectionSnapshot;
  segment?: TimeSegmentFact;
};

/** Why a source has no context: it is gone or foreign, or a read of it failed. */
type SourceRefusal = 'source_not_found' | 'correction_timeline_unavailable';

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function normalizeTimestampSourceVersion(value: string): string {
  return value
    .replace('T', ' ')
    .replace(/Z$/, '+00')
    .replace(/\+00:00$/, '+00');
}

async function getMembershipRole(userId: string, organizationId: string): Promise<OrgRole | null> {
  const memberships = await getCachedMemberships(userId);
  return (
    (memberships.find((membership) => membership.orgId === organizationId)?.role as OrgRole | undefined) ??
    null
  );
}

async function loadEmployeeIdentities(
  organizationId: string,
  employeeRecordIds: readonly string[],
): Promise<Map<string, EmployeeIdentity> | null> {
  const uniqueIds = [...new Set(employeeRecordIds)];
  if (uniqueIds.length === 0) return new Map();
  const admin = createSupabaseAdminClient();
  const { data: employees, error: employeeError } = await readInBatches(uniqueIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id')
      .eq('organization_id', organizationId)
      .in('id', [...batch])
      .not('user_id', 'is', null),
  );
  if (employeeError) logReadFailure('loadEmployeeIdentities: employee records failed', employeeError);
  if (employeeError || employees.length !== uniqueIds.length) return null;
  const userIds = employees.map((employee) => employee.user_id as string);
  const { data: memberships, error: membershipError } = await readInBatches(userIds, (batch) =>
    admin
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', organizationId)
      .in('user_id', [...batch]),
  );
  if (membershipError) logReadFailure('loadEmployeeIdentities: memberships failed', membershipError);
  if (membershipError || memberships.length !== uniqueIds.length) return null;
  const roleByUser = new Map(
    memberships.map((membership) => [membership.user_id, membership.role as OrgRole]),
  );
  return new Map(
    employees.map((employee) => [
      employee.id,
      {
        id: employee.id,
        userId: employee.user_id as string,
        role: roleByUser.get(employee.user_id as string) as OrgRole,
      },
    ]),
  );
}

async function loadSourceContext(input: {
  organizationId: string;
  subject: EmployeeIdentity;
  source: SubmitTimeCorrectionInput['source'];
}): Promise<SourceContext | SourceRefusal> {
  if (!input.source) return { source: null, snapshot: { schemaVersion: 1, facts: [] } };
  const admin = createSupabaseAdminClient();

  if (input.source.kind === 'legacy_entry') {
    const { data: entry, error } = await admin
      .from('time_entries')
      .select('id, user_id, entry_type, timestamp, job_id, is_manual, updated_at')
      .eq('id', input.source.id)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (error) {
      logReadFailure('loadSourceContext: legacy entry failed', error);
      return 'correction_timeline_unavailable';
    }
    if (!entry || entry.user_id !== input.subject.userId) return 'source_not_found';
    return {
      source: {
        kind: 'legacy_entry',
        id: entry.id,
        version: normalizeTimestampSourceVersion(entry.updated_at),
      },
      snapshot: {
        schemaVersion: 1,
        facts: [
          {
            factId: entry.id,
            employeeRecordId: input.subject.id,
            userId: input.subject.userId,
            entryType: entry.entry_type as TimeEntryType,
            timestamp: entry.timestamp,
            jobId: entry.job_id,
            activityKind: null,
            isManual: entry.is_manual,
          },
        ],
      },
    };
  }

  if (input.source.kind === 'canonical_segment') {
    const { data: segment, error } = await admin
      .from('time_segments')
      .select('*')
      .eq('id', input.source.id)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (error) {
      logReadFailure('loadSourceContext: segment failed', error);
      return 'correction_timeline_unavailable';
    }
    if (!segment || segment.employee_record_id !== input.subject.id) return 'source_not_found';
    const session = await readCompleteRows(
      (from, to) =>
        admin
          .from('time_segments')
          .select('*')
          .eq('organization_id', input.organizationId)
          .eq('employee_record_id', input.subject.id)
          .eq('session_id', segment.session_id)
          .order('started_at')
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    );
    if (session.error) {
      logReadFailure('loadSourceContext: session segments failed', session.error);
      return 'correction_timeline_unavailable';
    }
    if (!session.data.length) return 'source_not_found';
    const segmentFact = toTimeSegmentFact(segment);
    return {
      source: {
        kind: 'canonical_segment',
        id: segment.id,
        version: normalizeTimestampSourceVersion(segment.updated_at),
      },
      snapshot: createSegmentCorrectionSnapshot(
        segmentFact,
        session.data.map(toTimeSegmentFact),
        input.subject.userId,
      ),
      segment: segmentFact,
    };
  }

  if (input.source.kind === 'correction_application') {
    const { data: application, error } = await admin
      .from('time_correction_applications')
      .select('id, source_fingerprint, applied_snapshot, request_id')
      .eq('id', input.source.id)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (error) {
      logReadFailure('loadSourceContext: correction application failed', error);
      return 'correction_timeline_unavailable';
    }
    if (!application || !isTimeCorrectionSnapshot(application.applied_snapshot)) {
      return 'source_not_found';
    }
    const { data: request, error: requestError } = await admin
      .from('time_correction_requests')
      .select('subject_employee_record_id')
      .eq('id', application.request_id)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (requestError) {
      logReadFailure('loadSourceContext: correction request failed', requestError);
      return 'correction_timeline_unavailable';
    }
    const effectiveOwners = new Set(application.applied_snapshot.facts.map((fact) => fact.employeeRecordId));
    const effectiveOwner =
      effectiveOwners.size === 1
        ? effectiveOwners.values().next().value
        : request?.subject_employee_record_id;
    if (effectiveOwner !== input.subject.id) return 'source_not_found';
    return {
      source: {
        kind: 'correction_application',
        id: application.id,
        version: application.source_fingerprint,
      },
      snapshot: application.applied_snapshot,
    };
  }

  return 'source_not_found';
}

async function buildProposedSnapshot(input: {
  organizationId: string;
  proposedFacts: Array<
    SubmitTimeCorrectionInput['proposedFacts'][number] & Pick<TimeCorrectionFact, 'activity'>
  >;
}): Promise<TimeCorrectionSnapshot | null> {
  const identities = await loadEmployeeIdentities(
    input.organizationId,
    input.proposedFacts.map((fact) => fact.employeeRecordId),
  );
  if (!identities) return null;
  const jobIds = [...new Set(input.proposedFacts.flatMap((fact) => (fact.jobId ? [fact.jobId] : [])))];
  const { data: jobs, error: jobError } = await readInBatches(jobIds, (batch) =>
    createSupabaseAdminClient()
      .from('jobs')
      .select('id')
      .eq('organization_id', input.organizationId)
      .in('id', [...batch]),
  );
  if (jobError) logReadFailure('buildProposedSnapshot: jobs failed', jobError);
  if (jobError || jobs.length !== jobIds.length) return null;
  const facts = input.proposedFacts.map((fact): TimeCorrectionFact => {
    const identity = identities.get(fact.employeeRecordId);
    if (!identity) throw new Error('time_correction_employee_missing');
    return {
      factId: fact.factId,
      employeeRecordId: identity.id,
      userId: identity.userId,
      entryType: fact.entryType,
      timestamp: new Date(fact.timestamp).toISOString(),
      jobId: fact.jobId ?? null,
      activityKind: fact.activityKind ?? null,
      ...(fact.activity ? { activity: fact.activity } : {}),
      isManual: true,
    };
  });
  return { schemaVersion: 1, facts };
}

function toCorrectionResult(data: Json | null): TimeCorrectionResult {
  if (!isJsonRecord(data)) return { success: false, error: 'request_failed' };
  const { requestId, applicationId, status, replayed } = data;
  if (typeof requestId !== 'string' || typeof status !== 'string') {
    return { success: false, error: 'request_failed' };
  }
  return {
    success: true,
    requestId,
    ...(typeof applicationId === 'string' || applicationId === null ? { applicationId } : {}),
    status: status as TimeCorrectionRequest['status'],
    replayed: replayed === true,
  };
}

function hasValidChronology(snapshot: TimeCorrectionSnapshot): boolean {
  return snapshot.facts.every((fact, index) => {
    const timestamp = Date.parse(fact.timestamp);
    if (!Number.isFinite(timestamp)) return false;
    const previous = snapshot.facts[index - 1];
    return !previous || timestamp >= Date.parse(previous.timestamp);
  });
}

function mapRpcError(message: string): string {
  if (/deadlock detected|could not serialize access/.test(message)) return 'time_correction_timeline_changed';
  const known = [
    'time_correction_not_responsible',
    'time_correction_self_approval_forbidden',
    'time_correction_stale_source',
    'time_correction_timeline_changed',
    'time_correction_stale_revision',
    'time_correction_comment_required',
    'time_correction_not_submitted',
    'time_correction_not_withdrawable',
    'time_correction_not_requester',
    'time_correction_multiple_application_sources',
    'period_closed',
  ].find((code) => message.includes(code));
  return known ?? 'request_failed';
}

function revalidateCorrectionSurfaces(): void {
  revalidatePath('/zeiterfassung');
  revalidatePath('/aufgaben');
  revalidatePath('/auftraege');
}

export async function submitTimeCorrection(
  rawInput: SubmitTimeCorrectionInput,
): Promise<TimeCorrectionResult> {
  const parsed = submitTimeCorrectionSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  if (
    input.calendarAdjustment &&
    (input.source !== null || input.proposedFacts.length !== 0 || !['edit', 'reassign'].includes(input.kind))
  ) {
    return { success: false, error: 'invalid_shape' };
  }
  if (input.calendarAdjustment) {
    const targets = new Set(input.calendarAdjustment.map((boundary) => boundary.employeeRecordId));
    if (targets.size !== 1 || (input.kind === 'edit') !== targets.has(input.subjectEmployeeRecordId)) {
      return { success: false, error: 'invalid_shape' };
    }
  }
  const shapeError = validateCorrectionShape({
    kind: input.kind,
    hasSource: Boolean(input.source || input.calendarAdjustment),
    proposedFactCount: input.calendarAdjustment?.length ?? input.proposedFacts.length,
  });
  if (shapeError) return { success: false, error: shapeError };
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const callerRole = await getMembershipRole(user.id, input.organizationId);
  if (!callerRole) return { success: false, error: 'not_a_member' };
  const identities = await loadEmployeeIdentities(input.organizationId, [input.subjectEmployeeRecordId]);
  const subject = identities?.get(input.subjectEmployeeRecordId);
  if (!subject) return { success: false, error: 'subject_not_found' };

  let responsibilitySnapshot: Json = {};
  if (subject.userId !== user.id) {
    const authorization = await authorizeResponsibilityForTarget({
      organizationId: input.organizationId,
      responsibility: 'time_approval',
      actorUserId: user.id,
      targetUserId: subject.userId,
      targetRole: subject.role,
    });
    if (!authorization.success) {
      return { success: false, error: authorization.error };
    }
    responsibilitySnapshot = {
      holderEmployeeRecordId: authorization.holder.employeeRecordId,
      source: authorization.holder.source,
      configurationId: authorization.effective.configurationId,
      resolvedAt: new Date().toISOString(),
    };
  }

  const replaying = await correctionOperationExists(input.organizationId, user.id, input.operationId);
  const initialTimeline = await readCorrectionTimelineRevision(input.organizationId);
  if (!initialTimeline.success) return initialTimeline;
  const sourceInputs = input.calendarAdjustment
    ? [
        ...new Map(
          input.calendarAdjustment.map((boundary) => [
            `${boundary.source.kind}:${boundary.source.id}`,
            boundary.source,
          ]),
        ).entries(),
      ]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, source]) => source)
    : [input.source];
  if (
    input.calendarAdjustment &&
    sourceInputs.filter((source) => source?.kind === 'correction_application').length > 1
  ) {
    return { success: false, error: 'time_correction_multiple_application_sources' };
  }
  const contexts = await Promise.all(
    sourceInputs.map((source) =>
      loadSourceContext({ organizationId: input.organizationId, subject, source }),
    ),
  );
  const refusals = contexts.filter((context) => typeof context === 'string');
  if (refusals.length) {
    // A failed read outranks a missing source: the source may well exist.
    const error = refusals.includes('correction_timeline_unavailable')
      ? 'correction_timeline_unavailable'
      : 'source_not_found';
    return { success: false, error };
  }
  const loadedContexts = contexts.filter((context) => typeof context !== 'string');
  let beforeSnapshot: TimeCorrectionSnapshot = {
    schemaVersion: 1,
    facts: loadedContexts.flatMap((context) => context.snapshot.facts),
  };
  let proposedFacts: Parameters<typeof buildProposedSnapshot>[0]['proposedFacts'] = input.proposedFacts;
  if (input.calendarAdjustment) {
    const proposal = proposeCalendarCorrection({
      contexts: loadedContexts,
      boundaries: input.calendarAdjustment,
    });
    if (!proposal.success) return proposal;
    proposedFacts = proposal.snapshot.facts;
    beforeSnapshot = proposal.before;
    const legacySources = sourceInputs.filter((source) => source?.kind === 'legacy_entry');
    if (legacySources.length) {
      const first = beforeSnapshot.facts[0];
      const last = beforeSnapshot.facts.at(-1);
      if (
        legacySources.length !== sourceInputs.length ||
        !first ||
        !last ||
        first.entryType !== 'clock_in' ||
        last.entryType !== 'clock_out'
      ) {
        return { success: false, error: 'calendar_incomplete_source' };
      }
      const admin = createSupabaseAdminClient();
      const [inside, preceding] = await Promise.all([
        admin
          .from('time_entries')
          .select('id, status')
          .eq('organization_id', input.organizationId)
          .eq('user_id', subject.userId)
          .gte('timestamp', first.timestamp)
          .lte('timestamp', last.timestamp)
          .limit(legacySources.length + 1),
        admin
          .from('time_entries')
          .select('entry_type')
          .eq('organization_id', input.organizationId)
          .eq('user_id', subject.userId)
          .lt('timestamp', first.timestamp)
          .order('timestamp', { ascending: false })
          .limit(1),
      ]);
      const sourceIds = new Set(legacySources.map((source) => source?.id));
      if (
        inside.error ||
        preceding.error ||
        inside.data?.length !== sourceIds.size ||
        inside.data.some((entry) => !sourceIds.has(entry.id) || entry.status !== 'approved') ||
        (preceding.data?.[0] && preceding.data[0].entry_type !== 'clock_out')
      ) {
        return { success: false, error: 'calendar_incomplete_source' };
      }
    }
  }
  const proposedSnapshot = await buildProposedSnapshot({
    organizationId: input.organizationId,
    proposedFacts,
  });
  if (!proposedSnapshot) return { success: false, error: 'source_not_found' };
  const sources = loadedContexts.flatMap((context) => (context.source ? [context.source] : []));
  const effectiveProposedSnapshot = input.calendarAdjustment
    ? proposedSnapshot
    : mergeCorrectionProposal(input.kind, beforeSnapshot, proposedSnapshot);
  if (!effectiveProposedSnapshot) return { success: false, error: 'activity_context_required' };
  if (!hasValidChronology(effectiveProposedSnapshot)) {
    return { success: false, error: 'invalid_time_order' };
  }
  if (
    input.calendarAdjustment &&
    effectiveProposedSnapshot.facts.some((fact) => Date.parse(fact.timestamp) > Date.now())
  ) {
    return { success: false, error: 'future_timestamp' };
  }
  if (!replaying) {
    const timelineError = await checkCorrectionTimeline(
      input.organizationId,
      [{ before: beforeSnapshot, proposed: effectiveProposedSnapshot, sources }],
      initialTimeline.revision,
    );
    if (!timelineError.success) return timelineError;
    responsibilitySnapshot = { ...responsibilitySnapshot, timelineRevision: timelineError.revision };
  }
  const sourceScopeKey = digest({
    organizationId: input.organizationId,
    subjectEmployeeRecordId: subject.id,
    sources,
    proposedFacts: sources.length === 0 ? effectiveProposedSnapshot.facts : undefined,
  });
  const sourceFingerprint = digest({
    sources,
    beforeSnapshot,
  });
  const { data, error } = await createSupabaseAdminClient().rpc('create_time_correction_request', {
    p_organization_id: input.organizationId,
    p_subject_employee_record_id: subject.id,
    p_actor_id: user.id,
    p_operation_id: input.operationId,
    p_kind: input.kind,
    p_reason: input.reason,
    p_source_scope_key: sourceScopeKey,
    p_source_fingerprint: sourceFingerprint,
    p_before_snapshot: beforeSnapshot,
    p_proposed_snapshot: effectiveProposedSnapshot,
    p_sources: sources,
    p_responsibility_snapshot: responsibilitySnapshot,
  });
  if (error) return { success: false, error: mapRpcError(error.message) };
  revalidateCorrectionSurfaces();
  return toCorrectionResult(data);
}

export async function reviewTimeCorrection(
  rawInput: ReviewTimeCorrectionInput,
): Promise<TimeCorrectionResult> {
  const parsed = reviewTimeCorrectionSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  if ((input.decision === 'reject' || input.decision === 'clarify') && !input.comment) {
    return { success: false, error: 'comment_required' };
  }
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const admin = createSupabaseAdminClient();
  const { data: request } = await loggedRead(
    'reviewTimeCorrection: time_correction_requests read failed',
    admin
      // tenant-scope: by-id-then-verified — the caller's time-approval responsibility in the request's organization is authorized below before the decision
      .from('time_correction_requests')
      .select('organization_id, subject_user_id')
      .eq('id', input.requestId)
      .maybeSingle(),
  );
  if (!request) return { success: false, error: 'request_not_found' };
  const { data: membership } = await loggedRead(
    'reviewTimeCorrection: organization_members read failed',
    admin
      .from('organization_members')
      .select('role')
      .eq('organization_id', request.organization_id)
      .eq('user_id', request.subject_user_id)
      .maybeSingle(),
  );
  if (!membership) return { success: false, error: 'subject_not_found' };
  const authorization = await authorizeResponsibilityForTarget({
    organizationId: request.organization_id,
    responsibility: 'time_approval',
    actorUserId: user.id,
    targetUserId: request.subject_user_id,
    targetRole: membership.role as OrgRole,
  });
  if (!authorization.success) {
    return { success: false, error: authorization.error };
  }
  let timelineRevision: number | undefined;
  if (
    input.decision === 'approve' &&
    !(await correctionOperationExists(request.organization_id, user.id, input.operationId))
  ) {
    const timelineError = await checkCorrectionReviewTimeline(request.organization_id, [input]);
    if (!timelineError.success) return timelineError;
    timelineRevision = timelineError.revision;
  }
  const responsibilitySnapshot: Json = {
    ...(timelineRevision !== undefined ? { timelineRevision } : {}),
    holderEmployeeRecordId: authorization.holder.employeeRecordId,
    source: authorization.holder.source,
    configurationId: authorization.effective.configurationId,
    resolvedAt: new Date().toISOString(),
  };
  const { data, error } = await admin.rpc(
    'decide_time_correction',
    rpcArgs('decide_time_correction', {
      p_request_id: input.requestId,
      p_actor_id: user.id,
      p_operation_id: input.operationId,
      p_expected_revision: input.expectedRevision,
      p_decision: input.decision,
      p_comment: input.comment,
      p_responsibility_snapshot: responsibilitySnapshot,
    }),
  );
  if (error) return { success: false, error: mapRpcError(error.message) };
  revalidateCorrectionSurfaces();
  return toCorrectionResult(data);
}

export async function withdrawTimeCorrection(rawInput: {
  requestId: string;
  operationId: string;
}): Promise<TimeCorrectionResult> {
  const parsedInput = withdrawCorrectionSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const { data, error } = await createSupabaseAdminClient().rpc('withdraw_time_correction', {
    p_request_id: input.requestId,
    p_actor_id: user.id,
    p_operation_id: input.operationId,
  });
  if (error) return { success: false, error: mapRpcError(error.message) };
  revalidateCorrectionSurfaces();
  return toCorrectionResult(data);
}

export async function resubmitTimeCorrection(rawInput: {
  requestId: string;
  expectedRevision: number;
  reason: string;
  operationId: string;
}): Promise<TimeCorrectionResult> {
  const parsedInput = resubmitCorrectionSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  if (input.reason.trim().length < 3 || input.reason.trim().length > 2000) {
    return { success: false, error: 'invalid_input' };
  }
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const admin = createSupabaseAdminClient();
  const { data: request } = await loggedRead(
    'resubmitTimeCorrection: time_correction_requests read failed',
    admin
      // tenant-scope: by-id-then-verified — revise_time_correction_request refuses an actor who is not the request's author, and the rows read here only feed that call
      .from('time_correction_requests')
      .select('organization_id, source_scope_key, current_revision')
      .eq('id', input.requestId)
      .maybeSingle(),
  );
  if (!request || request.current_revision !== input.expectedRevision) {
    return { success: false, error: 'time_correction_stale_revision' };
  }
  const [{ data: revision, error: revisionError }, { data: sources, error: sourcesError }] =
    await Promise.all([
      loggedRead(
        'resubmitTimeCorrection: time_correction_request_revisions read failed',
        admin
          .from('time_correction_request_revisions')
          .select('*')
          .eq('organization_id', request.organization_id)
          .eq('request_id', input.requestId)
          .eq('revision', input.expectedRevision)
          .maybeSingle(),
      ),
      loggedRead(
        'resubmitTimeCorrection: time_correction_request_sources read failed',
        admin
          .from('time_correction_request_sources')
          .select('*')
          .eq('organization_id', request.organization_id)
          .eq('request_id', input.requestId)
          .eq('revision', input.expectedRevision)
          .order('ordinal'),
      ),
    ]);
  // A failed source read must never submit a revision without its source links.
  if (revisionError || sourcesError || !sources) return { success: false, error: 'fetch_failed' };
  if (!revision) return { success: false, error: 'request_not_found' };
  const sourcePayload = sources.flatMap((source) => {
    const sourceId =
      source.time_entry_id ??
      source.time_session_id ??
      source.time_segment_id ??
      source.correction_application_id;
    return sourceId
      ? [
          {
            kind: source.source_kind,
            id: sourceId,
            version: source.source_version,
          },
        ]
      : [];
  });
  const { data, error } = await admin.rpc('revise_time_correction_request', {
    p_request_id: input.requestId,
    p_actor_id: user.id,
    p_operation_id: input.operationId,
    p_expected_revision: input.expectedRevision,
    p_reason: input.reason.trim(),
    p_source_scope_key: request.source_scope_key,
    p_source_fingerprint: revision.source_fingerprint,
    p_before_snapshot: revision.before_snapshot,
    p_proposed_snapshot: revision.proposed_snapshot,
    p_sources: sourcePayload,
  });
  if (error) return { success: false, error: mapRpcError(error.message) };
  revalidateCorrectionSurfaces();
  return toCorrectionResult(data);
}

export async function reviewTimeCorrectionsBatch(rawInput: {
  requests: Array<{ requestId: string; expectedRevision: number }>;
  decision: 'approve' | 'reject';
  comment: string | null;
}): Promise<{ success: true } | ActionFailure> {
  const parsedInput = reviewCorrectionsBatchSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  if (input.requests.length === 0 || input.requests.length > 100) {
    return { success: false, error: 'invalid_input' };
  }
  if (input.decision === 'reject' && !input.comment?.trim()) {
    return { success: false, error: 'comment_required' };
  }
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const admin = createSupabaseAdminClient();
  const requestIds = input.requests.map((request) => request.requestId);
  const { data: roots, error: rootError } = await readInBatches(requestIds, (batch) =>
    admin
      // tenant-scope: by-id-then-verified — the requests must share one organization, and the caller's time-approval responsibility in it is authorized below before any decision
      .from('time_correction_requests')
      .select('id, organization_id, subject_user_id')
      .in('id', [...batch]),
  );
  if (rootError) {
    logReadFailure('reviewTimeCorrectionsBatch: requests failed', rootError);
    return { success: false, error: 'fetch_failed' };
  }
  if (roots.length !== requestIds.length) return { success: false, error: 'request_not_found' };
  const organizationIds = new Set(roots.map((request) => request.organization_id));
  if (organizationIds.size !== 1) return { success: false, error: 'invalid_input' };
  const organizationId = roots[0]?.organization_id;
  if (!organizationId) return { success: false, error: 'invalid_input' };
  const userIds = [...new Set(roots.map((request) => request.subject_user_id))];
  const { data: memberships, error: membershipError } = await readInBatches(userIds, (batch) =>
    admin
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', organizationId)
      .in('user_id', [...batch]),
  );
  if (membershipError) {
    logReadFailure('reviewTimeCorrectionsBatch: memberships failed', membershipError);
    return { success: false, error: 'fetch_failed' };
  }
  const roleByUser = new Map(
    memberships.map((membership) => [membership.user_id, membership.role as OrgRole]),
  );
  for (const request of roots) {
    const targetRole = roleByUser.get(request.subject_user_id);
    if (!targetRole) return { success: false, error: 'subject_not_found' };
    const authorization = await authorizeResponsibilityForTarget({
      organizationId,
      responsibility: 'time_approval',
      actorUserId: user.id,
      targetUserId: request.subject_user_id,
      targetRole,
    });
    if (!authorization.success) return { success: false, error: authorization.error };
  }
  let timelineRevision: number | undefined;
  if (input.decision === 'approve') {
    const timelineError = await checkCorrectionReviewTimeline(organizationId, input.requests);
    if (!timelineError.success) return timelineError;
    timelineRevision = timelineError.revision;
  }
  const operationIds = input.requests.map(() => crypto.randomUUID());
  const { error } = await admin.rpc(
    'decide_time_correction_batch',
    rpcArgs('decide_time_correction_batch', {
      p_request_ids: requestIds,
      p_actor_id: user.id,
      p_operation_ids: operationIds,
      p_expected_revisions: input.requests.map((request) => request.expectedRevision),
      p_decision: input.decision,
      p_comment: input.comment,
      p_responsibility_snapshot: {
        mode: 'batch',
        ...(timelineRevision !== undefined ? { timelineRevision } : {}),
        resolvedAt: new Date().toISOString(),
      },
    }),
  );
  if (error) return { success: false, error: mapRpcError(error.message) };
  revalidateCorrectionSurfaces();
  return { success: true };
}

/** Which requests a list read selects in the database, before the page boundary. */
type CorrectionListFilter = {
  status: 'submitted' | 'open';
  subjectUserId?: string;
};

async function readCorrectionRequestList(input: {
  organizationId: string;
  callerUserId: string;
  callerRole: OrgRole;
  filter: CorrectionListFilter;
}): Promise<TimeCorrectionListResult> {
  const { organizationId, callerUserId, callerRole, filter } = input;
  const admin = createSupabaseAdminClient();
  // The holder lookup answers null for "not responsible" and for a failed
  // read alike; a failed read must not hide the requests the caller reviews.
  if (!(await loadResponsibilityRuntimeState(organizationId))) {
    return { success: false, error: 'responsibility_load_failed' };
  }
  const holder = await getEffectiveResponsibilityHolderForActor({
    organizationId,
    responsibility: 'time_approval',
    actorUserId: callerUserId,
  });
  // Complete on purpose: a newest-300 window hid older open requests from the
  // reviewer and from the provisional summary that counts them. An overflow
  // fails like a query error instead of showing a partial list.
  // An employee who reviews nobody sees only their own requests, so the
  // database selects them and the organization's history never reaches the bound.
  const ownRequestsOnly = callerRole === 'employee' && !holder;
  const { data: roots, error } = await readCompleteRows((from, to) => {
    let query = admin.from('time_correction_requests').select('*').eq('organization_id', organizationId);
    if (filter.status === 'submitted') query = query.eq('status', 'submitted');
    if (filter.status === 'open') query = query.in('status', [...PENDING_CORRECTION_STATUSES]);
    if (filter.subjectUserId) query = query.eq('subject_user_id', filter.subjectUserId);
    if (ownRequestsOnly) {
      query = query.or(`requested_by.eq.${callerUserId},subject_user_id.eq.${callerUserId}`);
    }
    return query.order('created_at', { ascending: false }).order('id').range(from, to);
  }, LIST_ROW_CAP);
  if (error) {
    logReadFailure('getTimeCorrectionRequests: requests failed', error);
    return { success: false, error: 'fetch_failed' };
  }
  return hydrateCorrectionRequests({ admin, organizationId, callerUserId, callerRole, holder, roots });
}

/**
 * The selected requests with names, the current revision and the caller's
 * review and withdraw rights, in the selection order, limited to the ones
 * the caller may see. A missing or unreadable revision fails the read.
 */
async function hydrateCorrectionRequests(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  organizationId: string;
  callerUserId: string;
  callerRole: OrgRole;
  holder: EffectiveResponsibilityHolder | null;
  roots: Tables<'time_correction_requests'>[];
}): Promise<TimeCorrectionListResult> {
  const { admin, organizationId, callerUserId, callerRole, holder, roots } = input;
  if (!roots.length) return { success: true, requests: [] };
  const requestIds = roots.map((request) => request.id);
  const userIds = [...new Set(roots.flatMap((request) => [request.requested_by, request.subject_user_id]))];
  const [memberships, profiles, revisions] = await Promise.all([
    readInBatches(userIds, (batch) =>
      admin
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', organizationId)
        .in('user_id', [...batch]),
    ),
    readInBatches(userIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', [...batch]),
    ),
    readInBatches(requestIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_correction_request_revisions')
            .select('*')
            .eq('organization_id', organizationId)
            .in('request_id', [...batch])
            .order('request_id')
            .order('revision')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  const detailError = memberships.error ?? profiles.error ?? revisions.error;
  if (detailError) {
    // Without roles or revisions the filter below would drop requests silently.
    logReadFailure('getTimeCorrectionRequests: request details failed', detailError);
    return { success: false, error: 'fetch_failed' };
  }
  const roleByUser = new Map(
    memberships.data.map((membership) => [membership.user_id, membership.role as OrgRole]),
  );
  const nameByUser = new Map(
    profiles.data.map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email,
    ]),
  );
  const revisionByKey = new Map(
    revisions.data.map((revision) => [`${revision.request_id}:${revision.revision}`, revision]),
  );
  const visible = roots.filter((request) => {
    const targetRole = roleByUser.get(request.subject_user_id);
    const canReview = Boolean(
      holder && targetRole && canHolderApproveTarget(holder, request.subject_user_id, targetRole),
    );
    return (
      callerRole !== 'employee' ||
      request.requested_by === callerUserId ||
      request.subject_user_id === callerUserId ||
      canReview
    );
  });
  const requests: TimeCorrectionRequest[] = [];
  for (const request of visible) {
    const revision = revisionByKey.get(`${request.id}:${request.current_revision}`);
    // The submit RPC writes a request and its current revision together. A
    // missing or unreadable revision is a broken read, never a shorter list.
    if (
      !revision ||
      !isTimeCorrectionSnapshot(revision.before_snapshot) ||
      !isTimeCorrectionSnapshot(revision.proposed_snapshot)
    ) {
      logError('getTimeCorrectionRequests: current revision missing or unreadable');
      return { success: false, error: 'fetch_failed' };
    }
    const targetRole = roleByUser.get(request.subject_user_id);
    const canReview = Boolean(
      request.status === 'submitted' &&
        holder &&
        targetRole &&
        canHolderApproveTarget(holder, request.subject_user_id, targetRole),
    );
    requests.push({
      id: request.id,
      organizationId: request.organization_id,
      subjectEmployeeRecordId: request.subject_employee_record_id,
      subjectUserId: request.subject_user_id,
      requestedBy: request.requested_by,
      kind: request.kind,
      status: request.status,
      currentRevision: request.current_revision,
      reviewedBy: request.reviewed_by,
      reviewedAt: request.reviewed_at,
      decisionComment: request.decision_comment,
      createdAt: request.created_at,
      updatedAt: request.updated_at,
      requesterName: nameByUser.get(request.requested_by) ?? 'Unbekannt',
      subjectName: nameByUser.get(request.subject_user_id) ?? 'Unbekannt',
      canReview,
      canWithdraw:
        request.requested_by === callerUserId &&
        (request.status === 'submitted' || request.status === 'clarification_required'),
      revision: {
        revision: revision.revision,
        reason: revision.reason,
        beforeSnapshot: revision.before_snapshot,
        proposedSnapshot: revision.proposed_snapshot,
        createdBy: revision.created_by,
        createdAt: revision.created_at,
      },
    });
  }
  return { success: true, requests };
}

/**
 * The approval queue of the active organization: the submitted requests,
 * selected in the database, so the queue never depends on the size of the
 * organization's history. The history pages through
 * `getTimeCorrectionHistoryPage`.
 */
export async function getTimeCorrectionRequests(
  organizationIdInput: string,
  scopeInput: 'approvals' = 'approvals',
): Promise<TimeCorrectionListResult> {
  const parsedInput = correctionListSchema.safeParse({
    organizationId: organizationIdInput,
    scope: scopeInput,
  });
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const { organizationId } = parsedInput.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const callerRole = await getMembershipRole(user.id, organizationId);
  if (!callerRole) return { success: false, error: 'not_a_member' };
  return readCorrectionRequestList({
    organizationId,
    callerUserId: user.id,
    callerRole,
    filter: { status: 'submitted' },
  });
}

/**
 * One page of the correction history, newest first. The database applies
 * the caller's visibility (`correctionHistoryVisibility`), the count and
 * the page boundary; this reader hydrates the page rows only.
 */
export async function getTimeCorrectionHistoryPage(
  organizationIdInput: string,
  pageInput: number,
): Promise<TimeCorrectionHistoryResult> {
  const parsedInput = correctionHistorySchema.safeParse({
    organizationId: organizationIdInput,
    page: pageInput,
  });
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const { organizationId, page } = parsedInput.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const callerRole = await getMembershipRole(user.id, organizationId);
  if (!callerRole) return { success: false, error: 'not_a_member' };
  // The holder lookup answers null for "not responsible" and for a failed
  // read alike; a failed read must not narrow the history silently.
  if (!(await loadResponsibilityRuntimeState(organizationId))) {
    return { success: false, error: 'responsibility_load_failed' };
  }
  const holder = await getEffectiveResponsibilityHolderForActor({
    organizationId,
    responsibility: 'time_approval',
    actorUserId: user.id,
  });
  const admin = createSupabaseAdminClient();
  const selected = await admin.rpc('list_time_correction_history_page', {
    p_organization_id: organizationId,
    p_caller_user_id: user.id,
    p_visibility: correctionHistoryVisibility(callerRole, holder),
    p_page: page,
    p_page_size: LIST_PAGE_SIZE,
  });
  const selection = historySelectionSchema.safeParse(selected.data);
  if (selected.error || !selection.success) {
    logReadFailure('getTimeCorrectionHistoryPage: page selection failed', {
      code: selected.error?.code ?? 'malformed_page',
    });
    return { success: false, error: 'fetch_failed' };
  }
  const { data: rows, error } = await readInBatches(selection.data.ids, (batch) =>
    admin
      .from('time_correction_requests')
      .select('*')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (error) {
    logReadFailure('getTimeCorrectionHistoryPage: page rows failed', error);
    return { success: false, error: 'fetch_failed' };
  }
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const hydrated = await hydrateCorrectionRequests({
    admin,
    organizationId,
    callerUserId: user.id,
    callerRole,
    holder,
    roots: selection.data.ids.flatMap((id) => {
      const row = rowById.get(id);
      return row ? [row] : [];
    }),
  });
  if (!hydrated.success) return hydrated;
  return { success: true, page: { requests: hydrated.requests, total: selection.data.total } };
}

export type TimeCorrectionFormOptions = {
  people: Array<{
    employeeRecordId: string;
    userId: string;
    name: string;
    role: OrgRole;
  }>;
  jobs: Array<{ id: string; label: string }>;
  currentEmployeeRecordId: string;
};

export async function getTimeCorrectionFormOptions(
  organizationIdInput: string,
): Promise<{ success: true; options: TimeCorrectionFormOptions } | ActionFailure> {
  const parsedOrganizationId = uuidSchema.safeParse(organizationIdInput);
  if (!parsedOrganizationId.success) return { success: false, error: 'invalid_input' };
  const organizationId = parsedOrganizationId.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  if (!(await getMembershipRole(user.id, organizationId))) {
    return { success: false, error: 'not_a_member' };
  }
  const admin = createSupabaseAdminClient();
  // Every open job is selectable: a newest-300 window made older open jobs unreachable.
  const [
    { data: employees, error: employeeError },
    { data: memberships, error: membershipError },
    { data: jobs, error: jobError },
  ] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('employee_records')
          .select('id, user_id')
          .eq('organization_id', organizationId)
          .not('user_id', 'is', null)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_members')
          .select('user_id, role')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select('id, title, job_number')
          .eq('organization_id', organizationId)
          .neq('status', 'fertig')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);
  const userIds = employees.map((employee) => employee.user_id as string);
  const { data: profiles, error: profileError } = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', [...batch]),
  );
  const optionsError = employeeError ?? membershipError ?? jobError ?? profileError;
  if (optionsError) {
    logReadFailure('getTimeCorrectionFormOptions: options failed', optionsError);
    return { success: false, error: 'fetch_failed' };
  }
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const roleById = new Map(memberships.map((membership) => [membership.user_id, membership.role as OrgRole]));
  const people = employees.flatMap((employee) => {
    const userId = employee.user_id as string;
    const role = roleById.get(userId);
    if (!role) return [];
    const profile = profileById.get(userId);
    return [
      {
        employeeRecordId: employee.id,
        userId,
        name:
          [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
          profile?.email ||
          'Unbekannt',
        role,
      },
    ];
  });
  const current = people.find((person) => person.userId === user.id);
  if (!current) return { success: false, error: 'subject_not_found' };
  return {
    success: true,
    options: {
      people,
      jobs: jobs.map((job) => ({
        id: job.id,
        label: [job.job_number, job.title].filter(Boolean).join(' · '),
      })),
      currentEmployeeRecordId: current.employeeRecordId,
    },
  };
}

export type ProvisionalTimeCorrectionProjection = {
  entries: import('@/lib/time-tracking/types').TimeEntry[];
  sources: Array<{
    requestId: string;
    kind: TimeCorrectionRequest['kind'];
    sourceKind: TimeCorrectionSource['kind'];
    sourceId: string;
  }>;
};

export async function getProvisionalTimeCorrectionProjection(rawInput: {
  organizationId: string;
  from: string;
  to: string;
  userId?: string | undefined;
}): Promise<ProvisionalTimeCorrectionProjection> {
  const parsedInput = correctionProjectionSchema.safeParse(rawInput);
  if (!parsedInput.success) return { entries: [], sources: [] };
  const input = parsedInput.data;
  // Pending-only, subject-filtered read; the same identity and
  // visibility rules as the list reader, without its names and memberships.
  const user = await getAuthenticatedUser();
  if (!user) return { entries: [], sources: [] };
  const callerRole = await getMembershipRole(user.id, input.organizationId);
  if (!callerRole) return { entries: [], sources: [] };
  // Managers can view every pending request; an employee's own-subject
  // projection needs no delegated approval scope. Resolve it only for the
  // unfiltered employee view that may include another person's requests.
  const holder =
    callerRole === 'employee' && input.userId === undefined
      ? await getEffectiveResponsibilityHolderForActor({
          organizationId: input.organizationId,
          responsibility: 'time_approval',
          actorUserId: user.id,
        })
      : null;
  const projection = await loadPendingCorrectionProjection(
    createPendingProjectionPort(createSupabaseAdminClient()),
    {
      organizationId: input.organizationId,
      subjectUserId: input.userId,
      caller: { userId: user.id, role: callerRole, holder },
    },
  );
  if (!projection) throw new Error('Pending time corrections could not be read completely.');
  if (projection.requests.length === 0) return { entries: [], sources: [] };
  const pending = projection.requests;
  const rows = projection.sources;
  const requestById = new Map(pending.map((request) => [request.id, request]));
  const sources = rows.flatMap((source) => {
    const sourceId =
      source.time_entry_id ??
      source.time_session_id ??
      source.time_segment_id ??
      source.correction_application_id;
    const request = requestById.get(source.request_id);
    return sourceId && request && source.revision === request.currentRevision
      ? [
          {
            requestId: request.id,
            kind: request.kind,
            sourceKind: source.source_kind,
            sourceId,
          },
        ]
      : [];
  });
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  const entries = pending.flatMap((request) =>
    request.proposedSnapshot.facts.flatMap((fact) => {
      const timestamp = Date.parse(fact.timestamp);
      if (timestamp < from || timestamp > to || (input.userId && fact.userId !== input.userId)) {
        return [];
      }
      return [
        {
          id: `proposal:${request.id}:${request.currentRevision}:${fact.factId}`,
          userId: fact.userId,
          organizationId: input.organizationId,
          entryType: fact.entryType,
          timestamp: fact.timestamp,
          isManual: true,
          jobId: fact.jobId,
          status: 'pending' as const,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: request.updatedAt,
          updatedAt: request.updatedAt,
          activityKind: fact.activityKind ?? undefined,
          pendingCorrectionRequestId: request.id,
          pendingCorrectionKind: request.kind,
          isProvisionalCorrection: true,
        },
      ];
    }),
  );
  return { entries, sources };
}

function snapshotMinutes(snapshot: TimeCorrectionSnapshot): number {
  let activeStart: number | null = null;
  let minutes = 0;
  for (const fact of [...snapshot.facts].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  )) {
    const timestamp = Date.parse(fact.timestamp);
    if (fact.entryType === 'clock_in' || fact.entryType === 'break_end') {
      activeStart = timestamp;
    } else if (activeStart !== null) {
      minutes += Math.max(0, Math.round((timestamp - activeStart) / 60_000));
      activeStart = null;
    }
  }
  return minutes;
}

export async function getProvisionalTimeSummary(rawInput: {
  organizationId: string;
  userId: string;
}): Promise<
  { success: true; count: number; beforeMinutes: number; proposedMinutes: number } | ActionFailure
> {
  const parsedInput = correctionSummarySchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const role = await getMembershipRole(user.id, input.organizationId);
  if (!role) return { success: false, error: 'not_a_member' };
  if (role === 'employee' && input.userId !== user.id) {
    return { success: false, error: 'not_authorized' };
  }
  const result = await readCorrectionRequestList({
    organizationId: input.organizationId,
    callerUserId: user.id,
    callerRole: role,
    filter: { status: 'open', subjectUserId: input.userId },
  });
  if (!result.success) return result;
  const pending = result.requests;
  return {
    success: true,
    count: pending.length,
    beforeMinutes: pending.reduce(
      (total, request) => total + snapshotMinutes(request.revision.beforeSnapshot),
      0,
    ),
    proposedMinutes: pending.reduce(
      (total, request) => total + snapshotMinutes(request.revision.proposedSnapshot),
      0,
    ),
  };
}

'use server';

import type { ActionFailure } from '@/lib/action-result';
import { createHash } from 'node:crypto';
import { canonicalize } from '@/lib/format/canonical-json';
import { revalidatePath } from 'next/cache';

import { getAuthenticatedUser } from '@/lib/data/cached';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { logReadFailure, loggedRead } from '@/lib/data/read-request-cache';
import {
  authorizeResponsibilityForTarget,
  getEffectiveResponsibilityHolderForActor,
} from '@/lib/responsibilities/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isJsonRecord } from '@/lib/supabase/json';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import {
  checkCorrectionTimeline,
  checkCorrectionReviewTimeline,
  correctionOperationExists,
  readCorrectionTimelineRevision,
} from './timeline-server';
import { readInBatches } from '@/lib/supabase/query-batches';
import { Constants, type Json, type Tables } from '@/lib/supabase/database.types';
import type { TimeEntry } from '@/lib/time-tracking/types';
import {
  createPendingProjectionPort,
  loadPendingCorrectionProjection,
  type PendingCorrectionRequest,
} from './pending-projection';
import { loadEmployeeIdentities } from './source-context';
import {
  loadSubmissionContexts,
  proposeSubmission,
  submissionResponsibility,
  submissionShapeError,
  submissionSourceInputs,
} from './submission';

import {
  correctionSourceId,
  type TimeCorrectionRequest,
  type TimeCorrectionResult,
  type TimeCorrectionSource,
} from './types';
import {
  reviewTimeCorrectionSchema,
  submitTimeCorrectionSchema,
  type ReviewTimeCorrectionInput,
  type SubmitTimeCorrectionInput,
} from './validation';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

// The Server Actions that write time corrections: submit, review, withdraw
// and resubmit a request, and review several at once. Beside them the
// provisional projection the time-tracking entry reads merge in; its
// reviewed result-shape exception names this module. The other reads live
// in read-actions.ts.

const correctionDateSchema = z.string().max(40);
const correctionProjectionSchema = z.object({
  organizationId: uuidSchema,
  from: correctionDateSchema,
  to: correctionDateSchema,
  userId: uuidSchema.optional(),
});
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

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function toCorrectionResult(data: Json | null): TimeCorrectionResult {
  if (!isJsonRecord(data)) return { success: false, error: 'request_failed' };
  const { requestId, applicationId, status: statusValue, replayed } = data;
  const status = Constants.public.Enums.time_correction_status.find((value) => value === statusValue);
  if (typeof requestId !== 'string' || status === undefined) {
    return { success: false, error: 'request_failed' };
  }
  return {
    success: true,
    requestId,
    ...(typeof applicationId === 'string' || applicationId === null ? { applicationId } : {}),
    status,
    replayed: replayed === true,
  };
}

function timeCorrectionFailureCode(message: string): string {
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
  const shapeError = submissionShapeError(input);
  if (shapeError) return { success: false, error: shapeError };
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const caller = await resolveActionContextFor(input.organizationId);
  if (!caller.success) return caller;
  const identities = await loadEmployeeIdentities(input.organizationId, [input.subjectEmployeeRecordId]);
  const subject = identities?.get(input.subjectEmployeeRecordId);
  if (!subject) return { success: false, error: 'subject_not_found' };

  const responsibility = await submissionResponsibility(input.organizationId, user.id, subject);
  if (!responsibility.success) return { success: false, error: responsibility.error };
  let responsibilitySnapshot = responsibility.snapshot;

  const replaying = await correctionOperationExists(input.organizationId, user.id, input.operationId);
  const initialTimeline = await readCorrectionTimelineRevision(input.organizationId);
  if (!initialTimeline.success) return initialTimeline;
  const sourceInputs = submissionSourceInputs(input);
  if (
    input.calendarAdjustment &&
    sourceInputs.filter((source) => source?.kind === 'correction_application').length > 1
  ) {
    return { success: false, error: 'time_correction_multiple_application_sources' };
  }
  const loaded = await loadSubmissionContexts(input.organizationId, subject, sourceInputs);
  if (!loaded.success) return loaded;
  const proposal = await proposeSubmission({
    submission: input,
    subject,
    sourceInputs,
    contexts: loaded.contexts,
  });
  if (!proposal.success) return proposal;
  const { before: beforeSnapshot, proposed: effectiveProposedSnapshot, sources } = proposal;
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
  if (error) return { success: false, error: timeCorrectionFailureCode(error.message) };
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
  const { data: request, error: requestError } = await loggedRead(
    'reviewTimeCorrection: time_correction_requests read failed',
    admin
      // tenant-scope: by-id-then-verified — the caller's time-approval responsibility in the request's organization is authorized below before the decision
      .from('time_correction_requests')
      .select('organization_id, subject_user_id')
      .eq('id', input.requestId)
      .maybeSingle(),
  );
  if (requestError) return { success: false, error: 'load_failed' };
  if (!request) return { success: false, error: 'request_not_found' };
  const caller = await resolveActionContextFor(request.organization_id);
  if (!caller.success) return caller;
  const { data: membership, error: membershipError } = await loggedRead(
    'reviewTimeCorrection: organization_members read failed',
    admin
      .from('organization_members')
      .select('role')
      .eq('organization_id', request.organization_id)
      .eq('user_id', request.subject_user_id)
      .maybeSingle(),
  );
  if (membershipError) return { success: false, error: 'load_failed' };
  if (!membership) return { success: false, error: 'subject_not_found' };
  const authorization = await authorizeResponsibilityForTarget({
    organizationId: request.organization_id,
    responsibility: 'time_approval',
    actorUserId: user.id,
    targetUserId: request.subject_user_id,
    targetRole: membership.role,
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
  if (error) return { success: false, error: timeCorrectionFailureCode(error.message) };
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
  if (error) return { success: false, error: timeCorrectionFailureCode(error.message) };
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
  const { data: request, error: requestError } = await loggedRead(
    'resubmitTimeCorrection: time_correction_requests read failed',
    admin
      // tenant-scope: by-id-then-verified — revise_time_correction_request refuses an actor who is not the request's author, and the rows read here only feed that call
      .from('time_correction_requests')
      .select('organization_id, source_scope_key, current_revision')
      .eq('id', input.requestId)
      .maybeSingle(),
  );
  if (requestError) return { success: false, error: 'load_failed' };
  if (!request || request.current_revision !== input.expectedRevision) {
    return { success: false, error: 'time_correction_stale_revision' };
  }
  const caller = await resolveActionContextFor(request.organization_id);
  if (!caller.success) return caller;
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
  if (revisionError || sourcesError || !sources) return { success: false, error: 'load_failed' };
  if (!revision) return { success: false, error: 'request_not_found' };
  const sourcePayload = sources.flatMap((source) => {
    const sourceId = correctionSourceId(source);
    return sourceId ? [{ kind: source.source_kind, id: sourceId, version: source.source_version }] : [];
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
  if (error) return { success: false, error: timeCorrectionFailureCode(error.message) };
  revalidateCorrectionSurfaces();
  return toCorrectionResult(data);
}

/**
 * The caller's time-approval responsibility for the subject of every request
 * of a batch, in one organization; the first refusal stops the batch.
 */
async function authorizeBatchTargets(
  organizationId: string,
  actorUserId: string,
  roots: Pick<Tables<'time_correction_requests'>, 'subject_user_id'>[],
): Promise<{ success: true } | ActionFailure> {
  const userIds = [...new Set(roots.map((request) => request.subject_user_id))];
  const { data: memberships, error: membershipError } = await readInBatches(userIds, (batch) =>
    createSupabaseAdminClient()
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', organizationId)
      .in('user_id', [...batch]),
  );
  if (membershipError) {
    logReadFailure('reviewTimeCorrectionsBatch: memberships failed', membershipError);
    return { success: false, error: 'fetch_failed' };
  }
  const roleByUser = new Map(memberships.map((membership) => [membership.user_id, membership.role]));
  for (const request of roots) {
    const targetRole = roleByUser.get(request.subject_user_id);
    if (!targetRole) return { success: false, error: 'subject_not_found' };
    const authorization = await authorizeResponsibilityForTarget({
      organizationId,
      responsibility: 'time_approval',
      actorUserId,
      targetUserId: request.subject_user_id,
      targetRole,
    });
    if (!authorization.success) return { success: false, error: authorization.error };
  }
  return { success: true };
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
  const caller = await resolveActionContextFor(organizationId);
  if (!caller.success) return caller;
  const targets = await authorizeBatchTargets(organizationId, user.id, roots);
  if (!targets.success) return targets;
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
  if (error) return { success: false, error: timeCorrectionFailureCode(error.message) };
  revalidateCorrectionSurfaces();
  return { success: true };
}

export type ProvisionalTimeCorrectionProjection = {
  entries: TimeEntry[];
  sources: Array<{
    requestId: string;
    kind: TimeCorrectionRequest['kind'];
    sourceKind: TimeCorrectionSource['kind'];
    sourceId: string;
  }>;
};

/** The proposed facts of the pending requests as provisional entries inside the window. */
function provisionalEntries(
  pending: PendingCorrectionRequest[],
  window: { organizationId: string; from: string; to: string; userId?: string | undefined },
): TimeEntry[] {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  return pending.flatMap((request) =>
    request.proposedSnapshot.facts.flatMap((fact) => {
      const timestamp = Date.parse(fact.timestamp);
      if (timestamp < from || timestamp > to || (window.userId && fact.userId !== window.userId)) {
        return [];
      }
      return [
        {
          id: `proposal:${request.id}:${request.currentRevision}:${fact.factId}`,
          userId: fact.userId,
          organizationId: window.organizationId,
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
}

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
  const caller = await resolveActionContextFor(input.organizationId);
  if (!caller.success) return { entries: [], sources: [] };
  const callerRole = caller.context.role;
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
  const requestById = new Map(pending.map((request) => [request.id, request]));
  const sources = projection.sources.flatMap((source) => {
    const sourceId = correctionSourceId(source);
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
  return { entries: provisionalEntries(pending, input), sources };
}

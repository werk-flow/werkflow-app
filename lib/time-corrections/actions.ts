'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import { canHolderApproveTarget } from '@/lib/responsibilities/resolution';
import {
  authorizeResponsibilityForTarget,
  getEffectiveResponsibilityHolderForActor,
} from '@/lib/responsibilities/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import type {
  OrgRole,
  TimeEntryType,
  TimeSegmentKind,
} from '@/lib/time-tracking/types';

import {
  isTimeCorrectionSnapshot,
  type TimeCorrectionApplicationProjection,
  type TimeCorrectionFact,
  type TimeCorrectionListResult,
  type TimeCorrectionRequest,
  type TimeCorrectionResult,
  type TimeCorrectionSnapshot,
  type TimeCorrectionSource,
} from './types';
import {
  reviewTimeCorrectionSchema,
  reviseTimeCorrectionSchema,
  submitTimeCorrectionSchema,
  validateCorrectionShape,
  type ReviewTimeCorrectionInput,
  type ReviseTimeCorrectionInput,
  type SubmitTimeCorrectionInput,
} from './validation';

type EmployeeIdentity = {
  id: string;
  userId: string;
  role: OrgRole;
};

type SourceContext = {
  source: TimeCorrectionSource | null;
  snapshot: TimeCorrectionSnapshot;
};

type RpcCorrectionResult = {
  requestId: string;
  applicationId?: string | null;
  status: string;
  replayed: boolean;
};

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}

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

async function getMembershipRole(
  userId: string,
  organizationId: string
): Promise<OrgRole | null> {
  const memberships = await getCachedMemberships(userId);
  return (memberships.find((membership) => membership.orgId === organizationId)
    ?.role as OrgRole | undefined) ?? null;
}

async function loadEmployeeIdentities(
  organizationId: string,
  employeeRecordIds: readonly string[]
): Promise<Map<string, EmployeeIdentity> | null> {
  const uniqueIds = [...new Set(employeeRecordIds)];
  if (uniqueIds.length === 0) return new Map();
  const admin = createSupabaseAdminClient();
  const { data: employees, error: employeeError } = await admin
    .from('employee_records')
    .select('id, user_id')
    .eq('organization_id', organizationId)
    .in('id', uniqueIds)
    .not('user_id', 'is', null);
  if (employeeError || employees?.length !== uniqueIds.length) return null;
  const userIds = employees.map((employee) => employee.user_id as string);
  const { data: memberships, error: membershipError } = await admin
    .from('organization_members')
    .select('user_id, role')
    .eq('organization_id', organizationId)
    .in('user_id', userIds);
  if (membershipError || memberships?.length !== uniqueIds.length) return null;
  const roleByUser = new Map(
    memberships.map((membership) => [membership.user_id, membership.role as OrgRole])
  );
  return new Map(
    employees.map((employee) => [
      employee.id,
      {
        id: employee.id,
        userId: employee.user_id as string,
        role: roleByUser.get(employee.user_id as string) as OrgRole,
      },
    ])
  );
}

function segmentEntryTypes(kind: string): [TimeEntryType, TimeEntryType] {
  return kind === 'break'
    ? ['break_start', 'break_end']
    : ['clock_in', 'clock_out'];
}

async function loadSourceContext(input: {
  organizationId: string;
  subject: EmployeeIdentity;
  source: SubmitTimeCorrectionInput['source'];
}): Promise<SourceContext | null> {
  if (!input.source) return { source: null, snapshot: { schemaVersion: 1, facts: [] } };
  const admin = createSupabaseAdminClient();

  if (input.source.kind === 'legacy_entry') {
    const { data: entry } = await admin
      .from('time_entries')
      .select('id, user_id, entry_type, timestamp, job_id, is_manual, updated_at')
      .eq('id', input.source.id)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (!entry || entry.user_id !== input.subject.userId) return null;
    return {
      source: {
        kind: 'legacy_entry',
        id: entry.id,
        version: normalizeTimestampSourceVersion(entry.updated_at),
      },
      snapshot: {
        schemaVersion: 1,
        facts: [{
          factId: entry.id,
          employeeRecordId: input.subject.id,
          userId: input.subject.userId,
          entryType: entry.entry_type as TimeEntryType,
          timestamp: entry.timestamp,
          jobId: entry.job_id,
          activityKind: null,
          isManual: entry.is_manual,
        }],
      },
    };
  }

  if (input.source.kind === 'canonical_segment') {
    const { data: segment } = await admin
      .from('time_segments')
      .select('id, employee_record_id, kind, job_id, started_at, ended_at, updated_at')
      .eq('id', input.source.id)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (!segment || segment.employee_record_id !== input.subject.id) return null;
    const [startType, endType] = segmentEntryTypes(segment.kind);
    const facts: TimeCorrectionFact[] = [{
      factId: `${segment.id}:start`,
      employeeRecordId: input.subject.id,
      userId: input.subject.userId,
      entryType: startType,
      timestamp: segment.started_at,
      jobId: segment.job_id,
      activityKind: segment.kind as TimeSegmentKind,
      isManual: false,
    }];
    if (segment.ended_at) {
      facts.push({
        ...facts[0],
        factId: `${segment.id}:end`,
        entryType: endType,
        timestamp: segment.ended_at,
      });
    }
    return {
      source: {
        kind: 'canonical_segment',
        id: segment.id,
        version: normalizeTimestampSourceVersion(segment.updated_at),
      },
      snapshot: { schemaVersion: 1, facts },
    };
  }

  if (input.source.kind === 'correction_application') {
    const { data: application } = await admin
      .from('time_correction_applications')
      .select('id, source_fingerprint, applied_snapshot, request_id')
      .eq('id', input.source.id)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (!application || !isTimeCorrectionSnapshot(application.applied_snapshot)) {
      return null;
    }
    const { data: request } = await admin
      .from('time_correction_requests')
      .select('subject_employee_record_id')
      .eq('id', application.request_id)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (request?.subject_employee_record_id !== input.subject.id) return null;
    return {
      source: {
        kind: 'correction_application',
        id: application.id,
        version: application.source_fingerprint,
      },
      snapshot: application.applied_snapshot,
    };
  }

  return null;
}

async function buildProposedSnapshot(input: {
  organizationId: string;
  proposedFacts: SubmitTimeCorrectionInput['proposedFacts'];
}): Promise<TimeCorrectionSnapshot | null> {
  const identities = await loadEmployeeIdentities(
    input.organizationId,
    input.proposedFacts.map((fact) => fact.employeeRecordId)
  );
  if (!identities) return null;
  const jobIds = [...new Set(
    input.proposedFacts.flatMap((fact) => fact.jobId ? [fact.jobId] : [])
  )];
  if (jobIds.length > 0) {
    const { count, error } = await createSupabaseAdminClient()
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', input.organizationId)
      .in('id', jobIds);
    if (error || count !== jobIds.length) return null;
  }
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
      isManual: true,
    };
  });
  return { schemaVersion: 1, facts };
}

function toCorrectionResult(data: Json | null): TimeCorrectionResult {
  if (!data || Array.isArray(data) || typeof data !== 'object') {
    return { success: false, error: 'request_failed' };
  }
  const result = data as unknown as RpcCorrectionResult;
  return {
    success: true,
    requestId: result.requestId,
    applicationId: result.applicationId,
    status: result.status as TimeCorrectionRequest['status'],
    replayed: result.replayed,
  };
}

function mergeCorrectionProposal(
  kind: SubmitTimeCorrectionInput['kind'],
  before: TimeCorrectionSnapshot,
  proposed: TimeCorrectionSnapshot
): TimeCorrectionSnapshot {
  const patch = proposed.facts[0];
  if (!patch || before.facts.length <= 1) return proposed;
  if (kind === 'reclassify') {
    return {
      schemaVersion: 1,
      facts: before.facts.map((fact) => ({
        ...fact,
        activityKind: patch.activityKind,
      })),
    };
  }
  if (kind === 'reallocate') {
    return {
      schemaVersion: 1,
      facts: before.facts.map((fact) => ({ ...fact, jobId: patch.jobId })),
    };
  }
  if (kind === 'reassign') {
    return {
      schemaVersion: 1,
      facts: before.facts.map((fact) => ({
        ...fact,
        employeeRecordId: patch.employeeRecordId,
        userId: patch.userId,
      })),
    };
  }
  if (kind !== 'edit') return proposed;
  const exactIndex = before.facts.findIndex(
    (fact) => fact.entryType === patch.entryType
  );
  const directionIndex = before.facts.findIndex((fact) =>
    ['clock_in', 'break_start'].includes(fact.entryType)
      === ['clock_in', 'break_start'].includes(patch.entryType)
  );
  const targetIndex = exactIndex >= 0 ? exactIndex : directionIndex;
  if (targetIndex < 0) return proposed;
  return {
    schemaVersion: 1,
    facts: before.facts.map((fact, index) => index === targetIndex
      ? { ...fact, timestamp: patch.timestamp }
      : fact),
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
  const known = [
    'time_correction_not_responsible',
    'time_correction_self_approval_forbidden',
    'time_correction_stale_source',
    'time_correction_stale_revision',
    'time_correction_comment_required',
    'time_correction_not_submitted',
    'time_correction_not_withdrawable',
    'time_correction_not_requester',
  ].find((code) => message.includes(code));
  return known ?? 'request_failed';
}

function revalidateCorrectionSurfaces(): void {
  revalidatePath('/zeiterfassung');
  revalidatePath('/kalender');
  revalidatePath('/aufgaben');
  revalidatePath('/auftraege');
}

export async function submitTimeCorrection(
  rawInput: SubmitTimeCorrectionInput
): Promise<TimeCorrectionResult> {
  const parsed = submitTimeCorrectionSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const shapeError = validateCorrectionShape({
    kind: input.kind,
    hasSource: Boolean(input.source),
    proposedFactCount: input.proposedFacts.length,
  });
  if (shapeError) return { success: false, error: shapeError };
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const callerRole = await getMembershipRole(user.id, input.organizationId);
  if (!callerRole) return { success: false, error: 'not_a_member' };
  const identities = await loadEmployeeIdentities(
    input.organizationId,
    [input.subjectEmployeeRecordId]
  );
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

  const [sourceContext, proposedSnapshot] = await Promise.all([
    loadSourceContext({
      organizationId: input.organizationId,
      subject,
      source: input.source,
    }),
    buildProposedSnapshot({
      organizationId: input.organizationId,
      proposedFacts: input.proposedFacts,
    }),
  ]);
  if (!sourceContext || !proposedSnapshot) {
    return { success: false, error: 'source_not_found' };
  }
  const sources = sourceContext.source ? [sourceContext.source] : [];
  const effectiveProposedSnapshot = mergeCorrectionProposal(
    input.kind,
    sourceContext.snapshot,
    proposedSnapshot
  );
  if (!hasValidChronology(effectiveProposedSnapshot)) {
    return { success: false, error: 'invalid_time_order' };
  }
  const sourceScopeKey = digest({
    organizationId: input.organizationId,
    subjectEmployeeRecordId: subject.id,
    sources,
    proposedFacts: sources.length === 0 ? effectiveProposedSnapshot.facts : undefined,
  });
  const sourceFingerprint = digest({
    sources,
    beforeSnapshot: sourceContext.snapshot,
  });
  const { data, error } = await createSupabaseAdminClient().rpc(
    'create_time_correction_request',
    {
      p_organization_id: input.organizationId,
      p_subject_employee_record_id: subject.id,
      p_actor_id: user.id,
      p_operation_id: input.operationId,
      p_kind: input.kind,
      p_reason: input.reason,
      p_source_scope_key: sourceScopeKey,
      p_source_fingerprint: sourceFingerprint,
      p_before_snapshot: sourceContext.snapshot,
      p_proposed_snapshot: effectiveProposedSnapshot,
      p_sources: sources,
      p_responsibility_snapshot: responsibilitySnapshot,
    }
  );
  if (error) return { success: false, error: mapRpcError(error.message) };
  revalidateCorrectionSurfaces();
  return toCorrectionResult(data);
}

export async function reviseTimeCorrection(
  rawInput: ReviseTimeCorrectionInput
): Promise<TimeCorrectionResult> {
  const parsed = reviseTimeCorrectionSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const admin = createSupabaseAdminClient();
  const { data: request } = await admin
    .from('time_correction_requests')
    .select('organization_id, subject_employee_record_id, kind')
    .eq('id', input.requestId)
    .maybeSingle();
  if (!request) return { success: false, error: 'request_not_found' };
  const identities = await loadEmployeeIdentities(
    request.organization_id,
    [request.subject_employee_record_id]
  );
  const subject = identities?.get(request.subject_employee_record_id);
  if (!subject) return { success: false, error: 'subject_not_found' };
  const shapeError = validateCorrectionShape({
    kind: request.kind,
    hasSource: Boolean(input.source),
    proposedFactCount: input.proposedFacts.length,
  });
  if (shapeError) return { success: false, error: shapeError };
  const [sourceContext, proposedSnapshot] = await Promise.all([
    loadSourceContext({
      organizationId: request.organization_id,
      subject,
      source: input.source,
    }),
    buildProposedSnapshot({
      organizationId: request.organization_id,
      proposedFacts: input.proposedFacts,
    }),
  ]);
  if (!sourceContext || !proposedSnapshot) {
    return { success: false, error: 'source_not_found' };
  }
  const sources = sourceContext.source ? [sourceContext.source] : [];
  const effectiveProposedSnapshot = mergeCorrectionProposal(
    request.kind,
    sourceContext.snapshot,
    proposedSnapshot
  );
  if (!hasValidChronology(effectiveProposedSnapshot)) {
    return { success: false, error: 'invalid_time_order' };
  }
  const { data, error } = await admin.rpc('revise_time_correction_request', {
    p_request_id: input.requestId,
    p_actor_id: user.id,
    p_operation_id: input.operationId,
    p_expected_revision: input.expectedRevision,
    p_reason: input.reason,
    p_source_scope_key: digest({
      organizationId: request.organization_id,
      subjectEmployeeRecordId: subject.id,
      sources,
      proposedFacts: sources.length === 0 ? effectiveProposedSnapshot.facts : undefined,
    }),
    p_source_fingerprint: digest({ sources, beforeSnapshot: sourceContext.snapshot }),
    p_before_snapshot: sourceContext.snapshot,
    p_proposed_snapshot: effectiveProposedSnapshot,
    p_sources: sources,
  });
  if (error) return { success: false, error: mapRpcError(error.message) };
  revalidateCorrectionSurfaces();
  return toCorrectionResult(data);
}

export async function reviewTimeCorrection(
  rawInput: ReviewTimeCorrectionInput
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
  const { data: request } = await admin
    .from('time_correction_requests')
    .select('organization_id, subject_user_id')
    .eq('id', input.requestId)
    .maybeSingle();
  if (!request) return { success: false, error: 'request_not_found' };
  const { data: membership } = await admin
    .from('organization_members')
    .select('role')
    .eq('organization_id', request.organization_id)
    .eq('user_id', request.subject_user_id)
    .maybeSingle();
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
  const responsibilitySnapshot: Json = {
    holderEmployeeRecordId: authorization.holder.employeeRecordId,
    source: authorization.holder.source,
    configurationId: authorization.effective.configurationId,
    resolvedAt: new Date().toISOString(),
  };
  const { data, error } = await admin.rpc('decide_time_correction', {
    p_request_id: input.requestId,
    p_actor_id: user.id,
    p_operation_id: input.operationId,
    p_expected_revision: input.expectedRevision,
    p_decision: input.decision,
    p_comment: input.comment,
    p_responsibility_snapshot: responsibilitySnapshot,
  });
  if (error) return { success: false, error: mapRpcError(error.message) };
  revalidateCorrectionSurfaces();
  return toCorrectionResult(data);
}

export async function withdrawTimeCorrection(input: {
  requestId: string;
  operationId: string;
}): Promise<TimeCorrectionResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const { data, error } = await createSupabaseAdminClient().rpc(
    'withdraw_time_correction',
    {
      p_request_id: input.requestId,
      p_actor_id: user.id,
      p_operation_id: input.operationId,
    }
  );
  if (error) return { success: false, error: mapRpcError(error.message) };
  revalidateCorrectionSurfaces();
  return toCorrectionResult(data);
}

export async function resubmitTimeCorrection(input: {
  requestId: string;
  expectedRevision: number;
  reason: string;
  operationId: string;
}): Promise<TimeCorrectionResult> {
  if (input.reason.trim().length < 3 || input.reason.trim().length > 2000) {
    return { success: false, error: 'invalid_input' };
  }
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const admin = createSupabaseAdminClient();
  const { data: request } = await admin.from('time_correction_requests')
    .select('organization_id, source_scope_key, current_revision')
    .eq('id', input.requestId).maybeSingle();
  if (!request || request.current_revision !== input.expectedRevision) {
    return { success: false, error: 'time_correction_stale_revision' };
  }
  const [{ data: revision }, { data: sources }] = await Promise.all([
    admin.from('time_correction_request_revisions').select('*')
      .eq('request_id', input.requestId).eq('revision', input.expectedRevision)
      .maybeSingle(),
    admin.from('time_correction_request_sources').select('*')
      .eq('request_id', input.requestId).eq('revision', input.expectedRevision)
      .order('ordinal'),
  ]);
  if (!revision) return { success: false, error: 'request_not_found' };
  const sourcePayload = (sources ?? []).flatMap((source) => {
    const sourceId = source.time_entry_id ?? source.time_session_id
      ?? source.time_segment_id ?? source.correction_application_id;
    return sourceId ? [{
      kind: source.source_kind,
      id: sourceId,
      version: source.source_version,
    }] : [];
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

export async function reviewTimeCorrectionsBatch(input: {
  requests: Array<{ requestId: string; expectedRevision: number }>;
  decision: 'approve' | 'reject';
  comment: string | null;
}): Promise<
  | { success: true }
  | { success: false; error: string }
> {
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
  const { data: roots, error: rootError } = await admin
    .from('time_correction_requests')
    .select('id, organization_id, subject_user_id')
    .in('id', requestIds);
  if (rootError || roots?.length !== requestIds.length) {
    return { success: false, error: 'request_not_found' };
  }
  const organizationIds = new Set(roots.map((request) => request.organization_id));
  if (organizationIds.size !== 1) return { success: false, error: 'invalid_input' };
  const organizationId = roots[0]?.organization_id;
  if (!organizationId) return { success: false, error: 'invalid_input' };
  const userIds = [...new Set(roots.map((request) => request.subject_user_id))];
  const { data: memberships } = await admin.from('organization_members')
    .select('user_id, role').eq('organization_id', organizationId).in('user_id', userIds);
  const roleByUser = new Map((memberships ?? []).map((membership) => [
    membership.user_id,
    membership.role as OrgRole,
  ]));
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
  const operationIds = input.requests.map(() => crypto.randomUUID());
  const { error } = await admin.rpc('decide_time_correction_batch', {
    p_request_ids: requestIds,
    p_actor_id: user.id,
    p_operation_ids: operationIds,
    p_expected_revisions: input.requests.map((request) => request.expectedRevision),
    p_decision: input.decision,
    p_comment: input.comment,
    p_responsibility_snapshot: {
      mode: 'batch',
      resolvedAt: new Date().toISOString(),
    },
  });
  if (error) return { success: false, error: mapRpcError(error.message) };
  revalidateCorrectionSurfaces();
  return { success: true };
}

export async function getTimeCorrectionRequests(
  organizationId: string
): Promise<TimeCorrectionListResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const callerRole = await getMembershipRole(user.id, organizationId);
  if (!callerRole) return { success: false, error: 'not_a_member' };
  const admin = createSupabaseAdminClient();
  const holder = await getEffectiveResponsibilityHolderForActor({
    organizationId,
    responsibility: 'time_approval',
    actorUserId: user.id,
  });
  const { data: roots, error } = await admin
    .from('time_correction_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return { success: false, error: 'fetch_failed' };
  if (!roots?.length) return { success: true, requests: [] };
  const requestIds = roots.map((request) => request.id);
  const currentRevisions = [...new Set(
    roots.map((request) => request.current_revision)
  )];
  const userIds = [...new Set((roots ?? []).flatMap((request) => [
    request.requested_by,
    request.subject_user_id,
  ]))];
  const [{ data: memberships }, { data: profiles }, { data: revisions }] =
    await Promise.all([
      admin.from('organization_members').select('user_id, role')
        .eq('organization_id', organizationId).in('user_id', userIds),
      admin.from('profiles').select('id, first_name, last_name, email').in('id', userIds),
      admin.from('time_correction_request_revisions').select('*')
        .eq('organization_id', organizationId)
        .in('request_id', requestIds)
        .in('revision', currentRevisions),
    ]);
  const roleByUser = new Map(
    (memberships ?? []).map((membership) => [membership.user_id, membership.role as OrgRole])
  );
  const nameByUser = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email,
    ])
  );
  const revisionByKey = new Map(
    (revisions ?? []).map((revision) => [
      `${revision.request_id}:${revision.revision}`,
      revision,
    ])
  );
  const visible = (roots ?? []).filter((request) => {
    const targetRole = roleByUser.get(request.subject_user_id);
    const canReview = Boolean(
      holder && targetRole && canHolderApproveTarget(
        holder,
        request.subject_user_id,
        targetRole
      )
    );
    return callerRole !== 'employee' || request.requested_by === user.id
      || request.subject_user_id === user.id || canReview;
  });
  const requests: TimeCorrectionRequest[] = [];
  for (const request of visible) {
    const revision = revisionByKey.get(`${request.id}:${request.current_revision}`);
    if (!revision || !isTimeCorrectionSnapshot(revision.before_snapshot)
      || !isTimeCorrectionSnapshot(revision.proposed_snapshot)) continue;
    const targetRole = roleByUser.get(request.subject_user_id);
    const canReview = Boolean(
      request.status === 'submitted' && holder && targetRole
      && canHolderApproveTarget(holder, request.subject_user_id, targetRole)
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
      canWithdraw: request.requested_by === user.id
        && (request.status === 'submitted' || request.status === 'clarification_required'),
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

export async function getApprovedTimeCorrectionApplications(input: {
  organizationId: string;
  userId?: string;
}): Promise<TimeCorrectionApplicationProjection[]> {
  const user = await getAuthenticatedUser();
  if (!user) return [];
  const callerRole = await getMembershipRole(user.id, input.organizationId);
  if (!callerRole) return [];
  if (callerRole === 'employee' && input.userId && input.userId !== user.id) {
    return [];
  }
  const effectiveUserId = callerRole === 'employee' ? user.id : input.userId;
  const admin = createSupabaseAdminClient();
  let requestQuery = admin.from('time_correction_requests')
    .select('id').eq('organization_id', input.organizationId).eq('status', 'approved');
  if (effectiveUserId) {
    requestQuery = requestQuery.eq('subject_user_id', effectiveUserId);
  }
  const { data: requests, error: requestError } = await requestQuery;
  if (requestError || !requests?.length) return [];
  const requestIds = requests.map((request) => request.id);
  const [{ data: applications }, { data: sources }] = await Promise.all([
    admin.from('time_correction_applications').select('*')
      .eq('organization_id', input.organizationId).in('request_id', requestIds),
    admin.from('time_correction_request_sources').select('*')
      .eq('organization_id', input.organizationId).in('request_id', requestIds),
  ]);
  const sourcesByRevision = new Map<string, TimeCorrectionSource[]>();
  for (const source of sources ?? []) {
    const sourceId = source.time_entry_id ?? source.time_session_id
      ?? source.time_segment_id ?? source.correction_application_id;
    if (!sourceId) continue;
    const key = `${source.request_id}:${source.revision}`;
    const list = sourcesByRevision.get(key) ?? [];
    list.push({ kind: source.source_kind, id: sourceId, version: source.source_version });
    sourcesByRevision.set(key, list);
  }
  return (applications ?? []).flatMap((application) => {
    if (!isTimeCorrectionSnapshot(application.applied_snapshot)) return [];
    return [{
      applicationId: application.id,
      requestId: application.request_id,
      appliedAt: application.applied_at,
      appliedBy: application.applied_by,
      sourceFingerprint: application.source_fingerprint,
      snapshot: application.applied_snapshot,
      sources: sourcesByRevision.get(
        `${application.request_id}:${application.revision}`
      ) ?? [],
    }];
  });
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
  organizationId: string
): Promise<
  | { success: true; options: TimeCorrectionFormOptions }
  | { success: false; error: string }
> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  if (!await getMembershipRole(user.id, organizationId)) {
    return { success: false, error: 'not_a_member' };
  }
  const admin = createSupabaseAdminClient();
  const [{ data: employees, error: employeeError }, { data: memberships }, { data: jobs }] =
    await Promise.all([
      admin.from('employee_records').select('id, user_id')
        .eq('organization_id', organizationId).not('user_id', 'is', null),
      admin.from('organization_members').select('user_id, role')
        .eq('organization_id', organizationId),
      admin.from('jobs').select('id, title, job_number')
        .eq('organization_id', organizationId)
        .not('status', 'in', '(abgeschlossen,storniert)')
        .order('created_at', { ascending: false }).limit(300),
    ]);
  if (employeeError || !employees) return { success: false, error: 'fetch_failed' };
  const userIds = employees.map((employee) => employee.user_id as string);
  const { data: profiles } = await admin.from('profiles')
    .select('id, first_name, last_name, email').in('id', userIds);
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const roleById = new Map((memberships ?? []).map((membership) => [
    membership.user_id,
    membership.role as OrgRole,
  ]));
  const people = employees.flatMap((employee) => {
    const userId = employee.user_id as string;
    const role = roleById.get(userId);
    if (!role) return [];
    const profile = profileById.get(userId);
    return [{
      employeeRecordId: employee.id,
      userId,
      name: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')
        || profile?.email || 'Unbekannt',
      role,
    }];
  });
  const current = people.find((person) => person.userId === user.id);
  if (!current) return { success: false, error: 'subject_not_found' };
  return {
    success: true,
    options: {
      people,
      jobs: (jobs ?? []).map((job) => ({
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

export async function getProvisionalTimeCorrectionProjection(input: {
  organizationId: string;
  from: string;
  to: string;
  userId?: string;
}): Promise<ProvisionalTimeCorrectionProjection> {
  const requestResult = await getTimeCorrectionRequests(input.organizationId);
  if (!requestResult.success) return { entries: [], sources: [] };
  const pending = requestResult.requests.filter((request) =>
    (request.status === 'submitted' || request.status === 'clarification_required')
    && (!input.userId || request.subjectUserId === input.userId)
  );
  if (pending.length === 0) return { entries: [], sources: [] };
  const admin = createSupabaseAdminClient();
  const requestIds = pending.map((request) => request.id);
  const { data: rows } = await admin.from('time_correction_request_sources')
    .select('*').eq('organization_id', input.organizationId).in('request_id', requestIds);
  const requestById = new Map(pending.map((request) => [request.id, request]));
  const sources = (rows ?? []).flatMap((source) => {
    const sourceId = source.time_entry_id ?? source.time_session_id
      ?? source.time_segment_id ?? source.correction_application_id;
    const request = requestById.get(source.request_id);
    return sourceId && request && source.revision === request.currentRevision
      ? [{
          requestId: request.id,
          kind: request.kind,
          sourceKind: source.source_kind,
          sourceId,
        }]
      : [];
  });
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  const entries = pending.flatMap((request) =>
    request.revision.proposedSnapshot.facts.flatMap((fact) => {
      const timestamp = Date.parse(fact.timestamp);
      if (timestamp < from || timestamp > to || (input.userId && fact.userId !== input.userId)) {
        return [];
      }
      return [{
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
      }];
    })
  );
  return { entries, sources };
}

function snapshotMinutes(snapshot: TimeCorrectionSnapshot): number {
  let activeStart: number | null = null;
  let minutes = 0;
  for (const fact of [...snapshot.facts].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp)
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

export async function getProvisionalTimeSummary(input: {
  organizationId: string;
  userId: string;
}): Promise<
  | { success: true; count: number; beforeMinutes: number; proposedMinutes: number }
  | { success: false; error: string }
> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const role = await getMembershipRole(user.id, input.organizationId);
  if (!role) return { success: false, error: 'not_a_member' };
  if (role === 'employee' && input.userId !== user.id) {
    return { success: false, error: 'not_authorized' };
  }
  const result = await getTimeCorrectionRequests(input.organizationId);
  if (!result.success) return result;
  const pending = result.requests.filter((request) =>
    request.subjectUserId === input.userId
    && (request.status === 'submitted' || request.status === 'clarification_required')
  );
  return {
    success: true,
    count: pending.length,
    beforeMinutes: pending.reduce(
      (total, request) => total + snapshotMinutes(request.revision.beforeSnapshot),
      0
    ),
    proposedMinutes: pending.reduce(
      (total, request) => total + snapshotMinutes(request.revision.proposedSnapshot),
      0
    ),
  };
}

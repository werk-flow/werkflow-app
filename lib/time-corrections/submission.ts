import 'server-only';
import { createHash } from 'node:crypto';
import type { ActionFailure } from '@/lib/action-result';
import { canonicalize } from '@/lib/format/canonical-json';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { authorizeResponsibilityForTarget } from '@/lib/responsibilities/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { readInBatches } from '@/lib/supabase/query-batches';
import { proposeCalendarCorrection } from './calendar-proposal';
import { mergeCorrectionProposal } from './merge-proposal';
import {
  loadEmployeeIdentities,
  loadSourceContext,
  type EmployeeIdentity,
  type SourceContext,
  type SourceRefusal,
} from './source-context';
import type { TimeCorrectionFact, TimeCorrectionSnapshot, TimeCorrectionSource } from './types';
import { validateCorrectionShape, type SubmitTimeCorrectionInput } from './validation';

// The rules `submitTimeCorrection` applies between its authorization and the
// database call: the shape, the responsibility, the sources and the proposal.

type ProposedFactInput = SubmitTimeCorrectionInput['proposedFacts'][number] &
  Pick<TimeCorrectionFact, 'activity'>;

export function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

async function buildProposedSnapshot(input: {
  organizationId: string;
  proposedFacts: ProposedFactInput[];
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

function hasValidChronology(snapshot: TimeCorrectionSnapshot): boolean {
  return snapshot.facts.every((fact, index) => {
    const timestamp = Date.parse(fact.timestamp);
    if (!Number.isFinite(timestamp)) return false;
    const previous = snapshot.facts[index - 1];
    return !previous || timestamp >= Date.parse(previous.timestamp);
  });
}

/** The refusal of a submission's shape, decided before any read; null when the shape fits. */
export function submissionShapeError(input: SubmitTimeCorrectionInput): string | null {
  if (
    input.calendarAdjustment &&
    (input.source !== null || input.proposedFacts.length !== 0 || !['edit', 'reassign'].includes(input.kind))
  ) {
    return 'invalid_shape';
  }
  if (input.calendarAdjustment) {
    const targets = new Set(input.calendarAdjustment.map((boundary) => boundary.employeeRecordId));
    if (targets.size !== 1 || (input.kind === 'edit') !== targets.has(input.subjectEmployeeRecordId)) {
      return 'invalid_shape';
    }
  }
  return validateCorrectionShape({
    kind: input.kind,
    hasSource: Boolean(input.source || input.calendarAdjustment),
    proposedFactCount: input.calendarAdjustment?.length ?? input.proposedFacts.length,
  });
}

/**
 * The responsibility a submission for another person rests on, recorded with
 * the request; an own submission records none.
 */
export async function submissionResponsibility(
  organizationId: string,
  actorUserId: string,
  subject: EmployeeIdentity,
): Promise<{ success: true; snapshot: { [key: string]: Json | undefined } } | ActionFailure> {
  if (subject.userId === actorUserId) return { success: true, snapshot: {} };
  const authorization = await authorizeResponsibilityForTarget({
    organizationId,
    responsibility: 'time_approval',
    actorUserId,
    targetUserId: subject.userId,
    targetRole: subject.role,
  });
  if (!authorization.success) {
    return { success: false, error: authorization.error };
  }
  return {
    success: true,
    snapshot: {
      holderEmployeeRecordId: authorization.holder.employeeRecordId,
      source: authorization.holder.source,
      configurationId: authorization.effective.configurationId,
      resolvedAt: new Date().toISOString(),
    },
  };
}

/** The sources a submission names: each calendar boundary's source once, in a stable order. */
export function submissionSourceInputs(
  input: SubmitTimeCorrectionInput,
): Array<SubmitTimeCorrectionInput['source']> {
  return input.calendarAdjustment
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
}

type SourceInputs = Array<SubmitTimeCorrectionInput['source']>;

/** The context of every source, or the refusal of the first that has none. */
export async function loadSubmissionContexts(
  organizationId: string,
  subject: EmployeeIdentity,
  sourceInputs: SourceInputs,
): Promise<{ success: true; contexts: SourceContext[] } | ActionFailure<SourceRefusal>> {
  const contexts = await Promise.all(
    sourceInputs.map((source) => loadSourceContext({ organizationId, subject, source })),
  );
  const refusals = contexts.filter((context) => typeof context === 'string');
  if (refusals.length) {
    // A failed read outranks a missing source: the source may well exist.
    const error = refusals.includes('correction_timeline_unavailable')
      ? 'correction_timeline_unavailable'
      : 'source_not_found';
    return { success: false, error };
  }
  return { success: true, contexts: contexts.filter((context) => typeof context !== 'string') };
}

/**
 * A calendar adjustment of legacy entries covers one whole approved session:
 * it runs from a clock-in to a clock-out, every entry inside it is a source,
 * and no session before it is still open. False when it does not, or when a
 * read fails; true when no legacy entry is a source.
 */
async function coversWholeLegacySession(input: {
  organizationId: string;
  userId: string;
  sourceInputs: SourceInputs;
  before: TimeCorrectionSnapshot;
}): Promise<boolean> {
  const legacySources = input.sourceInputs.filter((source) => source?.kind === 'legacy_entry');
  if (!legacySources.length) return true;
  const first = input.before.facts[0];
  const last = input.before.facts.at(-1);
  if (
    legacySources.length !== input.sourceInputs.length ||
    !first ||
    !last ||
    first.entryType !== 'clock_in' ||
    last.entryType !== 'clock_out'
  ) {
    return false;
  }
  const admin = createSupabaseAdminClient();
  const [inside, preceding] = await Promise.all([
    admin
      .from('time_entries')
      .select('id, status')
      .eq('organization_id', input.organizationId)
      .eq('user_id', input.userId)
      .gte('timestamp', first.timestamp)
      .lte('timestamp', last.timestamp)
      .limit(legacySources.length + 1),
    admin
      .from('time_entries')
      .select('entry_type')
      .eq('organization_id', input.organizationId)
      .eq('user_id', input.userId)
      .lt('timestamp', first.timestamp)
      .order('timestamp', { ascending: false })
      .limit(1),
  ]);
  const sourceIds = new Set(legacySources.map((source) => source?.id));
  return !(
    inside.error ||
    preceding.error ||
    inside.data?.length !== sourceIds.size ||
    inside.data.some((entry) => !sourceIds.has(entry.id) || entry.status !== 'approved') ||
    (preceding.data?.[0] && preceding.data[0].entry_type !== 'clock_out')
  );
}

/**
 * The before and proposed snapshots of a submission and the sources they
 * rest on: a calendar adjustment replaces its sources' boundaries, any other
 * kind merges its proposed facts into the sources' facts.
 */
export async function proposeSubmission(input: {
  submission: SubmitTimeCorrectionInput;
  subject: EmployeeIdentity;
  sourceInputs: SourceInputs;
  contexts: SourceContext[];
}): Promise<
  | {
      success: true;
      before: TimeCorrectionSnapshot;
      proposed: TimeCorrectionSnapshot;
      sources: TimeCorrectionSource[];
    }
  | ActionFailure
> {
  const { submission, contexts } = input;
  let before: TimeCorrectionSnapshot = {
    schemaVersion: 1,
    facts: contexts.flatMap((context) => context.snapshot.facts),
  };
  let proposedFacts: ProposedFactInput[] = submission.proposedFacts;
  if (submission.calendarAdjustment) {
    const proposal = proposeCalendarCorrection({ contexts, boundaries: submission.calendarAdjustment });
    if (!proposal.success) return proposal;
    proposedFacts = proposal.snapshot.facts;
    before = proposal.before;
    const wholeSession = await coversWholeLegacySession({
      organizationId: submission.organizationId,
      userId: input.subject.userId,
      sourceInputs: input.sourceInputs,
      before,
    });
    if (!wholeSession) return { success: false, error: 'calendar_incomplete_source' };
  }
  const proposedSnapshot = await buildProposedSnapshot({
    organizationId: submission.organizationId,
    proposedFacts,
  });
  if (!proposedSnapshot) return { success: false, error: 'source_not_found' };
  const sources = contexts.flatMap((context) => (context.source ? [context.source] : []));
  const proposed = submission.calendarAdjustment
    ? proposedSnapshot
    : mergeCorrectionProposal(submission.kind, before, proposedSnapshot);
  if (!proposed) return { success: false, error: 'activity_context_required' };
  if (!hasValidChronology(proposed)) {
    return { success: false, error: 'invalid_time_order' };
  }
  if (submission.calendarAdjustment && proposed.facts.some((fact) => Date.parse(fact.timestamp) > Date.now())) {
    return { success: false, error: 'future_timestamp' };
  }
  return { success: true, before, proposed, sources };
}

import type { ActionResult } from '@/lib/action-result';
import { logReadErrors } from '@/lib/data/read-request-cache';
import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { getCanonicalTimeEntries } from '@/lib/time-tracking/canonical-entries';
import { toTimeEntries } from '@/lib/time-tracking/types';
import { loadApprovedCorrectionProjection } from './approved-projection';
import { correctionTimelineWindow, validateCorrectionTimeline } from './timeline-validation';
import { isTimeCorrectionSnapshot, type TimeCorrectionSnapshot, type TimeCorrectionSource } from './types';

type TimelineCheck = ActionResult<{ revision: number }>;

export type CorrectionCandidate = {
  before: TimeCorrectionSnapshot;
  proposed: TimeCorrectionSnapshot;
  sources: TimeCorrectionSource[];
};

/** A transport retry must reach the RPC's authoritative idempotency check without revalidating an already applied result. */
export async function correctionOperationExists(
  organizationId: string,
  actorId: string,
  operationId: string,
): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient()
    .from('time_correction_events')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('actor_id', actorId)
    .eq('operation_id', operationId)
    .maybeSingle();
  if (error) throw new Error('Correction operation lookup failed.');
  return Boolean(data);
}

/** Called after subject/responsibility authorization. Never return this organization history to a client. */
export async function readCorrectionTimelineRevision(organizationId: string): Promise<TimelineCheck> {
  const revision = await createSupabaseAdminClient()
    .from('time_timeline_revisions')
    .select('revision')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (revision.error) {
    logReadErrors('readCorrectionTimelineRevision: read failed', revision.error);
    return { success: false, error: 'correction_timeline_unavailable' };
  }
  return { success: true, revision: revision.data?.revision ?? 0 };
}

export async function checkCorrectionTimeline(
  organizationId: string,
  candidates: readonly CorrectionCandidate[],
  expectedRevision?: number,
): Promise<TimelineCheck> {
  const admin = createSupabaseAdminClient();
  const revision = await readCorrectionTimelineRevision(organizationId);
  if (!revision.success) return revision;
  if (expectedRevision !== undefined && expectedRevision !== revision.revision)
    return { success: false, error: 'time_correction_timeline_changed' };
  const facts = candidates.flatMap((candidate) => [...candidate.before.facts, ...candidate.proposed.facts]);
  const window = correctionTimelineWindow(facts);
  if (!window) return revision;
  const { affectedDays, from, to, userIds } = window;
  const [legacy, canonical, applications] = await Promise.all([
    // One user sits in exactly one batch, so each user's entries keep their timestamp order.
    readInBatches(userIds, (batch) =>
      readCompleteRows(
        (offset, end) =>
          admin
            .from('time_entries')
            .select('*')
            .eq('organization_id', organizationId)
            .in('user_id', [...batch])
            .gte('timestamp', from)
            .lte('timestamp', to)
            .order('timestamp')
            .order('created_at')
            .order('id')
            .range(offset, end),
        LIST_ROW_CAP,
      ),
    ),
    getCanonicalTimeEntries({ organizationId, userIds, from, to }),
    // eslint-disable-next-line no-restricted-syntax -- the null is refused together with the two other reads on the next line
    loadApprovedCorrectionProjection(admin, { organizationId, userIds, from, to }).catch(() => null),
  ]);
  if (legacy.error || !canonical.success || !applications)
    return { success: false, error: 'correction_timeline_unavailable' };
  const valid = validateCorrectionTimeline({
    organizationId,
    affectedDays,
    entries: [...toTimeEntries(legacy.data), ...canonical.entries],
    applications,
    candidates: candidates.map((candidate, index) => ({
      applicationId: `candidate-${index}`,
      requestId: `candidate-${index}`,
      appliedAt: new Date().toISOString(),
      appliedBy: '',
      sourceFingerprint: '',
      snapshot: candidate.proposed,
      sources: candidate.sources,
    })),
  });
  return valid ? revision : { success: false, error: 'correction_timeline_conflict' };
}

/** Reload the exact revisions about to be approved, and validate a batch as one composed change. */
export async function checkCorrectionReviewTimeline(
  organizationId: string,
  requests: readonly { requestId: string; expectedRevision: number }[],
): Promise<TimelineCheck> {
  const admin = createSupabaseAdminClient();
  const requestIds = requests.map((request) => request.requestId);
  // A request keeps few revisions, so reading them by request id and keeping the
  // expected one in memory replaces two round trips per request with two batched reads.
  const [revisions, sources] = await Promise.all([
    readInBatches(requestIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_correction_request_revisions')
            .select('request_id, revision, before_snapshot, proposed_snapshot')
            .eq('organization_id', organizationId)
            .in('request_id', [...batch])
            .order('request_id')
            .order('revision')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(requestIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_correction_request_sources')
            .select('*')
            .eq('organization_id', organizationId)
            .in('request_id', [...batch])
            .order('request_id')
            .order('revision')
            .order('ordinal')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  if (revisions.error || sources.error) return { success: false, error: 'correction_timeline_unavailable' };
  const candidates: CorrectionCandidate[] = [];
  for (const request of requests) {
    const revision = revisions.data.find(
      (row) => row.request_id === request.requestId && row.revision === request.expectedRevision,
    );
    if (
      !revision ||
      !isTimeCorrectionSnapshot(revision.before_snapshot) ||
      !isTimeCorrectionSnapshot(revision.proposed_snapshot)
    )
      return { success: false, error: 'correction_timeline_unavailable' };
    const sourceRows = sources.data.filter(
      (source) => source.request_id === request.requestId && source.revision === request.expectedRevision,
    );
    if (
      sourceRows.some(
        (source) =>
          !(
            source.time_entry_id ??
            source.time_segment_id ??
            source.time_session_id ??
            source.correction_application_id
          ),
      )
    )
      return { success: false, error: 'correction_timeline_unavailable' };
    candidates.push({
      before: revision.before_snapshot,
      proposed: revision.proposed_snapshot,
      sources: sourceRows.flatMap((source) => {
        const id =
          source.time_entry_id ??
          source.time_segment_id ??
          source.time_session_id ??
          source.correction_application_id;
        return id ? [{ kind: source.source_kind, id, version: source.source_version }] : [];
      }),
    });
  }
  return checkCorrectionTimeline(organizationId, candidates);
}

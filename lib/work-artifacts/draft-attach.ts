import 'server-only';

import { createHash } from 'node:crypto';

import type { ActionResult } from '@/lib/action-result';
import { canonicalize } from '@/lib/format/canonical-json';
import { logError } from '@/lib/logging';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isJsonRecord, toJson } from '@/lib/supabase/json';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { revalidateWorkEvidenceViews } from './revalidate';
import { authorizeWorkArtifactTarget } from './target-access';
import type { WorkArtifactDraftInput } from './validation';

// The attach of a report draft a phone wrote without signal (decision record
// 0010, the report draft amendment): the draft revision of a new
// Arbeitsnachweis on a job and the links to its photos, written by one
// database function under one operation id. A resend answers the first
// result; nothing here submits, reviews or signs.

export type WorkArtifactDraftOperation = {
  operationId: string;
  /** The device clock when the person last changed the draft, and at this send. */
  capturedAt: string;
  sentAt: string;
  draft: WorkArtifactDraftInput;
};

/** Why an attach wrote nothing. `attach_failed` and `load_failed` may succeed on a resend. */
export type WorkArtifactDraftAttachError =
  | 'not_authorized'
  | 'invalid_input'
  | 'idempotency_conflict'
  | 'stale_version'
  | 'voided'
  | 'load_failed'
  | 'attach_failed';

type WorkArtifactDraftAttachResult = ActionResult<{ replayed: boolean }, WorkArtifactDraftAttachError>;

/** Each refusal the database function names, with the attach's code. */
const DATABASE_REFUSALS: ReadonlyArray<readonly [string, WorkArtifactDraftAttachError]> = [
  ['work_artifact_not_authorized', 'not_authorized'],
  ['work_artifact_draft_idempotency_conflict', 'idempotency_conflict'],
  ['work_artifact_revision_idempotency_conflict', 'idempotency_conflict'],
  ['work_artifact_document_idempotency_conflict', 'idempotency_conflict'],
  ['work_artifact_stale_version', 'stale_version'],
  ['work_artifact_identity_mismatch', 'stale_version'],
  ['work_artifact_is_voided', 'voided'],
  ['work_artifact_draft_photo_invalid', 'invalid_input'],
  ['work_artifact_draft_invalid_input', 'invalid_input'],
];

/** The hash a resend must repeat: the organization, the captured time and the draft, never the send time. */
function hashDraftOperation(organizationId: string, operation: WorkArtifactDraftOperation): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonicalize({ organizationId, capturedAt: operation.capturedAt, draft: operation.draft }),
      ),
    )
    .digest('hex');
}

/** Whether the caller's operation is already recorded; null when the read failed (logged). */
async function isRecordedDraftOperation(
  context: ActionContext,
  operationId: string,
): Promise<boolean | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('work_artifact_draft_operations')
    .select('id')
    .eq('organization_id', context.orgId)
    .eq('actor_id', context.userId)
    .eq('id', operationId)
    .maybeSingle();
  if (error) {
    logError('attachWorkArtifactDraft: operation read failed', error);
    return null;
  }
  return data !== null;
}

/**
 * Attaches the draft for a caller whose membership in the organization is
 * established. A new operation needs the job in the caller's organization and,
 * for a field worker, their assignment; the database function checks both
 * again inside its transaction. A resend of a recorded operation skips the
 * job check and answers `replayed`: the person learns that the draft arrived
 * even after the office took the job from them.
 */
export async function attachWorkArtifactDraft(
  context: ActionContext,
  operation: WorkArtifactDraftOperation,
): Promise<WorkArtifactDraftAttachResult> {
  const { draft } = operation;
  const recorded = await isRecordedDraftOperation(context, operation.operationId);
  if (recorded === null) return { success: false, error: 'load_failed' };
  if (!recorded) {
    const access = await authorizeWorkArtifactTarget(context, { targetType: 'job', targetId: draft.jobId });
    if (!access.success) return access;
  }
  const { data, error } = await createSupabaseAdminClient().rpc(
    'attach_work_artifact_draft',
    rpcArgs('attach_work_artifact_draft', {
      p_organization_id: context.orgId,
      p_actor_id: context.userId,
      p_operation_id: operation.operationId,
      p_request_hash: hashDraftOperation(context.orgId, operation),
      p_captured_at: operation.capturedAt,
      p_sent_at: operation.sentAt,
      p_artifact_id: draft.artifactId,
      p_revision_id: draft.revisionId,
      p_job_id: draft.jobId,
      p_kind: draft.kind,
      p_visibility: draft.visibility,
      p_recorded_at: draft.capturedAt,
      p_title: draft.title,
      p_content: toJson({
        ...draft.content,
        measurementLines: draft.content.measurementLines?.map((line) => ({
          ...line,
          quantity: line.quantity.replace(',', '.'),
        })),
      }),
      p_photos: toJson(draft.photos),
    }),
  );
  if (error || !isJsonRecord(data)) {
    const refusal = DATABASE_REFUSALS.find(([message]) => error?.message.includes(message));
    if (refusal) return { success: false, error: refusal[1] };
    logError('attachWorkArtifactDraft: attach failed', error);
    return { success: false, error: 'attach_failed' };
  }
  if (data.replayed !== true) revalidateWorkEvidenceViews();
  return { success: true, replayed: data.replayed === true };
}

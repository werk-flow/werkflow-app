import 'server-only';

import type { ActionContext } from '@/lib/org/action-context';
import { captureUsage } from '@/lib/usage-statistics/capture';
import {
  attachWorkArtifactDraft,
  type WorkArtifactDraftAttachError,
} from '@/lib/work-artifacts/draft-attach';
import { workArtifactDraftSchema } from '@/lib/work-artifacts/validation';
import { FORBIDDEN, INVALID, UNAVAILABLE, type FieldSyncVerdict } from './outcomes';

// The `work_artifact.draft` operation of field sync v1: a new Arbeitsnachweis
// draft on a job with its photos, written on a phone, attached once
// (decision record 0010, the report draft amendment). The envelope's
// `capturedAt` is when the person last changed the draft. The photos are
// document ids of uploads that went to storage before; no bytes pass here.

export const WORK_ARTIFACT_DRAFT_KIND = 'work_artifact.draft';

/** Every way an attach writes nothing, with its outcome. TypeScript fails on an unmapped code. */
const REFUSAL_VERDICTS: Record<WorkArtifactDraftAttachError, FieldSyncVerdict> = {
  not_authorized: FORBIDDEN,
  invalid_input: INVALID,
  idempotency_conflict: { outcome: 'rejected', code: 'idempotency_conflict' },
  // An Arbeitsnachweis with this id exists already: the device never writes over it.
  stale_version: { outcome: 'conflict', code: 'version_conflict' },
  voided: { outcome: 'conflict', code: 'office_changed' },
  load_failed: UNAVAILABLE,
  attach_failed: UNAVAILABLE,
};

/** Attaches one `work_artifact.draft` operation for a caller whose membership in the organization is established. */
export async function replayWorkArtifactDraft(
  context: ActionContext,
  operation: { operationId: string; payload: unknown; capturedAt: string; sentAt: string },
): Promise<FieldSyncVerdict> {
  const draft = workArtifactDraftSchema.safeParse(operation.payload);
  if (!draft.success) return INVALID;
  // A coworker who signed in on the same phone never sends the author's draft as theirs: it waits,
  // pending, for its author's session.
  if (draft.data.authorId !== context.userId) return { outcome: 'retry', code: 'unauthenticated' };
  const result = await attachWorkArtifactDraft(context, {
    operationId: operation.operationId,
    capturedAt: operation.capturedAt,
    sentAt: operation.sentAt,
    draft: draft.data,
  });
  if (!result.success) return REFUSAL_VERDICTS[result.error];
  if (!result.replayed) captureUsage(context.orgId, 'work_report', 'started');
  return result.replayed
    ? { outcome: 'replayed', code: 'replayed' }
    : { outcome: 'accepted', code: 'accepted' };
}

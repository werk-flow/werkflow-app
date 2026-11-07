import type { WorkArtifactActionRow, WorkArtifactRevisionRow, WorkArtifactRow } from './types';

/**
 * A coworker's internal draft, which only its author, Admin and Büro read. The
 * database refuses the coworker's review request for it as well.
 */
export function isHiddenCoworkerDraft(
  viewer: { userId: string; isManagerOrAbove: boolean },
  artifact: Pick<WorkArtifactRow, 'status'>,
  currentRevision: Pick<WorkArtifactRevisionRow, 'visibility' | 'created_by'>,
): boolean {
  return (
    !viewer.isManagerOrAbove &&
    artifact.status === 'draft' &&
    currentRevision.visibility === 'internal_only' &&
    currentRevision.created_by !== viewer.userId
  );
}

export function redactWorkArtifactActionForField(
  action: WorkArtifactActionRow,
  viewerId: string,
): WorkArtifactActionRow {
  const ownsAction = action.created_by === viewerId;

  return {
    action_type: action.action_type,
    artifact_id: action.artifact_id,
    capture_method: ownsAction ? action.capture_method : null,
    comment: action.comment,
    created_at: action.created_at,
    created_by: action.created_by,
    id: action.id,
    organization_id: action.organization_id,
    reason: action.reason,
    responsibility_snapshot: null,
    revision_id: action.revision_id,
    signature_document_id: ownsAction ? action.signature_document_id : null,
    signer_company_context: ownsAction ? action.signer_company_context : null,
    signer_name: ownsAction ? action.signer_name : null,
    signer_relationship: ownsAction ? action.signer_relationship : null,
    signer_role: ownsAction ? action.signer_role : null,
    witness_context: ownsAction ? action.witness_context : null,
    wording_snapshot: ownsAction ? action.wording_snapshot : null,
  };
}

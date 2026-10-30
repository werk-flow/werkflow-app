import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import type { AuthContext } from '@/lib/jobs/auth';
import type { AdminClient } from '@/lib/supabase/admin';

import { redactWorkArtifactActionForField } from './field-visibility';
import type {
  WorkArtifactActionRow,
  WorkArtifactActionType,
  WorkArtifactDetail,
  WorkArtifactRevisionRow,
  WorkArtifactRow,
  WorkArtifactTarget,
} from './types';

// The steps of getWorkArtifactDetail in actions.ts, which authenticates the
// caller and authorizes the target before it reads the detail rows.

type RevisionJoin = { work_artifact_revisions: unknown; revision_id: string };

const FIELD_DISCLOSING_ARTIFACT_ACTIONS = new Set<WorkArtifactActionType>([
  'review_requested',
  'internal_approved',
  'internal_rejected',
  'correction_requested',
  'customer_acknowledged',
  'customer_refused',
  'customer_reserved',
  'signature_captured',
  'voided',
]);

/** The artifact in the caller's organization and the job or project it belongs to. */
export async function readArtifactForDetail(
  admin: AdminClient,
  organizationId: string,
  artifactId: string,
): Promise<{ success: true; artifact: WorkArtifactRow; target: WorkArtifactTarget } | ActionFailure> {
  const { data: artifact, error: artifactError } = await loggedRead(
    'getWorkArtifactDetail: work_artifacts read failed',
    admin
      .from('work_artifacts')
      .select('*')
      .eq('id', artifactId)
      .eq('organization_id', organizationId)
      .maybeSingle(),
  );
  if (artifactError) return { success: false, error: 'work_artifact_load_failed' };
  if (!artifact) return { success: false, error: 'work_artifact_not_found' };
  const target: WorkArtifactTarget | null = artifact.job_id
    ? { targetType: 'job', targetId: artifact.job_id }
    : artifact.project_id
      ? { targetType: 'project', targetId: artifact.project_id }
      : null;
  if (!target) return { success: false, error: 'work_artifact_not_found' };
  return { success: true, artifact, target };
}

/** Refuses a field worker a coworker's internal draft; a failed read is never a refusal. */
export async function refuseHiddenCoworkerDraft(
  admin: AdminClient,
  context: AuthContext,
  artifact: WorkArtifactRow,
): Promise<ActionFailure | null> {
  if (context.isManagerOrAbove || artifact.status !== 'draft' || !artifact.current_revision_id) return null;
  const { data: currentRevision, error: currentRevisionError } = await admin
    .from('work_artifact_revisions')
    .select('visibility, created_by')
    .eq('organization_id', context.orgId)
    .eq('id', artifact.current_revision_id)
    .maybeSingle();
  if (currentRevisionError || !currentRevision) {
    logReadErrors('getWorkArtifactDetail: read failed', currentRevisionError);
    return { success: false, error: 'work_artifact_load_failed' };
  }
  if (currentRevision?.visibility === 'internal_only' && currentRevision.created_by !== context.userId) {
    return { success: false, error: 'not_authorized' };
  }
  return null;
}

function withoutRevisionJoin<Row extends RevisionJoin>(rows: Row[]): Omit<Row, 'work_artifact_revisions'>[] {
  return rows.map((row) => {
    const copy: Omit<Row, 'work_artifact_revisions'> & { work_artifact_revisions?: unknown } = { ...row };
    delete copy.work_artifact_revisions;
    return copy;
  });
}

/** The detail a caller may see: a field worker sees own, disclosed and customer-facing revisions. */
export function toVisibleArtifactDetail(
  context: AuthContext,
  artifact: WorkArtifactRow,
  rows: {
    revisions: WorkArtifactRevisionRow[];
    actions: WorkArtifactActionRow[];
    lines: Array<WorkArtifactDetail['measurementLines'][number] & RevisionJoin>;
    defects: Array<WorkArtifactDetail['defectDetails'][number] & RevisionJoin>;
    changes: Array<WorkArtifactDetail['changeDetails'][number] & RevisionJoin>;
    documents: Array<WorkArtifactDetail['documents'][number] & RevisionJoin>;
    sources: Array<WorkArtifactDetail['sources'][number] & RevisionJoin>;
  },
): WorkArtifactDetail {
  const disclosedRevisionIds = new Set(
    rows.actions
      .filter((action) => FIELD_DISCLOSING_ARTIFACT_ACTIONS.has(action.action_type))
      .map((action) => action.revision_id),
  );
  const visibleRevisions = context.isManagerOrAbove
    ? rows.revisions
    : rows.revisions.filter(
        (revision) =>
          revision.visibility !== 'internal_only' ||
          revision.created_by === context.userId ||
          disclosedRevisionIds.has(revision.id),
      );
  const visibleRevisionIds = new Set(visibleRevisions.map((revision) => revision.id));
  const visibleActions = rows.actions.filter(
    (action) => context.isManagerOrAbove || visibleRevisionIds.has(action.revision_id),
  );
  const visibleRows = <Row extends RevisionJoin>(joined: Row[]): Omit<Row, 'work_artifact_revisions'>[] =>
    withoutRevisionJoin(
      context.isManagerOrAbove ? joined : joined.filter((row) => visibleRevisionIds.has(row.revision_id)),
    );
  return {
    ...artifact,
    revisions: visibleRevisions.map((revision) =>
      revision.corrects_revision_id && !visibleRevisionIds.has(revision.corrects_revision_id)
        ? { ...revision, corrects_revision_id: null }
        : revision,
    ),
    actions: context.isManagerOrAbove
      ? visibleActions
      : visibleActions.map((action) => redactWorkArtifactActionForField(action, context.userId)),
    measurementLines: visibleRows(rows.lines),
    defectDetails: visibleRows(rows.defects),
    changeDetails: visibleRows(rows.changes),
    documents: visibleRows(rows.documents),
    sources: visibleRows(rows.sources),
  };
}

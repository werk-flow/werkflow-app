// Isolated stand-in for `@/lib/work-artifacts/actions`: a save records its
// input and answers with the saved work report as the server would read it.
// Every other artifact action is a contract violation.
import type {
  RecordedVisitWindow,
  SaveWorkArtifactInput,
  WorkArtifactDetail,
} from '@/lib/work-artifacts/types';
import { unexpectedWrite } from './held-write-boundary';

type WorkArtifactActions = typeof import('@/lib/work-artifacts/actions');

declare global {
  interface Window {
    uiContractWorkArtifacts: { saves: SaveWorkArtifactInput[] };
    /** Set by a spec's init script: the visit window the page read from today's time records. */
    uiContractRecordedVisit?: RecordedVisitWindow;
  }
}

window.uiContractWorkArtifacts = { saves: [] };

const actor = 'contract-worker';

function savedDetail(input: SaveWorkArtifactInput): WorkArtifactDetail {
  const at = new Date().toISOString();
  const content = input.content;
  return {
    id: input.artifactId,
    organization_id: 'contract-organization',
    job_id: input.targetId,
    project_id: null,
    kind: input.kind,
    status: input.submit ? 'submitted' : 'draft',
    version: 1,
    current_revision_id: input.revisionId,
    created_at: at,
    created_by: actor,
    updated_at: at,
    void_reason: null,
    voided_at: null,
    voided_by: null,
    revisions: [
      {
        id: input.revisionId,
        artifact_id: input.artifactId,
        organization_id: 'contract-organization',
        kind: input.kind,
        revision_number: 1,
        title: input.title,
        visibility: input.visibility,
        captured_at: input.capturedAt,
        created_at: at,
        created_by: actor,
        correction_reason: null,
        corrects_revision_id: null,
        summary: content.summary ?? null,
        performed_work: content.performedWork ?? null,
        visit_started_at: content.visitStartedAt ?? null,
        visit_ended_at: content.visitEndedAt ?? null,
        next_visit_at: null,
        outstanding_work: null,
        materials_summary: null,
        customer_statement: null,
        requires_customer_response: false,
        requires_signature: false,
        instruction_item_id: null,
        site_id: null,
        work_date: null,
        progress: null,
        people_present: null,
        weather_conditions: null,
        site_conditions: null,
        deliveries: null,
        impediments: null,
        decisions: null,
        notable_events: null,
        measurement_date: null,
        measurement_location: null,
        measurement_notes: null,
      },
    ],
    actions: input.submit
      ? [
          {
            id: input.submitActionId ?? 'contract-submit',
            artifact_id: input.artifactId,
            revision_id: input.revisionId,
            organization_id: 'contract-organization',
            action_type: 'review_requested',
            created_at: at,
            created_by: actor,
            reason: null,
            comment: null,
            capture_method: null,
            responsibility_snapshot: null,
            signature_document_id: null,
            signer_company_context: null,
            signer_name: null,
            signer_relationship: null,
            signer_role: null,
            witness_context: null,
            wording_snapshot: null,
          },
        ]
      : [],
    measurementLines: [],
    defectDetails: [],
    changeDetails: [],
    documents: [],
    sources: [],
  };
}

export const saveWorkArtifact: WorkArtifactActions['saveWorkArtifact'] = async (input) => {
  window.uiContractWorkArtifacts.saves.push(structuredClone(input));
  const artifact = savedDetail(input);
  return {
    success: true,
    artifactId: artifact.id,
    version: artifact.version,
    status: artifact.status,
    artifact,
  };
};

export const recordWorkArtifactAction = unexpectedWrite;
export const voidWorkArtifact = unexpectedWrite;
export const discardUnlinkedWorkArtifactSignature = unexpectedWrite;
export const exportWorkArtifact = unexpectedWrite;
export const fulfillInstructionEvidence = unexpectedWrite;
export const linkWorkArtifactDocument = unexpectedWrite;
export const linkWorkArtifactSource = unexpectedWrite;
export const removeInstructionEvidenceFulfillment = unexpectedWrite;
